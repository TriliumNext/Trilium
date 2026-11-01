#!/usr/bin/env node
// Compares two transcripts of one development recording, word by word and per source.
//
//   node compare.mjs <recording dir | latest>                 list the transcripts
//   node compare.mjs <recording dir | latest> <A> <B>         compare A with B
//
//   A and B are labels: `live` is transcript.json, any other is transcript.<label>.json. When one
//   of them is `reference` (a transcript corrected by hand), the rate is the other's word error
//   rate against it; otherwise it is how much B differs from A.
//
//   --strict          count casing and punctuation, which are ignored by default
//   --context <n>     words of context around each difference (default 4)
//   --max-hunks <n>   differences listed per source (default 30, 0 for all)

import { listTranscripts, parseArgs, readTranscript, resolveRecording } from "./recordings.mjs";

/** Beyond this many edits the transcripts are unrelated, and the diff would take too much memory. */
const MAX_EDITS = 20_000;

const { positional, options } = parseArgs(process.argv.slice(2), { flags: [ "strict" ] });
const recording = resolveRecording(positional[0]);
const [ labelA, labelB ] = positional.slice(1);

if (!labelA) {
    listAll();
} else if (!labelB) {
    console.error("Give two labels to compare, or none to list the transcripts.");
    process.exit(1);
} else {
    compare(labelA, labelB);
}

function listAll() {
    console.log(`Recording ${recording.directory}\n`);
    for (const [ label, transcript ] of listTranscripts(recording.directory)) {
        const counts = Object.entries(wordsBySource(transcript))
            .map(([ source, words ]) => `${source} ${words.length} words`).join(", ");
        console.log(`${label.padEnd(16)} ${transcript.utterances.length} utterances; ${counts}`);
        console.log(`${"".padEnd(16)} ${describeEngine(transcript)}`);
    }
}

function compare(a, b) {
    const transcriptA = readTranscript(recording.directory, a);
    const transcriptB = readTranscript(recording.directory, b);
    // A reference is the ground truth, so it goes first: the error rate counts against its words.
    const [ refLabel, hypLabel, ref, hyp ] = b === "reference"
        ? [ b, a, transcriptB, transcriptA ]
        : [ a, b, transcriptA, transcriptB ];
    const rateName = refLabel === "reference" ? "WER" : "differs";

    console.log(`${hypLabel} against ${refLabel}`
        + `${options.strict ? "" : " (ignoring casing and punctuation)"}\n`);
    for (const [ label, transcript ] of [ [ refLabel, ref ], [ hypLabel, hyp ] ]) {
        console.log(`${label}: ${describeEngine(transcript)}`);
    }

    const refWords = wordsBySource(ref);
    const hypWords = wordsBySource(hyp);
    const sources = [ ...new Set([ ...Object.keys(refWords), ...Object.keys(hypWords) ]) ].sort();
    const results = sources.map((source) => ({
        source, ...diffWords(refWords[source] ?? [], hypWords[source] ?? [])
    }));

    console.log(`\n${"source".padEnd(12)}${"words".padStart(8)}${"sub".padStart(6)}`
        + `${"del".padStart(6)}${"ins".padStart(6)}${rateName.padStart(10)}`);
    for (const { source, refCount, substitutions, deletions, insertions } of results) {
        const rate = refCount ? (substitutions + deletions + insertions) / refCount : 0;
        console.log(`${source.padEnd(12)}${String(refCount).padStart(8)}`
            + `${String(substitutions).padStart(6)}${String(deletions).padStart(6)}`
            + `${String(insertions).padStart(6)}${`${(rate * 100).toFixed(1)}%`.padStart(10)}`);
    }

    const maxHunks = Number(options["max-hunks"] ?? 30);
    for (const { source, hunks } of results) {
        if (!hunks.length) {
            continue;
        }
        console.log(`\n${source} — ${refLabel} [-removed-] ${hypLabel} {+added+}`);
        const shown = maxHunks > 0 ? hunks.slice(0, maxHunks) : hunks;
        for (const hunk of shown) {
            console.log(`  [${formatOffset(hunk.offsetMs)}] ${hunk.text}`);
        }
        if (shown.length < hunks.length) {
            console.log(`  … ${hunks.length - shown.length} more (--max-hunks 0 shows all)`);
        }
    }
}

/** Every word of a transcript per source, with the offset of the utterance it belongs to. */
function wordsBySource(transcript) {
    const words = {};
    for (const { source, offsetMs, text } of transcript.utterances) {
        for (const display of text.split(/\s+/)) {
            const key = options.strict
                ? display
                : display.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
            if (key) {
                (words[source] ??= []).push({ key, display, offsetMs });
            }
        }
    }
    return words;
}

/**
 * Aligns two word lists with Myers' diff and counts the edits. Within a run of changes, deleted
 * and inserted words pair up as substitutions, which approximates a Levenshtein alignment.
 */
function diffWords(ref, hyp) {
    const ops = myersDiff(ref.map((word) => word.key), hyp.map((word) => word.key));
    let substitutions = 0;
    let deletions = 0;
    let insertions = 0;
    const hunks = [];
    const context = Number(options.context ?? 4);

    let i = 0;
    while (i < ops.length) {
        if (ops[i].type === "equal") {
            i++;
            continue;
        }
        const start = i;
        while (i < ops.length && ops[i].type !== "equal") {
            i++;
        }
        const run = ops.slice(start, i);
        const removed = run.filter((op) => op.type === "delete").map((op) => ref[op.index]);
        const added = run.filter((op) => op.type === "insert").map((op) => hyp[op.index]);
        const paired = Math.min(removed.length, added.length);
        substitutions += paired;
        deletions += removed.length - paired;
        insertions += added.length - paired;

        const before = ops.slice(Math.max(0, start - context), start)
            .filter((op) => op.type === "equal")
            .map((op) => ref[op.index].display);
        const nextChange = ops.findIndex((op, index) => index >= i && op.type !== "equal");
        const after = ops.slice(i, Math.min(i + context, nextChange === -1 ? ops.length : nextChange))
            .map((op) => ref[op.index].display);
        const parts = [
            ...before,
            removed.length ? `[-${removed.map((word) => word.display).join(" ")}-]` : "",
            added.length ? `{+${added.map((word) => word.display).join(" ")}+}` : "",
            ...after
        ].filter(Boolean);
        hunks.push({
            offsetMs: (removed[0] ?? added[0]).offsetMs,
            text: parts.join(" ")
        });
    }
    return { refCount: ref.length, substitutions, deletions, insertions, hunks };
}

/**
 * The shortest edit script from `a` to `b`, as `equal`/`delete`/`insert` operations whose `index`
 * points into `a` (equal, delete) or `b` (insert).
 */
function myersDiff(a, b) {
    const n = a.length;
    const m = b.length;
    const max = n + m;
    const offset = max + 1;
    const v = new Int32Array(2 * max + 3);
    // trace[d] holds v for k in [-d - 1, d + 1] before step d, at index k + d + 1.
    const trace = [];
    for (let d = 0; d <= max; d++) {
        if (d > MAX_EDITS) {
            throw new Error(`The transcripts differ by more than ${MAX_EDITS} words.`);
        }
        trace.push(v.slice(offset - d - 1, offset + d + 2));
        for (let k = -d; k <= d; k += 2) {
            let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
                ? v[offset + k + 1]
                : v[offset + k - 1] + 1;
            let y = x - k;
            while (x < n && y < m && a[x] === b[y]) {
                x++;
                y++;
            }
            v[offset + k] = x;
            if (x >= n && y >= m) {
                return backtrack(trace, n, m, a, b);
            }
        }
    }
    return [];
}

function backtrack(trace, n, m) {
    const ops = [];
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d >= 0; d--) {
        const snapshot = trace[d];
        const at = (k) => snapshot[k + d + 1];
        const k = x - y;
        const previousK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
        const previousX = at(previousK);
        const previousY = previousX - previousK;
        while (x > previousX && y > previousY) {
            x--;
            y--;
            ops.push({ type: "equal", index: x });
        }
        if (d > 0) {
            if (x === previousX) {
                ops.push({ type: "insert", index: previousY });
            } else {
                ops.push({ type: "delete", index: previousX });
            }
        }
        x = previousX;
        y = previousY;
    }
    return ops.reverse();
}

function describeEngine(transcript) {
    const replay = transcript.replay;
    if (!replay) {
        return "live, as recorded (settings in recording.json)";
    }
    const recognizer = replay.engine?.recognizer ?? {};
    const parts = [ recognizer.decodingMethod ?? "?" ];
    if (recognizer.maxActivePaths) {
        parts.push(`${recognizer.maxActivePaths} paths`);
    }
    if (replay.hotwords) {
        parts.push(`hotwords ${replay.hotwords}`);
    }
    const vad = replay.engine?.vad ?? {};
    parts.push(`VAD threshold ${vad.threshold}, silence ${vad.minSilenceDuration} s, `
        + `max ${vad.maxSpeechDuration} s`);
    const timings = Object.entries(replay.sources ?? {})
        .filter(([ , stats ]) => stats.segments)
        .map(([ source, stats ]) => `${source} RTF ${stats.rtf.toFixed(3)}`);
    return [ ...parts, ...timings ].join("; ");
}

function formatOffset(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
