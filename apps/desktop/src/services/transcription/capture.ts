import type { TranscriptSource } from "@triliumnext/commons";
import { getLog } from "@triliumnext/core";
import { app, BrowserWindow, type MessagePortMain, session } from "electron";
import fs from "fs";
import path from "path";

import { SAMPLE_RATE } from "./protocol";

const PORT_CHANNEL = "transcription-capture-port";
const SOURCE_ENDED_CHANNEL = "transcription-source-ended";

export interface CaptureWindowOptions {
    /**
     * Called once when capturing stops on its own: the page crashed or reloaded, or every source
     * ended (a device was unplugged, the system audio went away). Not called after
     * {@link CaptureWindow.stop}.
     */
    onLost(reason: string): void;
}

/** Samples per message. A multiple of {@link VAD_WINDOW_SAMPLES}. */
const CHUNK_SAMPLES = 4096;

/** `VadSegmenter` drops what does not fill a window, so the last chunk is padded to whole ones. */
const VAD_WINDOW_SAMPLES = 512;

/** How long {@link CaptureWindow.stop} waits for the page to post what it still holds. */
const FINISH_TIMEOUT_MS = 1000;

/** The page call that starts each source. */
const SOURCE_STARTERS = [
    [ "microphone", "run(captureMicrophone)" ],
    [ "system", "run(captureSystemAudio)" ]
] as const;

/**
 * Captures the default microphone and the system audio output in a hidden window, which posts
 * them to a port as `CaptureChunk`s of {@link CHUNK_SAMPLES} mono samples. The samples never
 * pass through the main process.
 */
export class CaptureWindow {
    private window: BrowserWindow | null = null;
    private readonly running = new Set<TranscriptSource>();
    private isLost = false;

    constructor(private readonly options: CaptureWindowOptions) {}

    /**
     * Starts every source it can, posting to `port`, and returns the ones that run.
     *
     * @throws when no source could start.
     */
    async start(port: MessagePortMain) {
        const window = await createCaptureWindow();
        this.window = window;
        window.webContents.on("render-process-gone", (_event, { reason }) =>
            this.lose(`the capture page ended (${reason})`));
        window.webContents.on("did-start-navigation", ({ isMainFrame, isSameDocument }) => {
            if (isMainFrame && !isSameDocument) {
                this.lose("the capture page reloaded");
            }
        });
        window.webContents.ipc.on(SOURCE_ENDED_CHANNEL, (_event, source: TranscriptSource) => {
            getLog().error(`Transcription: the ${source} source ended.`);
            this.running.delete(source);
            if (!this.running.size) {
                this.lose("every audio source ended");
            }
        });
        window.webContents.postMessage(PORT_CHANNEL, null, [ port ]);

        const sources: TranscriptSource[] = [];
        for (const [ source, call ] of SOURCE_STARTERS) {
            try {
                // getDisplayMedia() requires a user gesture, which the hidden window only gets
                // this way.
                const result: StarterResult =
                    await window.webContents.executeJavaScript(call, true);
                if ("error" in result) {
                    throw new Error(result.error);
                }
                getLog().info(`Transcription: capturing ${source} from ${result.tracks}.`);
                sources.push(source);
                this.running.add(source);
            } catch (e) {
                const message = (e as Error)?.message ?? e;
                getLog().error(`Transcription: ${source} unavailable: ${message}`);
            }
        }

        if (!sources.length) {
            this.stop();
            throw new Error("No audio source could be captured.");
        }
        return sources;
    }

    /**
     * Posts what the worklets still hold, then an end marker the transcription process waits for,
     * and closes the window. Gives up on the page after {@link FINISH_TIMEOUT_MS}.
     */
    async stop() {
        const window = this.window;
        this.window = null;
        this.running.clear();
        if (!window || window.isDestroyed()) {
            return;
        }
        try {
            await Promise.race([
                window.webContents.executeJavaScript("finishCapture()"),
                new Promise((_resolve, reject) => setTimeout(
                    () => reject(new Error("timed out")), FINISH_TIMEOUT_MS))
            ]);
        } catch (e) {
            const message = (e as Error)?.message ?? e;
            getLog().error(`Transcription: finishing the capture failed: ${message}`);
        } finally {
            if (!window.isDestroyed()) {
                window.destroy();
            }
        }
    }

    private lose(reason: string) {
        if (this.window && !this.isLost) {
            this.isLost = true;
            this.options.onLost(reason);
        }
    }
}

/**
 * What `run()` in {@link CAPTURE_PAGE} resolves to. The page reports a failure as text because
 * `executeJavaScript()` rejects with an object that has lost the `DOMException`'s message.
 */
type StarterResult = { tracks: string } | { error: string };

/**
 * The window runs only {@link CAPTURE_PAGE}, a local file, so it gets Node integration to reach
 * `ipcRenderer`, which delivers the port, without a preload. Its in-memory session grants the
 * microphone and screen capture and nothing else; every screen capture request gets the window
 * itself plus the system audio.
 */
async function createCaptureWindow() {
    const captureSession = session.fromPartition("transcription");
    const isAllowed = (permission: string) =>
        permission === "media" || permission === "display-capture";
    captureSession.setPermissionRequestHandler((_webContents, permission, callback) =>
        callback(isAllowed(permission)));
    captureSession.setPermissionCheckHandler((_webContents, permission) => isAllowed(permission));
    // Capturing the requesting frame instead of a screen keeps the Wayland screen-cast portal
    // out of the request.
    captureSession.setDisplayMediaRequestHandler((request, callback) => {
        callback({ video: request.frame ?? undefined, audio: "loopback" });
    });

    const pagePath = path.join(app.getPath("temp"), "trilium-transcription.html");
    fs.writeFileSync(pagePath, CAPTURE_PAGE);

    const window = new BrowserWindow({
        show: false,
        webPreferences: {
            session: captureSession,
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false,
            autoplayPolicy: "no-user-gesture-required",
            backgroundThrottling: false,
            // Without hardware acceleration, a hidden window renders no frames, so the
            // self-capture in CAPTURE_PAGE times out waiting for its video source.
            offscreen: true
        }
    });
    window.webContents.on("console-message", ({ message }) =>
        getLog().info(`Transcription (capture): ${message}`));
    await window.loadFile(pagePath);
    return window;
}

/**
 * The audio worklet that collects a source into chunks of `processorOptions.chunkSamples`. It runs
 * on the audio rendering thread, where a busy page cannot delay it and corrupt the start of a
 * chunk. A `"flush"` message posts the partial chunk, padded with silence to whole
 * `processorOptions.windowSamples`, then `"flushed"`.
 * `.claude/skills/working-with-transcription/capture-test.mjs` reads it from this file.
 */
export const CAPTURE_PROCESSOR = `
class ChunkCollector extends AudioWorkletProcessor {
    constructor({ processorOptions }) {
        super();
        this.chunkSamples = processorOptions.chunkSamples;
        this.windowSamples = processorOptions.windowSamples;
        this.chunk = new Float32Array(this.chunkSamples);
        this.filled = 0;
        this.port.onmessage = () => this.flush();
    }

    flush() {
        const length = Math.ceil(this.filled / this.windowSamples) * this.windowSamples;
        if (length) {
            this.port.postMessage(this.chunk.slice(0, length));
            this.chunk = new Float32Array(this.chunkSamples);
            this.filled = 0;
        }
        this.port.postMessage("flushed");
    }

    process(inputs) {
        const input = inputs[0][0];
        let offset = 0;
        while (input && offset < input.length) {
            const count = Math.min(input.length - offset, this.chunkSamples - this.filled);
            this.chunk.set(input.subarray(offset, offset + count), this.filled);
            this.filled += count;
            offset += count;
            if (this.filled === this.chunkSamples) {
                this.port.postMessage(this.chunk, [ this.chunk.buffer ]);
                this.chunk = new Float32Array(this.chunkSamples);
                this.filled = 0;
            }
        }
        return true;
    }
}
registerProcessor("chunk-collector", ChunkCollector);
`;

const CAPTURE_PAGE = `<!DOCTYPE html>
<script>
const { ipcRenderer } = require("electron");
const portReceived = new Promise((resolve) =>
    ipcRenderer.once("${PORT_CHANNEL}", (e) => resolve(e.ports[0])));
const context = new AudioContext({ sampleRate: ${SAMPLE_RATE} });
// A data: URL, since packaged builds turn off GrantFileProtocolExtraPrivileges, which leaves this
// file:// page an opaque origin that cannot load a blob: worklet.
const processorLoaded = context.audioWorklet.addModule(${JSON.stringify(
    `data:text/javascript;charset=utf-8,${encodeURIComponent(CAPTURE_PROCESSOR)}`)});

const flushes = [];

async function pipe(source, media) {
    const [ port ] = await Promise.all([ portReceived, processorLoaded ]);
    const collector = new AudioWorkletNode(context, "chunk-collector", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: "explicit",
        processorOptions: { chunkSamples: ${CHUNK_SAMPLES}, windowSamples: ${VAD_WINDOW_SAMPLES} }
    });
    let onFlushed = () => {};
    // Copied, not transferred: a MessagePortMain receives a message with a transferred buffer
    // as null.
    collector.port.onmessage = (e) => e.data === "flushed"
        ? onFlushed()
        : port.postMessage({ source, samples: e.data });
    flushes.push(() => new Promise((resolve) => {
        onFlushed = resolve;
        collector.port.postMessage("flush");
    }));
    context.createMediaStreamSource(media).connect(collector);
}

async function finishCapture() {
    await Promise.all(flushes.map((flush) => flush()));
    (await portReceived).postMessage({ end: true });
}

async function run(starter) {
    try {
        return { tracks: await starter() };
    } catch (e) {
        return { error: e instanceof Error ? e.name + ": " + e.message : String(e) };
    }
}

function describe(tracks) {
    return tracks.map((track) => track.label).join(", ");
}

function reportEnd(source, tracks) {
    let isReported = false;
    for (const track of tracks) {
        track.addEventListener("ended", () => {
            if (!isReported) {
                isReported = true;
                ipcRenderer.send("${SOURCE_ENDED_CHANNEL}", source);
            }
        });
    }
}

async function captureMicrophone() {
    const media = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false }
    });
    reportEnd("microphone", media.getAudioTracks());
    await pipe("microphone", media);
    return describe(media.getAudioTracks());
}

async function captureSystemAudio() {
    const media = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    for (const track of media.getVideoTracks()) {
        track.stop();
    }
    const audioTracks = media.getAudioTracks();
    if (!audioTracks.length) {
        throw new Error("the screen capture has no audio track");
    }
    for (const track of audioTracks) {
        console.log("System track muted=" + track.muted + " settings="
            + JSON.stringify(track.getSettings()));
    }
    reportEnd("system", audioTracks);
    await pipe("system", new MediaStream(audioTracks));
    return describe(audioTracks);
}
</script>`;
