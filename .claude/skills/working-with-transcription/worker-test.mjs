#!/usr/bin/env node
// Runs a recording's audio through the real transcription process inside Electron: the main
// process starts it with TranscriptionWorker (worker_client.ts), and a hidden page posts the WAV
// to it through a MessagePort in 4096-sample chunks, as the capture page does. Reports the engine's
// load time, what came back, how long stopping took, and the main process's event-loop lag
// meanwhile, which is the point of running the engine out of process.
//
//   node worker-test.mjs [recording dir | latest] [--source system] [--seconds 120] [--speed 4]
//
//   --source <name>   which WAV of the recording to play, default system
//   --seconds <n>     how much of it, default 120
//   --speed <n>       how much faster than real time to post it, default 4
//   --model <dir>     the Parakeet directory, default the app's download of the full-precision
//                     model, else of the int8 one; full precision when it holds encoder.weights
//
// Silero VAD and TitaNet are read from the app's downloads, in apps/desktop/data/resources.
//   --out <file>      writes the utterances there, in the transcript format
//
// Like `pnpm desktop:start`, it loads the TypeScript through NODE_OPTIONS="--import tsx", which
// the utility process inherits.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
    findResource, MODEL_RESOURCES, parseArgs, requireResource, resolveRecording
} from "./recordings.mjs";

const REPO = path.resolve(import.meta.dirname, "../../..");
const DESKTOP = path.join(REPO, "apps/desktop");
const CHUNK_SAMPLES = 4096;
const RATE = 16000;
const SELF = fileURLToPath(import.meta.url);

// No top-level await: in an ESM entry it holds back Electron's "ready" event.
const run = process.versions.electron
    ? runInElectron(JSON.parse(process.env.WORKER_TEST_CONFIG ?? "{}"))
    : launch();
run.catch((e) => {
    console.error(e);
    process.exit(1);
});

async function launch() {
    const { positional, options } = parseArgs(process.argv.slice(2));
    const recording = resolveRecording(positional[0]);
    const source = options.source ?? "system";
    const file = recording.manifest.sources[source]?.file;
    if (!file) {
        throw new Error(`${recording.directory} has no ${source} source.`);
    }
    const config = {
        wav: path.join(recording.directory, file),
        source,
        seconds: Number(options.seconds ?? 120),
        speed: Number(options.speed ?? 4),
        model: path.resolve(options.model
            ?? findResource(MODEL_RESOURCES.fp32) ?? requireResource(MODEL_RESOURCES.int8)),
        vad: path.join(requireResource(MODEL_RESOURCES.vad), "silero_vad.onnx"),
        speaker: findResource(MODEL_RESOURCES.speaker),
        out: options.out ? path.resolve(options.out) : null
    };
    const { getElectronPath, getNixLdLibraryPath, isNixOS } = await import(pathToFileURL(path.join(REPO, "scripts/utils.mts")).href);
    const env = {
        ...process.env,
        LD_LIBRARY_PATH: isNixOS() ? getNixLdLibraryPath() : process.env.LD_LIBRARY_PATH,
        NODE_OPTIONS: "--import tsx",
        WORKER_TEST_CONFIG: JSON.stringify(config)
    };
    delete env.ELECTRON_RUN_AS_NODE;

    console.log(`${config.seconds} s of ${config.wav}, ${config.speed}× real time\n`);
    // Off NixOS, getElectronPath() returns the bare `electron` command, which only a shell
    // resolves; the package itself exports the binary's path.
    const electron = isNixOS()
        ? getElectronPath()
        : createRequire(path.join(DESKTOP, "package.json"))("electron");
    const output = execFileSync(electron, [ SELF, "--no-sandbox" ], {
        cwd: DESKTOP,
        env,
        encoding: "utf8",
        stdio: [ "ignore", "pipe", "pipe" ],
        timeout: (config.seconds / config.speed + 240) * 1000
    });
    const line = output.split("\n").find((l) => l.startsWith("RESULT "));
    if (!line) {
        console.error(output);
        process.exit(1);
    }
    const result = JSON.parse(line.slice("RESULT ".length));
    if (result.error) {
        console.error(`Failed: ${result.error}`);
        process.exit(1);
    }
    console.log(`engine ready after ${result.readyMs} ms; ${result.chunks} chunks posted`);
    console.log(`${result.utterances} utterances, ${result.words} words; stop took ${result.stopMs} ms; `
        + `process exited: ${result.exited}`);
    console.log(`main event-loop lag: p50 ${result.lag.p50} ms, p99 ${result.lag.p99} ms, max ${result.lag.max} ms`);
    console.log(`pending reports: ${result.pendingReports}; log lines: ${result.logLines}`);
    for (const text of result.sample) {
        console.log(`  ${text}`);
    }
}

async function runInElectron(config) {
    const { app, BrowserWindow, MessageChannelMain } = await import("electron");
    const { TranscriptionWorker } = await import(
        pathToFileURL(path.join(DESKTOP, "src/services/transcription/worker_client.ts")).href);
    await app.whenReady();

    const utterances = [];
    let pendingReports = 0;
    let logLines = 0;
    const lags = [];
    let last = performance.now();
    const lagTimer = setInterval(() => {
        const now = performance.now();
        lags.push(now - last - 10);
        last = now;
    }, 10);

    let exited = false;
    const worker = new TranscriptionWorker({
        onUtterance: (utterance) => utterances.push(utterance),
        onPendingChanged: () => pendingReports++,
        onUnexpectedExit: (code) => finish({ error: `the process exited with code ${code}` }),
        log: { info: () => logLines++, error: (message) => console.log(`worker error: ${message}`) }
    });
    const startedAt = performance.now();
    const models = {
        recognizer: {
            directory: config.model,
            precision: fs.existsSync(path.join(config.model, "encoder.weights")) ? "fp32" : "int8"
        },
        vad: config.vad,
        speaker: config.speaker && path.join(config.speaker, "nemo_en_titanet_small.onnx")
    };
    await worker.start({ noteId: "worker-test", models, recordingDirectory: null });
    const readyMs = Math.round(performance.now() - startedAt);

    const pagePath = path.join(os.tmpdir(), `trilium-worker-test-${process.pid}.html`);
    fs.writeFileSync(pagePath, buildPage(config));
    const window = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
    });
    const posted = new Promise((resolve) => {
        window.webContents.on("console-message", ({ message }) => {
            if (message.startsWith("posted ")) {
                resolve(Number(message.slice("posted ".length)));
            }
        });
    });
    await window.loadFile(pagePath);
    const { port1, port2 } = new MessageChannelMain();
    worker.connectCapture(port2);
    window.webContents.postMessage("transcription-capture-port", null, [ port1 ]);
    const chunks = await posted;

    const stopAt = performance.now();
    await worker.stop();
    const stopMs = Math.round(performance.now() - stopAt);
    exited = true;
    fs.rmSync(pagePath, { force: true });
    if (config.out) {
        fs.writeFileSync(config.out, JSON.stringify({ version: 1, startedAt: Date.now(), utterances }));
    }
    finish({
        readyMs,
        chunks,
        utterances: utterances.length,
        words: utterances.reduce((n, u) => n + u.text.split(/\s+/).length, 0),
        stopMs,
        exited,
        pendingReports,
        logLines,
        lag: percentiles(lags),
        sample: utterances.slice(0, 4).map((u) => `${(u.offsetMs / 1000).toFixed(1)} s `
            + `${u.speaker ? `[${u.speaker}] ` : ""}${u.text}`)
    });

    function finish(result) {
        clearInterval(lagTimer);
        console.log(`RESULT ${JSON.stringify(result)}`);
        app.exit(0);
    }
}

/** Posts the WAV's samples to the port as the capture page does, `speed` times faster than real time. */
function buildPage(config) {
    const page = function () {
        const { ipcRenderer } = require("electron");
        const fs = require("fs");
        const config = CONFIG;
        ipcRenderer.once("transcription-capture-port", async (event) => {
            const port = event.ports[0];
            const buffer = fs.readFileSync(config.wav);
            const offset = buffer.indexOf("data") + 8;
            const pcm = new Int16Array(buffer.buffer, buffer.byteOffset + offset,
                Math.min((buffer.length - offset) >> 1, RATE * config.seconds));
            let chunks = 0;
            for (let i = 0; i + CHUNK_SAMPLES <= pcm.length; i += CHUNK_SAMPLES) {
                const samples = new Float32Array(CHUNK_SAMPLES);
                for (let j = 0; j < CHUNK_SAMPLES; j++) {
                    samples[j] = pcm[i + j] / 32768;
                }
                port.postMessage({ source: config.source, samples });
                chunks++;
                await new Promise((resolve) => setTimeout(resolve, CHUNK_SAMPLES / RATE * 1000 / config.speed));
            }
            port.postMessage({ end: true });
            console.log(`posted ${chunks}`);
        });
    };
    const script = `(${page})()`
        .replaceAll("CONFIG", JSON.stringify(config))
        .replaceAll("CHUNK_SAMPLES", String(CHUNK_SAMPLES))
        .replaceAll("RATE", String(RATE));
    return `<!DOCTYPE html><script>${script}</script>`;
}

function percentiles(values) {
    const sorted = [ ...values ].sort((a, b) => a - b);
    const at = (fraction) => +(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0).toFixed(1);
    return { p50: at(0.5), p99: at(0.99), max: at(1) };
}
