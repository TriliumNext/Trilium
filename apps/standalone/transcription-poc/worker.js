// Runs sherpa-onnx (WebAssembly) off the page's thread: downloads models into OPFS, loads them into
// the Emscripten file system, and transcribes clips or live microphone audio.
// A classic worker, because the prebuilt glue declares a global `Module` and is loaded with
// importScripts().
/* global Module, OfflineRecognizer, createVad */

const SAMPLE_RATE = 16000;
const VAD_WINDOW = 512;

self.Module = {
    locateFile: (file) => `vendor/${file}`,
    // The baked-in model package is patched out by fetch-assets.mjs; answer its request with nothing.
    getPreloadedPackage: () => new ArrayBuffer(0),
    print: (text) => post("log", { text }),
    printErr: (text) => post("log", { text }),
    onRuntimeInitialized: () => post("ready", { heap: heapMiB() })
};
importScripts("vendor/sherpa-onnx-wasm-main-vad-asr.js", "vendor/sherpa-onnx-asr.js", "vendor/sherpa-onnx-vad.js");

let recognizer = null;
/** One VAD per live source ("microphone", "tab"), so their utterances never mix. */
const lives = new Map();

self.onmessage = async ({ data }) => {
    try {
        switch (data.type) {
            case "download": return await download(data.model);
            case "load": return await load(data.model);
            case "transcribe": return transcribeClip(data.label, data.samples);
            case "live-start": return startLive(data.source);
            case "samples": return acceptLive(data.source, data.samples);
            case "live-stop": return stopLive(data.source);
            case "delete": return await deleteModel(data.model);
        }
    } catch (e) {
        post("error", { message: e?.stack ?? String(e) });
    }
};

async function download(model) {
    const dir = await modelDirectory(model, true);
    for (const file of model.files) {
        const handle = await dir.getFileHandle(file.name, { create: true });
        if ((await handle.getFile()).size === file.size) {
            post("progress", { file: file.name, loaded: file.size, total: file.size, cached: true });
            continue;
        }

        const started = performance.now();
        const response = await fetch(file.url);
        if (!response.ok || !response.body) {
            throw new Error(`${file.url}: HTTP ${response.status}`);
        }
        let loaded = 0;
        let lastReport = 0;
        const counter = new TransformStream({
            transform(chunk, controller) {
                loaded += chunk.byteLength;
                if (performance.now() - lastReport > 250) {
                    lastReport = performance.now();
                    post("progress", { file: file.name, loaded, total: file.size });
                }
                controller.enqueue(chunk);
            }
        });
        await writeStream(handle, response.body.pipeThrough(counter));
        post("progress", { file: file.name, loaded, total: file.size, ms: performance.now() - started });
    }
    post("downloaded", { model: model.id });
}

/** Streams into an OPFS file, through the async writable where the browser has one (not Safari). */
async function writeStream(handle, stream) {
    if ("createWritable" in handle) {
        await stream.pipeTo(await handle.createWritable());
        return;
    }
    const access = await handle.createSyncAccessHandle();
    try {
        access.truncate(0);
        let offset = 0;
        for await (const chunk of stream) {
            offset += access.write(chunk, { at: offset });
        }
        access.flush();
    } finally {
        access.close();
    }
}

async function load(model) {
    unload();
    const timings = {};
    const dir = await modelDirectory(model, false);
    Module.FS_createPath("/", `models/${model.id}`, true, true);

    let started = performance.now();
    for (const file of model.files) {
        const blob = await (await dir.getFileHandle(file.name)).getFile();
        // canOwn: the file system adopts the buffer instead of copying it.
        Module.FS_createDataFile(`/models/${model.id}`, file.name, new Uint8Array(await blob.arrayBuffer()), true, true, true);
    }
    const vadBytes = new Uint8Array(await (await fetch("vendor/silero_vad.onnx")).arrayBuffer());
    try {
        Module.FS_unlink("/models/silero_vad.onnx");
    } catch {
        // First load.
    }
    Module.FS_createDataFile("/models", "silero_vad.onnx", vadBytes, true, true, true);
    timings.copyToMemfsMs = performance.now() - started;

    started = performance.now();
    recognizer = new OfflineRecognizer({
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: { ...model.modelConfig, numThreads: 1, provider: "cpu", debug: 0 },
        decodingMethod: "greedy_search"
    }, Module);
    timings.createRecognizerMs = performance.now() - started;
    const heapAfterLoad = heapMiB();

    // The recognizer holds its own copy now, so the file system's can go.
    for (const file of model.files) {
        Module.FS_unlink(`/models/${model.id}/${file.name}`);
    }
    post("loaded", { model: model.id, timings, heapAfterLoad, heap: heapMiB() });
}

function unload() {
    for (const source of lives.keys()) {
        stopLive(source);
    }
    recognizer?.free();
    recognizer = null;
}

function transcribeClip(label, samples) {
    requireRecognizer();
    const started = performance.now();
    const text = decode(samples);
    const ms = performance.now() - started;
    const audioMs = samples.length / SAMPLE_RATE * 1000;
    post("result", { label, text, ms, audioMs, rtf: ms / audioMs, heap: heapMiB() });
}

function startLive(source) {
    requireRecognizer();
    lives.get(source)?.vad.free();
    const vad = createVad(Module, {
        sileroVad: {
            model: "/models/silero_vad.onnx",
            threshold: 0.5,
            minSilenceDuration: 0.5,
            minSpeechDuration: 0.25,
            maxSpeechDuration: 8,
            windowSize: VAD_WINDOW
        },
        tenVad: { model: "", threshold: 0.5, minSilenceDuration: 0.5, minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: 256 },
        sampleRate: SAMPLE_RATE,
        numThreads: 1,
        provider: "cpu",
        debug: 0,
        bufferSizeInSeconds: 60
    });
    lives.set(source, { vad, pending: new Float32Array(0), samples: 0, peak: 0, peakSince: performance.now() });
    post("live-started", { source });
}

function acceptLive(source, samples) {
    const live = lives.get(source);
    if (!live) {
        return;
    }
    live.samples += samples.length;
    reportPeak(source, live, samples);
    const all = new Float32Array(live.pending.length + samples.length);
    all.set(live.pending);
    all.set(samples, live.pending.length);
    let offset = 0;
    for (; offset + VAD_WINDOW <= all.length; offset += VAD_WINDOW) {
        live.vad.acceptWaveform(all.subarray(offset, offset + VAD_WINDOW));
    }
    live.pending = all.slice(offset);
    drainVad(source, live);
}

function stopLive(source) {
    const live = lives.get(source);
    if (!live) {
        return;
    }
    live.vad.flush();
    drainVad(source, live);
    live.vad.free();
    lives.delete(source);
    post("live-stopped", { source });
}

/** Logs the loudest sample every 5 s, to tell a silent capture from one without speech. */
function reportPeak(source, live, samples) {
    for (const sample of samples) {
        live.peak = Math.max(live.peak, Math.abs(sample));
    }
    if (performance.now() - live.peakSince >= 5000) {
        post("peak", { source, peak: live.peak });
        live.peak = 0;
        live.peakSince = performance.now();
    }
}

function drainVad(source, live) {
    while (!live.vad.isEmpty()) {
        const segment = live.vad.front();
        live.vad.pop();
        const started = performance.now();
        const text = decode(segment.samples);
        const ms = performance.now() - started;
        const audioMs = segment.samples.length / SAMPLE_RATE * 1000;
        // How far the transcript trails the speaker once this utterance is out.
        const lagMs = (live.samples - segment.start) / SAMPLE_RATE * 1000 - audioMs + ms;
        post("utterance", { source, text, ms, audioMs, rtf: ms / audioMs, lagMs, offsetMs: segment.start / SAMPLE_RATE * 1000 });
    }
}

function decode(samples) {
    const stream = recognizer.createStream();
    try {
        stream.acceptWaveform(SAMPLE_RATE, samples);
        recognizer.decode(stream);
        return recognizer.getResult(stream).text.trim();
    } finally {
        stream.free();
    }
}

async function deleteModel(model) {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(model.id, { recursive: true }).catch(() => {});
    post("deleted", { model: model.id });
}

async function modelDirectory(model, create) {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(model.id, { create });
}

function requireRecognizer() {
    if (!recognizer) {
        throw new Error("Load a model first.");
    }
}

function heapMiB() {
    return Math.round(Module.HEAP8.length / 1024 / 1024);
}

function post(type, data) {
    self.postMessage({ type, ...data });
}
