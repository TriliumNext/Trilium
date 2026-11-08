import type { TranscriptionPrecision } from "@triliumnext/commons";
import fs from "fs";
import path from "path";
import type { SpeakerEmbeddingExtractor, Vad } from "sherpa-onnx-node";

import { type ModelPaths, SAMPLE_RATE } from "./protocol";
import {
    findSpeakerChanges, SpeakerClusterer, type SpeakerClustererOptions, type SpeakerTurn,
    snapToWordBoundary, type TimedWord
} from "./speakers";

/** The text of an utterance and when each of its words starts. */
export interface Recognition {
    text: string;
    words: TimedWord[];
}

/** Turns one utterance into text. */
export interface SpeechRecognizer {
    transcribe(samples: Float32Array): Promise<Recognition>;
}

/** A stretch of speech found in a source, `start` counted in samples from the source's start. */
export interface SpeechSegment {
    start: number;
    samples: Float32Array;
}

/** Cuts one source's audio into utterances at its pauses. Each source needs its own. */
export interface SpeechSegmenter {
    /** Takes the next samples and returns the utterances they complete. */
    accept(samples: Float32Array): SpeechSegment[];
    /** Ends the source and returns the utterance still in progress, if any. */
    flush(): SpeechSegment[];
    /** Whether the samples accepted so far end inside an utterance. */
    isSpeaking(): boolean;
}

/** Tells the speakers of one source apart. Each source needs its own. */
export interface SpeakerTracker {
    /**
     * Returns the turns of an utterance in order, covering it whole, each with its speaker
     * numbered from 1 in the order they were first heard. `words` places the cuts between turns.
     */
    identify(samples: Float32Array, words: TimedWord[]): SpeakerTurn[];
}

export interface SpeechEngine {
    recognizer: SpeechRecognizer;
    createSegmenter(): SpeechSegmenter;
    /** Absent when the speaker model is not installed. */
    createSpeakerTracker?(): SpeakerTracker;
    /** The settings that shape the transcript, kept with a recording to compare engines by. */
    settings: Record<string, unknown>;
}

/** Silero VAD consumes 512-sample windows at 16 kHz. */
const VAD_WINDOW_SIZE = 512;

const RECOGNIZER_SETTINGS = {
    modelType: "nemo_transducer",
    numThreads: 2,
    provider: "cpu"
};

/**
 * The int8 model emits nothing over some stretches of speech and drops whole clauses from segments
 * with pauses; `blankPenalty` counters that. The full-precision model drops none, and the penalty
 * only adds stray words to its transcript.
 */
const DECODING_SETTINGS: Record<TranscriptionPrecision, Record<string, unknown>> = {
    fp32: { decodingMethod: "greedy_search" },
    int8: { decodingMethod: "greedy_search", blankPenalty: 0.5 }
};

const SPEAKER_SETTINGS: SpeakerClustererOptions = {
    threshold: 0.5,
    minDurationSeconds: 1.5,
    newSpeakerMinDurationSeconds: 5,
    shortThreshold: 0.3
};

/**
 * An utterance of `minSegmentSeconds` or more is searched for a change of speaker in windows of
 * `windowSeconds`, `hopSeconds` apart; a turn shorter than `minTurnSeconds` is not split off.
 */
const TURN_SETTINGS = {
    windowSeconds: 2,
    hopSeconds: 1,
    minSegmentSeconds: 4,
    minTurnSeconds: 1
};

const VAD_SETTINGS = {
    // At 0.5, Silero starts a segment late enough to clip the first syllable of a short reply.
    threshold: 0.3,
    minSilenceDuration: 0.75,
    minSpeechDuration: 0.1,
    // Past this length, sherpa ends the segment at the next 0.1 s pause, so continuous speech is
    // committed within about 22 s.
    maxSpeechDuration: 20,
    windowSize: VAD_WINDOW_SIZE
};

/**
 * Loads sherpa-onnx's native addon, with onnxruntime, without any model.
 *
 * @returns The sherpa-onnx version of the addon.
 */
export async function probeSherpa() {
    try {
        const mod = await import("sherpa-onnx-node");
        const sherpa = mod.default ?? mod;
        return sherpa.version;
    } catch (e) {
        // `sherpa-onnx-node` reports only that no addon loaded; loading the platform package's
        // addon directly throws the reason, such as a missing shared library.
        const platform = process.platform === "win32" ? "win" : process.platform;
        require(`sherpa-onnx-${platform}-${process.arch}/sherpa-onnx.node`);
        throw e;
    }
}

/**
 * Loads the local engine from `models`: Silero VAD for segmentation and Parakeet TDT 0.6B v3 for
 * recognition, both through sherpa-onnx, and the speaker model when it is given and installed.
 * The recognizer's precision picks its files: `encoder.onnx` (with `encoder.weights`) for `fp32`,
 * `encoder.int8.onnx` for `int8`. Recognition runs on the libuv thread pool; the VAD and the
 * speaker embeddings run on the calling thread.
 */
export async function loadSherpaEngine(models: ModelPaths): Promise<SpeechEngine> {
    const { directory: modelDir, precision } = models.recognizer;
    const speakerModel = models.speaker && fs.existsSync(models.speaker) ? models.speaker : null;
    const suffix = precision === "fp32" ? ".onnx" : ".int8.onnx";
    const decodingSettings = DECODING_SETTINGS[precision];
    const mod = await import("sherpa-onnx-node");
    const sherpa = mod.default ?? mod;
    const recognizer = await sherpa.OfflineRecognizer.createAsync({
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
            transducer: {
                encoder: path.join(modelDir, `encoder${suffix}`),
                decoder: path.join(modelDir, `decoder${suffix}`),
                joiner: path.join(modelDir, `joiner${suffix}`)
            },
            tokens: path.join(modelDir, "tokens.txt"),
            ...RECOGNIZER_SETTINGS
        },
        ...decodingSettings
    });

    const speakerExtractor = speakerModel
        ? new sherpa.SpeakerEmbeddingExtractor({
            model: speakerModel, numThreads: 1, provider: "cpu"
        })
        : null;

    return {
        recognizer: {
            async transcribe(samples) {
                const stream = recognizer.createStream();
                stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
                const result = await recognizer.decodeAsync(stream);
                return { text: result.text.trim(), words: toWords(result.tokens, result.timestamps) };
            }
        },
        createSegmenter: () => new VadSegmenter(new sherpa.Vad({
            sileroVad: {
                model: models.vad,
                ...VAD_SETTINGS
            },
            sampleRate: SAMPLE_RATE,
            numThreads: 1,
            provider: "cpu"
        }, 60)),
        createSpeakerTracker: speakerExtractor
            ? () => new EmbeddingSpeakerTracker(speakerExtractor, SPEAKER_SETTINGS)
            : undefined,
        settings: {
            modelDirectory: path.resolve(modelDir),
            precision,
            recognizer: { ...RECOGNIZER_SETTINGS, ...decodingSettings },
            vad: VAD_SETTINGS,
            speakers: speakerModel
                ? { model: path.basename(speakerModel), ...SPEAKER_SETTINGS, turns: TURN_SETTINGS }
                : null
        }
    };
}

class VadSegmenter implements SpeechSegmenter {
    constructor(private readonly vad: Vad) {}

    accept(samples: Float32Array) {
        for (let i = 0; i + VAD_WINDOW_SIZE <= samples.length; i += VAD_WINDOW_SIZE) {
            this.vad.acceptWaveform(samples.subarray(i, i + VAD_WINDOW_SIZE));
        }
        return this.drain();
    }

    flush() {
        this.vad.flush();
        return this.drain();
    }

    isSpeaking() {
        return this.vad.isDetected();
    }

    private drain() {
        const segments: SpeechSegment[] = [];
        while (!this.vad.isEmpty()) {
            // Electron's V8 memory cage rejects the external buffers sherpa-onnx uses by default.
            segments.push(this.vad.front(false));
            this.vad.pop();
        }
        return segments;
    }
}

/**
 * Identifies speakers by clustering TitaNet embeddings, and splits an utterance where the speaker
 * changes within it. Embeddings are computed synchronously, about 10–100 ms each on one thread:
 * one per turn, plus one per window of an utterance searched for a change.
 */
class EmbeddingSpeakerTracker implements SpeakerTracker {
    private readonly clusterer: SpeakerClusterer;

    constructor(
        private readonly extractor: SpeakerEmbeddingExtractor,
        options: SpeakerClustererOptions
    ) {
        this.clusterer = new SpeakerClusterer(options);
    }

    identify(samples: Float32Array, words: TimedWord[]) {
        const durationSeconds = samples.length / SAMPLE_RATE;
        const bounds = [ 0, ...this.findTurnChanges(samples, words), durationSeconds ];
        return bounds.slice(1).map((endSeconds, index) => {
            const startSeconds = bounds[index];
            const embedding = this.embed(samples, startSeconds, endSeconds);
            const speaker = embedding
                ? this.clusterer.assign(embedding, endSeconds - startSeconds)
                : null;
            return { startSeconds, endSeconds, speaker };
        });
    }

    /** Returns the times, in seconds, at which another known or unknown speaker takes over. */
    private findTurnChanges(samples: Float32Array, words: TimedWord[]) {
        const { windowSeconds, hopSeconds, minSegmentSeconds, minTurnSeconds } = TURN_SETTINGS;
        const durationSeconds = samples.length / SAMPLE_RATE;
        if (durationSeconds < minSegmentSeconds || !this.clusterer.hasSpeakers) {
            return [];
        }

        const labels: (number | null)[] = [];
        for (let start = 0; start + windowSeconds <= durationSeconds; start += hopSeconds) {
            const embedding = this.embed(samples, start, start + windowSeconds);
            labels.push(embedding ? this.clusterer.match(embedding) : null);
        }
        const cuts: number[] = [];
        for (const window of findSpeakerChanges(labels)) {
            // The first window of the new run is mostly the new speaker, the one before it mostly
            // the previous one, so the change falls in the first hop of the new run's window.
            const cut = snapToWordBoundary(window * hopSeconds + hopSeconds / 2, words);
            if (cut - (cuts.at(-1) ?? 0) >= minTurnSeconds && durationSeconds - cut >= minTurnSeconds) {
                cuts.push(cut);
            }
        }
        return cuts;
    }

    private embed(samples: Float32Array, startSeconds: number, endSeconds: number) {
        const stream = this.extractor.createStream();
        stream.acceptWaveform({
            samples: samples.subarray(
                Math.round(startSeconds * SAMPLE_RATE), Math.round(endSeconds * SAMPLE_RATE)),
            sampleRate: SAMPLE_RATE
        });
        stream.inputFinished();
        if (!this.extractor.isReady(stream)) {
            return null;
        }
        // Electron's V8 memory cage rejects the external buffers sherpa-onnx uses by default.
        return this.extractor.compute(stream, false);
    }
}

/** Joins Parakeet's tokens into words; a token that starts with a space starts a word. */
function toWords(tokens: string[], timestamps: number[]): TimedWord[] {
    const words: TimedWord[] = [];
    for (const [ index, token ] of tokens.entries()) {
        const last = words.at(-1);
        if (token.startsWith(" ") || !last) {
            words.push({ text: token.trim(), startSeconds: timestamps[index] });
        } else {
            last.text += token;
        }
    }
    return words.filter(({ text }) => text);
}
