#!/usr/bin/env node
// Checks a development recording's WAVs for capture damage: breaks at the 4096-sample chunk
// boundaries, dips, clipping and runs of digital silence.
//
//   node capture-check.mjs [recording dir | latest]
//
// The boundary test compares the step between neighbouring samples at each chunk boundary with
// the steps just before and after it, during audible sound. A capture that joins its chunks
// cleanly scores about the same at the boundary as one sample later (~1.0–1.3); one that corrupts
// the start of a chunk scores about twice that.
//
// A dip is a 10 ms window that falls to near silence between loud stretches and comes back within
// tens of milliseconds. One alone can be a stop consonant; many in a minute are audio the capture
// lost and Chromium faded over. Normal speech gives a handful per meeting; the loopback capture
// of a loaded machine gave up to 18 a minute. The worst minute is printed with the rate.

import fs from "node:fs";
import path from "node:path";

import { parseArgs, resolveRecording } from "./recordings.mjs";

const CHUNK_SAMPLES = 4096;
const RATE = 16000;

const { positional } = parseArgs(process.argv.slice(2));
const recording = resolveRecording(positional[0]);
console.log(recording.directory);
console.log("source       minutes  boundary  control  verdict           dips/min  worst minute  clipped  silent runs ≥ 10 ms");
for (const [ source, { file } ] of Object.entries(recording.manifest.sources)) {
    const samples = readPcm(path.join(recording.directory, file));
    const boundary = stepRatio(samples, 0);
    const control = stepRatio(samples, 1);
    const isBroken = boundary.ratio > 1.4 && boundary.ratio > control.ratio * 1.25;
    const dips = countDipsPerMinute(samples);
    const worst = dips.reduce((best, count, minute) => count > dips[best] ? minute : best, 0);
    const total = dips.reduce((sum, count) => sum + count, 0);
    console.log([
        source.padEnd(12),
        (samples.length / RATE / 60).toFixed(1).padStart(7),
        boundary.ratio.toFixed(2).padStart(9),
        control.ratio.toFixed(2).padStart(8),
        (boundary.count < 100 ? "too little sound" : isBroken ? "chunk breaks" : "clean").padEnd(16),
        (total / Math.max(1, dips.length)).toFixed(2).padStart(8),
        (dips.length ? `${dips[worst]} at ${worst}:00` : "").padStart(12),
        String(countClipped(samples)).padStart(8),
        String(countSilentRuns(samples)).padStart(8)
    ].join("  "));
}

function readPcm(file) {
    const buffer = fs.readFileSync(file);
    const dataOffset = buffer.indexOf("data") + 8;
    return new Int16Array(buffer.buffer, buffer.byteOffset + dataOffset, (buffer.length - dataOffset) >> 1);
}

/** The mean ratio of the step at each `phase` past a chunk boundary to the steps around it. */
function stepRatio(samples, phase) {
    let sum = 0;
    let count = 0;
    for (let i = CHUNK_SAMPLES + phase; i + 1 < samples.length; i += CHUNK_SAMPLES) {
        if (Math.abs(samples[i - 2]) + Math.abs(samples[i + 1]) < 600) {
            continue;
        }
        const step = Math.abs(samples[i] - samples[i - 1]);
        const around = (Math.abs(samples[i - 1] - samples[i - 2]) + Math.abs(samples[i + 1] - samples[i])) / 2;
        sum += step / (around + 1);
        count++;
    }
    return { ratio: count ? sum / count : 0, count };
}

/** Dips per minute: a 10 ms window below RMS 30 entered from, and left for, RMS above 1500. */
function countDipsPerMinute(samples) {
    const window = RATE / 100;
    const levels = [];
    for (let start = 0; start + window <= samples.length; start += window) {
        let sum = 0;
        for (let i = start; i < start + window; i++) {
            sum += samples[i] * samples[i];
        }
        levels.push(Math.sqrt(sum / window));
    }
    const perMinute = new Array(Math.ceil(samples.length / RATE / 60)).fill(0);
    for (let i = 5; i < levels.length - 5; i++) {
        const before = (levels[i - 5] + levels[i - 4] + levels[i - 3]) / 3;
        const after = (levels[i + 3] + levels[i + 4] + levels[i + 5]) / 3;
        if (before > 1500 && after > 1500 && levels[i] < 30 && levels[i - 1] >= 30) {
            perMinute[Math.floor(i * window / RATE / 60)]++;
        }
    }
    return perMinute;
}

function countClipped(samples) {
    let clipped = 0;
    for (const sample of samples) {
        if (sample >= 32767 || sample <= -32768) {
            clipped++;
        }
    }
    return clipped;
}

function countSilentRuns(samples) {
    let runs = 0;
    let length = 0;
    for (const sample of samples) {
        if (sample === 0) {
            length++;
            continue;
        }
        if (length >= RATE / 100) {
            runs++;
        }
        length = 0;
    }
    return runs;
}
