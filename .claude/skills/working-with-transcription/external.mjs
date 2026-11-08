#!/usr/bin/env node
// Scores a recording's transcripts against another tool's transcript of the same meeting (a Teams
// or AppFlowy export: one "Name: text" line per turn), and counts glossary terms in each.
//
//   node external.mjs <recording dir | latest> <export.txt> --me <name> [labels…]
//       [--terms "heap/Java heap/STM32"]
//
// Lines spoken by --me are compared with the microphone, every other speaker with the system
// source, as word error rates over the external text, so the other tool's own errors count too:
// only the difference between labels means something. Casing, punctuation, accents and the
// fillers uh, um, mm, hmm, ah, eh, oh are ignored. Without labels, every transcript is scored.

import fs from "node:fs";

import { listTranscripts, parseArgs, readTranscript, resolveRecording } from "./recordings.mjs";

const FILLERS = new Set([ "uh", "um", "mm", "mmhmm", "uhhuh", "hmm", "ah", "oh", "eh" ]);

const { positional, options } = parseArgs(process.argv.slice(2));
const recording = resolveRecording(positional[0]);
const exportFile = positional[1];
if (!exportFile || !options.me) {
    console.error("Usage: node external.mjs <recording> <export.txt> --me <name> [labels…] [--terms a/b]");
    process.exit(1);
}

const reference = { microphone: [], system: [] };
let referenceText = "";
for (const line of fs.readFileSync(exportFile, "utf8").split(/\r?\n/)) {
    const turn = /^([^:]{1,60}):\s*(.*)$/.exec(line);
    if (!turn) {
        continue;
    }
    reference[turn[1].trim() === options.me ? "microphone" : "system"].push(...toWords(turn[2]));
    referenceText += ` ${turn[2]}`;
}
if (!reference.microphone.length) {
    console.error(`No line of ${exportFile} is spoken by "${options.me}".`);
    process.exit(1);
}

const labels = positional.slice(2);
const transcripts = labels.length
    ? new Map(labels.map((label) => [ label, readTranscript(recording.directory, label) ]))
    : listTranscripts(recording.directory);
const terms = (options.terms ?? "").split("/").map((term) => term.trim()).filter(Boolean);

const rows = [ [ "label", "mic WER", "system WER", "utterances", ...terms ] ];
rows.push([ "(external)", "", "", "", ...terms.map((term) => countTerm(referenceText, term)) ]);
for (const [ label, transcript ] of transcripts) {
    const hypothesis = { microphone: [], system: [] };
    for (const utterance of [ ...transcript.utterances ].sort((a, b) => a.offsetMs - b.offsetMs)) {
        hypothesis[utterance.source]?.push(...toWords(utterance.text));
    }
    const text = transcript.utterances.map((utterance) => utterance.text).join(" ");
    rows.push([
        label,
        percent(wordErrorRate(reference.microphone, hypothesis.microphone)),
        percent(wordErrorRate(reference.system, hypothesis.system)),
        transcript.utterances.length,
        ...terms.map((term) => countTerm(text, term))
    ]);
}
const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)));
for (const row of rows) {
    console.log(row.map((cell, column) => column ? String(cell).padStart(widths[column]) : String(cell).padEnd(widths[column])).join("  "));
}

function toWords(text) {
    return text.toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/['’]/g, "")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .split(" ")
        .filter((word) => word && !FILLERS.has(word));
}

function wordErrorRate(ref, hyp) {
    if (!ref.length) {
        return NaN;
    }
    let previous = Int32Array.from({ length: hyp.length + 1 }, (_, j) => j);
    let current = new Int32Array(hyp.length + 1);
    for (let i = 1; i <= ref.length; i++) {
        current[0] = i;
        for (let j = 1; j <= hyp.length; j++) {
            current[j] = Math.min(previous[j] + 1, current[j - 1] + 1,
                previous[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
        }
        [ previous, current ] = [ current, previous ];
    }
    return previous[hyp.length] / ref.length;
}

function countTerm(text, term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu")) ?? []).length;
}

function percent(value) {
    return Number.isNaN(value) ? "—" : `${(value * 100).toFixed(1)}%`;
}
