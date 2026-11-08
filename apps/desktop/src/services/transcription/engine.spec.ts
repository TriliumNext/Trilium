import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadSherpaEngine, probeSherpa } from "./engine";

const h = vi.hoisted(() => ({
    /** Base names of the optional model files the model directory holds. */
    installed: [] as string[],
    recognizerConfig: null as Record<string, unknown> | null,
    vadConfig: null as Record<string, unknown> | null,
    extractorConfig: null as Record<string, unknown> | null,
    decoded: [] as Float32Array[],
    isEmbeddingReady: true,
    embeddings: [] as number[][],
    /** The length of each stretch of samples a speaker embedding was computed from. */
    embedded: [] as number[]
}));

/** Silero as the segmenter sees it: windows in, then whatever segments the spec queues. */
class FakeVad {
    windows: number[] = [];
    queued: { start: number; samples: Float32Array }[] = [];
    pendingAtFlush: { start: number; samples: Float32Array }[] = [];
    isSpeech = false;
    externalBuffers: boolean[] = [];

    constructor(config: Record<string, unknown>) {
        h.vadConfig = config;
        vads.push(this);
    }

    acceptWaveform(window: Float32Array) {
        this.windows.push(window.length);
    }
    flush() {
        this.queued.push(...this.pendingAtFlush);
    }
    isDetected() {
        return this.isSpeech;
    }
    isEmpty() {
        return !this.queued.length;
    }
    front(enableExternalBuffer: boolean) {
        this.externalBuffers.push(enableExternalBuffer);
        return this.queued[0];
    }
    pop() {
        this.queued.shift();
    }
}
const vads: FakeVad[] = [];

vi.mock("sherpa-onnx-node", () => ({
    default: {
        version: "1.13.8",
        OfflineRecognizer: {
            createAsync: async (config: Record<string, unknown>) => {
                h.recognizerConfig = config;
                return {
                    createStream: () => ({
                        samples: null as Float32Array | null,
                        acceptWaveform(input: { samples: Float32Array }) {
                            this.samples = input.samples;
                        }
                    }),
                    decodeAsync: async (stream: { samples: Float32Array }) => {
                        h.decoded.push(stream.samples);
                        return {
                            text: "  Hello there.  ",
                            tokens: [ " Hel", "lo", " there", "." ],
                            timestamps: [ 0, 0.16, 0.4, 0.72 ]
                        };
                    }
                };
            }
        },
        Vad: FakeVad,
        SpeakerEmbeddingExtractor: class {
            constructor(config: Record<string, unknown>) {
                h.extractorConfig = config;
            }
            createStream() {
                return {
                    acceptWaveform: ({ samples }: { samples: Float32Array }) => {
                        h.embedded.push(samples.length);
                    },
                    inputFinished: vi.fn()
                };
            }
            isReady() {
                return h.isEmbeddingReady;
            }
            compute(_stream: unknown, enableExternalBuffer: boolean) {
                expect(enableExternalBuffer).toBe(false);
                return Float32Array.from(h.embeddings.shift() ?? []);
            }
        }
    }
}));
vi.mock("fs", () => ({
    default: { existsSync: (file: string) => h.installed.includes(path.basename(file)) }
}));

const MODEL_DIR = "/models/parakeet";
const MODELS = {
    recognizer: { directory: MODEL_DIR, precision: "int8" as const },
    vad: "/models/silero/silero_vad.onnx",
    speaker: "/models/titanet/nemo_en_titanet_small.onnx"
};

beforeEach(() => {
    h.installed = [];
    h.recognizerConfig = null;
    h.isEmbeddingReady = true;
    h.decoded.length = 0;
    h.embeddings.length = 0;
    h.embedded.length = 0;
    vads.length = 0;
});

describe("probeSherpa", () => {
    it("loads sherpa-onnx without any model and reports its version", async () => {
        expect(await probeSherpa()).toBe("1.13.8");
        expect(h.recognizerConfig).toBeNull();
    });
});

describe("loadSherpaEngine", () => {
    it("loads Parakeet and Silero from their paths and reports their settings", async () => {
        // The precision comes from the paths, whatever else the directory holds.
        h.installed = [ "encoder.onnx" ];
        const engine = await loadSherpaEngine(MODELS);

        expect(h.recognizerConfig).toMatchObject({
            featConfig: { sampleRate: 16000, featureDim: 80 },
            modelConfig: {
                transducer: {
                    encoder: path.join(MODEL_DIR, "encoder.int8.onnx"),
                    decoder: path.join(MODEL_DIR, "decoder.int8.onnx"),
                    joiner: path.join(MODEL_DIR, "joiner.int8.onnx")
                },
                tokens: path.join(MODEL_DIR, "tokens.txt"),
                modelType: "nemo_transducer"
            },
            decodingMethod: "greedy_search",
            blankPenalty: 0.5
        });
        expect(engine.createSpeakerTracker).toBeUndefined();
        expect(engine.settings).toMatchObject({
            modelDirectory: path.resolve(MODEL_DIR),
            precision: "int8",
            recognizer: { modelType: "nemo_transducer", blankPenalty: 0.5 },
            vad: { minSilenceDuration: 0.75, maxSpeechDuration: 20, windowSize: 512 },
            speakers: null
        });

        const samples = new Float32Array(1600);
        expect(await engine.recognizer.transcribe(samples)).toEqual({
            text: "Hello there.",
            words: [ { text: "Hello", startSeconds: 0 }, { text: "there.", startSeconds: 0.4 } ]
        });
        expect(h.decoded).toEqual([ samples ]);
    });

    it("loads the full-precision model when given, decoding it without a blank penalty", async () => {
        const engine = await loadSherpaEngine({
            ...MODELS, recognizer: { directory: MODEL_DIR, precision: "fp32" }
        });

        expect(h.recognizerConfig).toMatchObject({
            modelConfig: {
                transducer: {
                    encoder: path.join(MODEL_DIR, "encoder.onnx"),
                    decoder: path.join(MODEL_DIR, "decoder.onnx"),
                    joiner: path.join(MODEL_DIR, "joiner.onnx")
                }
            },
            decodingMethod: "greedy_search"
        });
        expect(h.recognizerConfig).not.toHaveProperty("blankPenalty");
        expect(engine.settings).toMatchObject({ precision: "fp32" });
        expect(engine.settings.recognizer).not.toHaveProperty("blankPenalty");
    });

    it("segments a source in whole 512-sample windows, handing out what the VAD completes", async () => {
        const engine = await loadSherpaEngine(MODELS);
        const segmenter = engine.createSegmenter();
        const vad = vads[0];
        expect(h.vadConfig).toMatchObject({
            sileroVad: { model: MODELS.vad, threshold: 0.3, minSpeechDuration: 0.1 },
            sampleRate: 16000
        });

        const first = { start: 0, samples: new Float32Array(8000) };
        vad.queued.push(first);
        vad.isSpeech = true;
        expect(segmenter.accept(new Float32Array(1100))).toEqual([ first ]);
        expect(vad.windows).toEqual([ 512, 512 ]);
        expect(segmenter.isSpeaking()).toBe(true);

        const last = { start: 16000, samples: new Float32Array(4000) };
        vad.pendingAtFlush.push(last);
        expect(segmenter.accept(new Float32Array(512))).toEqual([]);
        expect(segmenter.flush()).toEqual([ last ]);
        expect(vad.externalBuffers).toEqual([ false, false ]);
    });

    it("tells speakers apart with the speaker model, when it is installed", async () => {
        h.installed = [ "nemo_en_titanet_small.onnx" ];
        const engine = await loadSherpaEngine(MODELS);
        expect(h.extractorConfig?.model).toBe(MODELS.speaker);
        expect(engine.settings.speakers).toMatchObject({
            model: "nemo_en_titanet_small.onnx", threshold: 0.5, minDurationSeconds: 1.5,
            newSpeakerMinDurationSeconds: 5, shortThreshold: 0.3,
            turns: { windowSeconds: 2, hopSeconds: 1, minSegmentSeconds: 4, minTurnSeconds: 1 }
        });

        const tracker = engine.createSpeakerTracker?.();
        // No speaker is known yet, so the utterance is not searched for a change.
        h.embeddings.push([ 1, 0 ]);
        expect(tracker?.identify(new Float32Array(16000 * 6), []))
            .toEqual([ { startSeconds: 0, endSeconds: 6, speaker: 1 } ]);
        expect(h.embedded).toEqual([ 16000 * 6 ]);

        // Nine 2 s windows: speaker 1 for two, then an unknown voice; the cut at 2.5 s moves to
        // the sentence starting at 2.2 s, and each turn is identified on its own.
        h.embedded.length = 0;
        h.embeddings.push([ 1, 0 ], [ 1, 0 ], ...Array(7).fill([ 0, 1 ]), [ 1, 0 ], [ 0, 1 ]);
        const words = [
            { text: "Is it?", startSeconds: 0 },
            { text: "Yes", startSeconds: 2.2 },
            { text: "indeed.", startSeconds: 2.9 }
        ];
        expect(tracker?.identify(new Float32Array(16000 * 10), words)).toEqual([
            { startSeconds: 0, endSeconds: 2.2, speaker: 1 },
            { startSeconds: 2.2, endSeconds: 10, speaker: 2 }
        ]);
        expect(h.embedded).toEqual([ ...Array(9).fill(32000), 35200, 124800 ]);

        // Shorter than 4 s: one turn, without windows.
        h.embeddings.push([ 0.9, 0.1 ]);
        expect(tracker?.identify(new Float32Array(16000 * 3), []))
            .toEqual([ { startSeconds: 0, endSeconds: 3, speaker: 1 } ]);
        expect(h.embeddings).toEqual([]);

        h.isEmbeddingReady = false;
        expect(tracker?.identify(new Float32Array(1600), []))
            .toEqual([ { startSeconds: 0, endSeconds: 0.1, speaker: null } ]);

        const withoutSpeakers = await loadSherpaEngine({ ...MODELS, speaker: null });
        expect(withoutSpeakers.createSpeakerTracker).toBeUndefined();
        expect(withoutSpeakers.settings.speakers).toBeNull();
    });
});
