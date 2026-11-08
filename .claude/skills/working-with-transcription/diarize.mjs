#!/usr/bin/env node
// Labels the utterances of one source of a development recording by speaker, two ways, and times
// both:
//   live     one embedding per utterance as it would arrive, matched against the speakers heard so
//            far (the method that can run during a meeting)
//   offline  sherpa-onnx's whole-recording diarization: pyannote segmentation, embeddings,
//            clustering (the method that needs the finished recording)
//
//   node diarize.mjs <recording dir | latest> [options]
//
//   --source <name>          microphone or system (default system)
//   --transcript <label>     whose utterances to label (default greedy, else live)
//   --embedding <name|file>  titanet (default), campplus, or a model file
//   --mode <live|offline|both>                     (default both)
//   --threshold <n>          live: cosine similarity that joins a known speaker (default 0.5)
//   --min-duration <s>       live: shorter utterances never move a centroid (default 1.5)
//   --new-min <s>            live: only utterances this long start a speaker (default 5)
//   --short-threshold <n>    live: similarity from which a short utterance joins the nearest
//                            speaker (default 0.3)
//   --clusters <n>           offline: the number of speakers, when known
//   --cluster-threshold <n>  offline: clustering threshold otherwise (default 0.5)
//   --threads <n>            threads per model (default 1)
//   --models <dir>           where CAM++ and segmentation.onnx are
//                            (default apps/desktop/data/diarization-models)
//
// Models: TitaNet is the app's download, in apps/desktop/data/resources; CAM++ and
// segmentation.onnx, which only this script uses, go in --models. See SKILL.md, "Speaker
// detection".

import fs from "node:fs";
import path from "node:path";

import {
    listTranscripts, MODEL_RESOURCES, parseArgs, readTranscript, requireResource, resolveRecording
} from "./recordings.mjs";
import { loadSherpa, SAMPLE_RATE } from "./sherpa.mjs";

const DIARIZATION_MODELS_DIR = path.resolve(
    import.meta.dirname, "../../../apps/desktop/data/diarization-models");
/** An utterance whose second speaker talks this long within it counts as a speaker change. */
const CHANGE_SECONDS = 1;

const { positional, options } = parseArgs(process.argv.slice(2));
const recording = resolveRecording(positional[0]);
const sourceName = options.source ?? "system";
const source = recording.manifest.sources[sourceName];
if (!source) {
    fail(`The recording has no ${sourceName} source.`);
}
const transcriptLabel = options.transcript
    ?? (listTranscripts(recording.directory).has("greedy") ? "greedy" : "live");
const mode = options.mode ?? "both";
const threads = Number(options.threads ?? 1);
const modelsDir = options.models ?? DIARIZATION_MODELS_DIR;
const embeddingModel = getEmbeddingModel(options.embedding ?? "titanet");
if (!fs.existsSync(embeddingModel)) {
    fail(`No embedding model at ${embeddingModel}.`);
}

const sherpa = loadSherpa();
const wave = sherpa.readWave(path.join(recording.directory, source.file));
const audioSeconds = wave.samples.length / SAMPLE_RATE;
const utterances = readTranscript(recording.directory, transcriptLabel).utterances
    .filter((utterance) => utterance.source === sourceName)
    .map((utterance) => {
        const startSeconds = (utterance.offsetMs - source.firstSampleOffsetMs) / 1000;
        return { ...utterance, startSeconds, endSeconds: startSeconds + utterance.durationMs / 1000 };
    });

console.log(`${sourceName} of ${path.basename(recording.directory)}: ${audioSeconds.toFixed(1)} s, `
    + `${utterances.length} utterances from "${transcriptLabel}", `
    + `${path.basename(embeddingModel)}, ${threads} thread(s)\n`);

const live = mode !== "offline" ? labelLive() : null;
const offline = mode !== "live" ? labelOffline() : null;

for (const [ index, utterance ] of utterances.entries()) {
    const columns = [ formatSeconds(utterance.startSeconds).padStart(6),
        `${(utterance.durationMs / 1000).toFixed(1)}s`.padStart(6) ];
    if (live) {
        const { speaker, similarity } = live.labels[index];
        columns.push(`${speaker} ${similarity === null ? "" : similarity.toFixed(2)}`.padEnd(10));
    }
    if (offline) {
        const { speaker, change } = offline.labels[index];
        columns.push(`${speaker}${change ? ` +${change}` : ""}`.padEnd(10));
    }
    columns.push(utterance.text.length > 70 ? `${utterance.text.slice(0, 69)}…` : utterance.text);
    console.log(columns.join("  "));
}

console.log("");
for (const [ name, result ] of [ [ "live", live ], [ "offline", offline ] ]) {
    if (!result) {
        continue;
    }
    const speakers = new Set(result.labels.map((label) => label.speaker).filter((s) => s !== "?"));
    console.log(`${name.padEnd(8)} ${speakers.size} speakers; ${result.timing}`);
}
if (live && offline) {
    const changes = offline.labels.filter((label) => label.change).length;
    console.log(`agreement ${(agreement(live.labels, offline.labels) * 100).toFixed(0)}% of speech `
        + `after matching speakers; ${changes} utterance(s) hold a speaker change `
        + `(offline, ≥${CHANGE_SECONDS} s of a second speaker)`);
}

/** One embedding per utterance, in arrival order, matched by cosine similarity to centroids. */
function labelLive() {
    const threshold = Number(options.threshold ?? 0.5);
    const minDuration = Number(options["min-duration"] ?? 1.5);
    const newMin = Number(options["new-min"] ?? 5);
    const shortThreshold = Number(options["short-threshold"] ?? 0.3);
    const loadStarted = performance.now();
    const extractor = new sherpa.SpeakerEmbeddingExtractor({
        model: embeddingModel, numThreads: threads, provider: "cpu"
    });
    const loadMs = performance.now() - loadStarted;

    const centroids = [];
    const labels = [];
    const perUtteranceMs = [];
    const cpuBefore = process.cpuUsage();
    const started = performance.now();
    for (const utterance of utterances) {
        const utteranceStarted = performance.now();
        const embedding = normalize(embed(extractor, utterance));
        perUtteranceMs.push(performance.now() - utteranceStarted);

        let best = -1;
        let bestSimilarity = -1;
        for (const [ index, centroid ] of centroids.entries()) {
            const similarity = dot(normalize(centroid), embedding);
            if (similarity > bestSimilarity) {
                best = index;
                bestSimilarity = similarity;
            }
        }
        const isLongEnough = utterance.durationMs / 1000 >= minDuration;
        if (best >= 0 && bestSimilarity >= threshold) {
            if (isLongEnough) {
                addInto(centroids[best], embedding);
            }
            labels.push({ speaker: `S${best + 1}`, similarity: bestSimilarity });
        } else if (utterance.durationMs / 1000 >= newMin) {
            centroids.push(Float32Array.from(embedding));
            labels.push({ speaker: `S${centroids.length}`, similarity: best >= 0 ? bestSimilarity : null });
        } else if (best >= 0 && (isLongEnough || bestSimilarity >= shortThreshold)) {
            labels.push({ speaker: `S${best + 1}`, similarity: bestSimilarity });
        } else {
            labels.push({ speaker: "?", similarity: best >= 0 ? bestSimilarity : null });
        }
    }
    const wallMs = performance.now() - started;
    const cpuMs = cpuMillis(process.cpuUsage(cpuBefore));
    const sorted = [ ...perUtteranceMs ].sort((a, b) => a - b);
    return {
        labels,
        timing: `load ${loadMs.toFixed(0)} ms; ${(wallMs / 1000).toFixed(2)} s wall, `
            + `${(cpuMs / 1000).toFixed(2)} s CPU for ${audioSeconds.toFixed(0)} s of audio `
            + `(RTF ${(wallMs / 1000 / audioSeconds).toFixed(3)}); per utterance median `
            + `${sorted[Math.floor(sorted.length / 2)].toFixed(0)} ms, max ${sorted.at(-1).toFixed(0)} ms`
    };
}

/** sherpa-onnx's diarization over the whole source, mapped onto the utterances by overlap. */
function labelOffline() {
    const clustering = options.clusters
        ? { numClusters: Number(options.clusters) }
        : { threshold: Number(options["cluster-threshold"] ?? 0.5) };
    const loadStarted = performance.now();
    const diarization = new sherpa.OfflineSpeakerDiarization({
        segmentation: {
            pyannote: { model: path.join(modelsDir, "segmentation.onnx") },
            numThreads: threads
        },
        embedding: { model: embeddingModel, numThreads: threads },
        clustering,
        minDurationOn: 0.2,
        minDurationOff: 0.5
    });
    const loadMs = performance.now() - loadStarted;

    const cpuBefore = process.cpuUsage();
    const started = performance.now();
    const segments = diarization.process(wave.samples);
    const wallMs = performance.now() - started;
    const cpuMs = cpuMillis(process.cpuUsage(cpuBefore));

    const labels = utterances.map((utterance) => {
        const overlap = new Map();
        for (const segment of segments) {
            const seconds = Math.min(segment.end, utterance.endSeconds)
                - Math.max(segment.start, utterance.startSeconds);
            if (seconds > 0) {
                overlap.set(segment.speaker, (overlap.get(segment.speaker) ?? 0) + seconds);
            }
        }
        const ranked = [ ...overlap ].sort((a, b) => b[1] - a[1]);
        if (!ranked.length) {
            return { speaker: "?", change: null };
        }
        const second = ranked[1];
        return {
            speaker: `D${ranked[0][0] + 1}`,
            change: second && second[1] >= CHANGE_SECONDS ? `D${second[0] + 1}` : null
        };
    });
    return {
        labels,
        timing: `load ${loadMs.toFixed(0)} ms; ${(wallMs / 1000).toFixed(2)} s wall, `
            + `${(cpuMs / 1000).toFixed(2)} s CPU for ${audioSeconds.toFixed(0)} s of audio `
            + `(RTF ${(wallMs / 1000 / audioSeconds).toFixed(3)}); ${segments.length} segments, `
            + `clustering ${JSON.stringify(clustering)}`
    };
}

function embed(extractor, utterance) {
    const start = Math.max(0, Math.round(utterance.startSeconds * SAMPLE_RATE));
    const end = Math.min(wave.samples.length, Math.round(utterance.endSeconds * SAMPLE_RATE));
    const stream = extractor.createStream();
    stream.acceptWaveform({ samples: wave.samples.subarray(start, end), sampleRate: SAMPLE_RATE });
    stream.inputFinished();
    if (!extractor.isReady(stream)) {
        fail(`The utterance at ${formatSeconds(utterance.startSeconds)} is too short to embed.`);
    }
    return extractor.compute(stream);
}

/**
 * The share of speech, weighted by utterance length, on which live and offline agree, after
 * mapping each live speaker to the offline speaker it overlaps most.
 */
function agreement(liveLabels, offlineLabels) {
    const weights = new Map();
    let total = 0;
    for (const [ index, utterance ] of utterances.entries()) {
        const key = `${liveLabels[index].speaker}|${offlineLabels[index].speaker}`;
        weights.set(key, (weights.get(key) ?? 0) + utterance.durationMs);
        total += utterance.durationMs;
    }
    const mapping = new Map();
    for (const [ key ] of [ ...weights ].sort((a, b) => b[1] - a[1])) {
        const [ liveSpeaker, offlineSpeaker ] = key.split("|");
        if (!mapping.has(liveSpeaker) && ![ ...mapping.values() ].includes(offlineSpeaker)) {
            mapping.set(liveSpeaker, offlineSpeaker);
        }
    }
    let agreed = 0;
    for (const [ index, utterance ] of utterances.entries()) {
        if (mapping.get(liveLabels[index].speaker) === offlineLabels[index].speaker) {
            agreed += utterance.durationMs;
        }
    }
    return total ? agreed / total : 0;
}

function normalize(vector) {
    const length = Math.hypot(...vector) || 1;
    return vector.map((value) => value / length);
}

function dot(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += a[i] * b[i];
    }
    return sum;
}

function addInto(target, vector) {
    for (let i = 0; i < target.length; i++) {
        target[i] += vector[i];
    }
}

function cpuMillis({ user, system }) {
    return (user + system) / 1000;
}

function formatSeconds(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

/** The embedding model file `name` stands for: titanet, campplus, or a path. */
function getEmbeddingModel(name) {
    if (name === "titanet") {
        return path.join(requireResource(MODEL_RESOURCES.speaker), "nemo_en_titanet_small.onnx");
    }
    if (name === "campplus") {
        return path.join(modelsDir, "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx");
    }
    return name;
}
