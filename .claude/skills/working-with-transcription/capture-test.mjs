#!/usr/bin/env node
// Plays a sine tone inside Electron and captures it the way the transcription capture window does,
// then reports every break in the tone. The capture worklet is read from capture.ts, so this tests
// the code that ships.
//
//   node capture-test.mjs                         # worklet and the old ScriptProcessor, page busy
//   node capture-test.mjs --capture worklet --load all --seconds 30
//   node capture-test.mjs --stereo                # a left-only tone must arrive at half amplitude
//
//   --capture <worklet|script|both>  default both; "script" is the ScriptProcessorNode capture
//                                    used before the worklet, kept as the known-bad reference
//   --load <none|jank|block|burn|all>  default jank:
//                                    jank   the capture page busy 300 ms of every 500 ms
//                                    block  Electron's main process blocked 150 ms every second
//                                    burn   every CPU core busy in worker threads
//   --seconds <n>                    capture length, default 20
//   --stereo                         play the tone on the left channel only
//   --keep <dir>                     also write each capture as <dir>/<capture>-<load>.wav
//   --fused                          run a copy of Electron with the fuses of packaged builds
//                                    (flip-fuses.ts), which the npm binary lacks
//
// Runs Electron the way scripts/electron-start.mts does (Nix-aware) and clears
// ELECTRON_RUN_AS_NODE, which a VS Code terminal sets and which turns Electron into plain Node.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseArgs } from "./recordings.mjs";

const RATE = 16000;
const CHUNK_SAMPLES = 4096;
const TONE_HZ = 440;
const AMPLITUDE = 0.5;
const REPO = path.resolve(import.meta.dirname, "../../..");
const CAPTURE_TS = path.join(REPO, "apps/desktop/src/services/transcription/capture.ts");
const SELF = fileURLToPath(import.meta.url);

// No top-level await: in an ESM entry it holds back Electron's "ready" event.
const run = process.versions.electron
    ? runInElectron(JSON.parse(process.env.CAPTURE_TEST_CONFIG ?? "{}"))
    : launch();
run.catch((e) => {
    console.error(e);
    process.exit(1);
});

async function launch() {
    const { options } = parseArgs(process.argv.slice(2), { flags: [ "stereo", "fused" ] });
    const captures = (options.capture ?? "both") === "both" ? [ "worklet", "script" ] : [ options.capture ];
    const load = options.load ?? "jank";
    const seconds = Number(options.seconds ?? 20);
    const { getElectronPath, getNixLdLibraryPath, isNixOS } = await import(pathToFileURL(path.join(REPO, "scripts/utils.mts")).href);
    const env = { ...process.env, LD_LIBRARY_PATH: isNixOS() ? getNixLdLibraryPath() : process.env.LD_LIBRARY_PATH };
    delete env.ELECTRON_RUN_AS_NODE;
    // The npm package exports its binary's path; `getElectronPath()` names the command on PATH,
    // which only `pnpm run` provides.
    const electron = isNixOS()
        ? getElectronPath()
        : createRequire(path.join(REPO, "apps/desktop/package.json"))("electron");
    const binary = options.fused ? await getFusedElectron(electron) : electron;

    console.log(`${seconds} s of a ${TONE_HZ} Hz tone${options.stereo ? " (left channel only)" : ""}, load: ${load}\n`);
    for (const capture of captures) {
        const config = { capture, load, seconds, stereo: !!options.stereo, keep: options.keep ?? null };
        const output = execFileSync(binary, [ SELF, "--no-sandbox" ], {
            env: { ...env, CAPTURE_TEST_CONFIG: JSON.stringify(config) },
            encoding: "utf8",
            stdio: [ "ignore", "pipe", "pipe" ],
            timeout: (seconds + 60) * 1000
        });
        const line = output.split("\n").find((l) => l.startsWith("RESULT "));
        if (!line) {
            console.error(output);
            process.exit(1);
        }
        const result = JSON.parse(line.slice("RESULT ".length));
        if (!result.chunks) {
            console.error(`${capture.padEnd(8)} captured nothing\n${output}`);
            process.exit(1);
        }
        const verdict = result.breaks === 0 ? "clean" : `${result.breaks} break(s)`;
        console.log(`${capture.padEnd(8)} ${verdict.padEnd(12)} ${result.breaksAtChunkStart} at a chunk start; `
            + `captured ${result.capturedSeconds} s in ${result.chunks} chunks; amplitude ${result.amplitude}`
            + (result.firstBreaks.length ? `\n         first: ${result.firstBreaks.join(", ")}` : ""));
    }
}

/**
 * Copies Electron's distribution to the temp directory and flips the fuses packaged builds carry
 * on the copy, the way the Flathub build does. Packaged builds differ from development in them:
 * `GrantFileProtocolExtraPrivileges` off, for one, changes what a `file://` page can load.
 */
async function getFusedElectron(electron) {
    const distDir = path.join(path.dirname(createRequire(import.meta.url).resolve("electron/package.json")), "dist");
    const copyDir = path.join(os.tmpdir(), "trilium-fused-electron");
    fs.rmSync(copyDir, { recursive: true, force: true });
    fs.cpSync(distDir, copyDir, { recursive: true, verbatimSymlinks: true });
    const binary = path.join(copyDir, path.relative(distDir, electron));

    const flipFusesScript = path.join(REPO, "apps/desktop/electron-forge/flip-fuses.ts");
    const { FUSES } = await import(pathToFileURL(flipFusesScript).href);
    const { flipFuses } = await import("@electron/fuses");
    await flipFuses(binary, { ...FUSES, resetAdHocDarwinSignature: process.platform === "darwin" });
    return binary;
}

async function runInElectron(config) {
    const { app, BrowserWindow, ipcMain } = await import("electron");
    const source = fs.readFileSync(CAPTURE_TS, "utf8");
    const processor = /const CAPTURE_PROCESSOR = `([\s\S]*?)`;/.exec(source)?.[1];
    if (!processor) {
        throw new Error(`No CAPTURE_PROCESSOR in ${CAPTURE_TS}.`);
    }

    const chunks = [];
    ipcMain.on("samples", (_event, samples) => chunks.push(samples));

    await app.whenReady();
    const pagePath = path.join(os.tmpdir(), `trilium-capture-test-${process.pid}.html`);
    fs.writeFileSync(pagePath, buildPage(config, processor));
    // The same window as createCaptureWindow() in capture.ts.
    const window = new BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false,
            autoplayPolicy: "no-user-gesture-required",
            backgroundThrottling: false,
            offscreen: true
        }
    });
    window.webContents.on("console-message", ({ message }) => {
        if (message.startsWith("failed")) {
            console.log(message);
        }
    });
    await window.loadFile(pagePath);

    if (config.load === "block" || config.load === "all") {
        setInterval(() => {
            const end = Date.now() + 150;
            while (Date.now() < end) { /* block the main process */ }
        }, 1000);
    }
    if (config.load === "burn" || config.load === "all") {
        const { Worker } = await import("node:worker_threads");
        for (let i = 0; i < os.availableParallelism(); i++) {
            new Worker("for (;;) {}", { eval: true });
        }
    }

    await new Promise((resolve) => setTimeout(resolve, config.seconds * 1000));
    const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
    }
    fs.rmSync(pagePath, { force: true });
    if (config.keep) {
        fs.mkdirSync(config.keep, { recursive: true });
        writeWav(path.join(config.keep, `${config.capture}-${config.load}.wav`), samples);
    }
    console.log(`RESULT ${JSON.stringify({ chunks: chunks.length, ...analyze(samples) })}`);
    app.exit(0);
}

/**
 * A 48 kHz context plays the tone into a MediaStream, as a sound card would, and a 16 kHz context
 * captures that stream with the options pipe() in capture.ts uses.
 */
function buildPage(config, processor) {
    const page = function () {
        const { ipcRenderer } = require("electron");
        const config = CONFIG;

        async function start() {
            const device = new AudioContext({ sampleRate: 48000 });
            const tone = device.createOscillator();
            tone.frequency.value = TONE_HZ;
            const gain = device.createGain();
            gain.gain.value = AMPLITUDE;
            const output = device.createMediaStreamDestination();
            if (config.stereo) {
                const merger = device.createChannelMerger(2);
                tone.connect(gain).connect(merger, 0, 0);
                merger.connect(output);
            } else {
                tone.connect(gain).connect(output);
            }
            tone.start();

            const context = new AudioContext({ sampleRate: RATE });
            const source = context.createMediaStreamSource(output.stream);
            if (config.capture === "script") {
                const node = context.createScriptProcessor(CHUNK_SAMPLES, 1, 1);
                node.onaudioprocess = (e) => ipcRenderer.send("samples", e.inputBuffer.getChannelData(0).slice());
                source.connect(node);
                node.connect(context.destination);
            } else {
                await context.audioWorklet.addModule(
                    "data:text/javascript;charset=utf-8," + encodeURIComponent(PROCESSOR));
                const node = new AudioWorkletNode(context, "chunk-collector", {
                    numberOfInputs: 1,
                    numberOfOutputs: 0,
                    channelCount: 1,
                    channelCountMode: "explicit",
                    processorOptions: { chunkSamples: CHUNK_SAMPLES, windowSamples: 512 }
                });
                node.port.onmessage = (e) => ipcRenderer.send("samples", e.data);
                source.connect(node);
            }

            if (config.load === "jank" || config.load === "all") {
                setInterval(() => {
                    const end = performance.now() + 300;
                    while (performance.now() < end) { /* keep the page busy */ }
                }, 500);
            }
        }
        start().catch((e) => console.log(`failed: ${e}`));
    };
    const script = `(${page})()`
        .replaceAll("CONFIG", JSON.stringify(config))
        .replaceAll("PROCESSOR", JSON.stringify(processor))
        .replaceAll("TONE_HZ", String(TONE_HZ))
        .replaceAll("AMPLITUDE", String(AMPLITUDE))
        .replaceAll("CHUNK_SAMPLES", String(CHUNK_SAMPLES))
        .replaceAll("RATE", String(RATE));
    return `<!DOCTYPE html><script>${script}</script>`;
}

/**
 * A pure sine obeys x[n] = 2·cos(ω)·x[n−1] − x[n−2], so the prediction residual is ~0 except where
 * samples were lost, repeated or zeroed. The first second, where the resampler settles, is skipped.
 */
function analyze(samples) {
    const c = 2 * Math.cos(2 * Math.PI * TONE_HZ / RATE);
    const breaks = [];
    let sumSquares = 0;
    for (let n = RATE + 2; n < samples.length; n++) {
        sumSquares += samples[n] * samples[n];
        const residual = Math.abs(samples[n] - c * samples[n - 1] + samples[n - 2]);
        if (residual > 0.01 && (!breaks.length || n - breaks.at(-1) > 4)) {
            breaks.push(n);
        }
    }
    const measured = Math.max(0, samples.length - RATE - 2);
    return {
        capturedSeconds: +(samples.length / RATE).toFixed(3),
        amplitude: +(Math.sqrt(sumSquares / Math.max(1, measured)) * Math.SQRT2).toFixed(3),
        breaks: breaks.length,
        breaksAtChunkStart: breaks.filter((n) => n % CHUNK_SAMPLES <= 2).length,
        firstBreaks: breaks.slice(0, 6).map((n) => `${(n / RATE).toFixed(3)} s (+${n % CHUNK_SAMPLES})`)
    };
}

function writeWav(file, samples) {
    const data = Buffer.alloc(44 + samples.length * 2);
    data.write("RIFF", 0);
    data.writeUInt32LE(36 + samples.length * 2, 4);
    data.write("WAVEfmt ", 8);
    data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20);
    data.writeUInt16LE(1, 22);
    data.writeUInt32LE(RATE, 24);
    data.writeUInt32LE(RATE * 2, 28);
    data.writeUInt16LE(2, 32);
    data.writeUInt16LE(16, 34);
    data.write("data", 36);
    data.writeUInt32LE(samples.length * 2, 40);
    for (const [ i, v ] of samples.entries()) {
        data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
    }
    fs.writeFileSync(file, data);
}
