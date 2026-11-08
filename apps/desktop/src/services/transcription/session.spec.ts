import type { TranscriptSource, TranscriptUtterance } from "@triliumnext/commons";
import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SpeakerTracker, SpeechSegment } from "./engine";
import {
    type AudioTap, PortCapture, RecordingSession, type SamplesListener, type TranscriptSink
} from "./session";

const log = { info: vi.fn(), error: vi.fn() };

/**
 * A chunk the fake segmenter reads as a finished utterance: `id` becomes the transcribed text
 * (`0` transcribes to nothing), `start` the segment's start in samples. One second long.
 */
function utteranceChunk(id: number, start: number) {
    const samples = new Float32Array(16000);
    samples[0] = id;
    samples[1] = start;
    return samples;
}

/** The `id` of a chunk that completes no utterance. */
const NO_SEGMENT = -1;

/** A chunk that completes no utterance and leaves the fake segmenter speaking or not. */
function speechChunk(speaking: boolean) {
    const samples = utteranceChunk(NO_SEGMENT, 0);
    samples[2] = speaking ? 1 : 0;
    return samples;
}

function createHarness(extraSinks: TranscriptSink[] = [], taps: AudioTap[] = [], reportsLevels = true) {
    let clock = 1000;
    let onSamples: SamplesListener = () => {};
    const capture = {
        start: vi.fn((listener: SamplesListener) => {
            onSamples = listener;
        }),
        stop: vi.fn()
    };
    const flushed: SpeechSegment[][] = [];
    const engine = {
        settings: {},
        recognizer: {
            transcribe: vi.fn(async (samples: Float32Array) => samples[0]
                ? {
                    text: `utterance ${samples[0]}`,
                    words: [
                        { text: "utterance", startSeconds: 0 },
                        { text: String(samples[0]), startSeconds: 0.6 }
                    ]
                }
                : { text: "", words: [] })
        },
        createSpeakerTracker: undefined as (() => SpeakerTracker) | undefined,
        createSegmenter: vi.fn(() => {
            const pending = flushed.shift() ?? [];
            let speaking = false;
            return {
                accept: (samples: Float32Array) => {
                    speaking = samples[2] === 1;
                    return samples[0] === NO_SEGMENT ? [] : [ { start: samples[1], samples } ];
                },
                flush: () => {
                    speaking = false;
                    return pending;
                },
                isSpeaking: () => speaking
            };
        })
    };
    const written: TranscriptUtterance[] = [];
    const sink = {
        open: vi.fn(),
        write: vi.fn((utterance: TranscriptUtterance) => {
            written.push(utterance);
        }),
        close: vi.fn()
    };
    const sinks = [ ...extraSinks, sink ];
    const onPendingChanged = vi.fn();
    const onLevel = vi.fn();
    const session = new RecordingSession({
        capture, engine, sinks, taps, log, onPendingChanged,
        onLevel: reportsLevels ? onLevel : undefined,
        now: () => clock
    });

    return {
        session, capture, engine, sink, written, flushed, onPendingChanged, onLevel,
        /** Delivers `samples` from `source` when the clock reads `at`. */
        deliver(source: TranscriptSource, samples: Float32Array, at: number) {
            clock = at;
            onSamples(source, samples);
        }
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("RecordingSession", () => {
    it("labels each source's utterances with their offset from the recording start and length", async () => {
        const { session, capture, engine, sink, deliver, written } = createHarness();
        await session.start();
        expect(sink.open).toHaveBeenCalledExactlyOnceWith(1000);
        expect(session.startedAt).toBe(1000);
        expect(sink.open.mock.invocationCallOrder[0])
            .toBeLessThan(capture.start.mock.invocationCallOrder[0]);

        // The microphone's first one-second chunk arrives 2 s in, so it began 1 s in.
        deliver("microphone", utteranceChunk(1, 8000), 3000);
        deliver("system", utteranceChunk(2, 0), 5000);
        deliver("microphone", utteranceChunk(0, 32000), 6000);
        await session.stop();

        expect(engine.createSegmenter).toHaveBeenCalledTimes(2);
        expect(written).toEqual([
            { source: "microphone", offsetMs: 1500, durationMs: 1000, text: "utterance 1" },
            { source: "system", offsetMs: 3000, durationMs: 1000, text: "utterance 2" }
        ]);
    });

    it("hands every captured chunk to the taps, timed like the transcript", async () => {
        const failingTap: AudioTap = {
            write: () => {
                throw new Error("disk full");
            }
        };
        const tap = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
        const { session, deliver, written } = createHarness([], [ failingTap, tap ]);
        await session.start();
        expect(tap.open).toHaveBeenCalledExactlyOnceWith(1000);

        const first = speechChunk(true);
        const second = utteranceChunk(1, 0);
        deliver("microphone", first, 3000);
        deliver("microphone", second, 4000);
        await session.stop();

        expect(tap.write.mock.calls).toEqual([
            [ "microphone", first, 1000 ],
            [ "microphone", second, 1000 ]
        ]);
        expect(tap.close).toHaveBeenCalledOnce();
        expect(written.map((utterance) => utterance.text)).toEqual([ "utterance 1" ]);
        expect(log.error).toHaveBeenCalledWith(
            "Transcription: an audio tap failed on microphone: Error: disk full");
    });

    it("transcribes what the segmenters still hold before it closes the sinks", async () => {
        const failingSink: TranscriptSink = {
            write: () => {
                throw new Error("disk full");
            },
            close: () => {
                throw new Error("disk full");
            }
        };
        const { session, capture, deliver, sink, flushed } = createHarness([ failingSink ]);
        flushed.push([ { start: 16000, samples: utteranceChunk(3, 0) } ]);
        await session.start();

        deliver("microphone", utteranceChunk(0, 0), 2000);
        await session.stop();

        expect(capture.stop).toHaveBeenCalledOnce();
        expect(sink.write).toHaveBeenCalledExactlyOnceWith({
            source: "microphone", offsetMs: 1000, durationMs: 1000, text: "utterance 3"
        });
        expect(sink.close).toHaveBeenCalledOnce();
        expect(sink.write.mock.invocationCallOrder[0])
            .toBeLessThan(sink.close.mock.invocationCallOrder[0]);
        expect(log.error).toHaveBeenCalledTimes(2);
    });

    it("reports a source as pending from its first speech until its utterance is written", async () => {
        const { session, engine, sink, deliver, onPendingChanged } = createHarness();
        let finishTranscribing = () => {};
        engine.recognizer.transcribe.mockImplementationOnce(() => new Promise((resolve) => {
            finishTranscribing = () => resolve({ text: "utterance 1", words: [] });
        }));
        await session.start();

        deliver("microphone", speechChunk(true), 2000);
        deliver("system", speechChunk(true), 2000);
        deliver("microphone", speechChunk(true), 3000);
        // The utterance ends: the microphone stays pending while it is transcribed.
        deliver("microphone", utteranceChunk(1, 0), 4000);
        deliver("system", speechChunk(false), 4000);
        expect(onPendingChanged.mock.calls).toEqual([
            [ [ "microphone" ] ],
            [ [ "microphone", "system" ] ],
            [ [ "microphone" ] ]
        ]);

        await vi.waitFor(() => expect(engine.recognizer.transcribe).toHaveBeenCalledOnce());
        finishTranscribing();
        await vi.waitFor(() => expect(onPendingChanged).toHaveBeenLastCalledWith([]));
        expect(sink.write.mock.invocationCallOrder[0])
            .toBeLessThan(onPendingChanged.mock.invocationCallOrder[3]);
        await session.stop();
        expect(onPendingChanged).toHaveBeenCalledTimes(4);
    });

    it("does not start capturing when a sink cannot open", async () => {
        const { session, capture, sink } = createHarness();
        sink.open.mockImplementationOnce(() => {
            throw new Error("note deleted");
        });

        await expect(session.start()).rejects.toThrow("note deleted");
        expect(capture.start).not.toHaveBeenCalled();
    });

    it("labels the system source's utterances by speaker, never the microphone's", async () => {
        const { session, engine, deliver, written } = createHarness();
        const identify = vi.fn()
            .mockReturnValueOnce([ { startSeconds: 0, endSeconds: 1, speaker: 2 } ])
            .mockImplementationOnce(() => {
                throw new Error("model crashed");
            });
        const createSpeakerTracker = vi.fn(() => ({ identify }));
        engine.createSpeakerTracker = createSpeakerTracker;
        await session.start();

        deliver("system", utteranceChunk(1, 0), 2000);
        deliver("microphone", utteranceChunk(2, 0), 2000);
        deliver("system", utteranceChunk(3, 16000), 3000);
        // Transcribes to nothing, so its speaker is never asked for.
        deliver("system", utteranceChunk(0, 32000), 4000);
        await session.stop();

        expect(createSpeakerTracker).toHaveBeenCalledOnce();
        expect(identify).toHaveBeenCalledTimes(2);
        expect(written.map(({ source, speaker, text }) => ({ source, speaker, text }))).toEqual([
            { source: "system", speaker: 2, text: "utterance 1" },
            { source: "microphone", speaker: undefined, text: "utterance 2" },
            { source: "system", speaker: undefined, text: "utterance 3" }
        ]);
        expect(written[1]).not.toHaveProperty("speaker");
        expect(log.error).toHaveBeenCalledWith(
            "Transcription: identifying the speaker on system failed: Error: model crashed");
    });

    it("writes each speaker's turn within an utterance as an utterance of its own", async () => {
        const { session, engine, deliver, written } = createHarness();
        const identify = vi.fn(() => [
            { startSeconds: 0, endSeconds: 0.5, speaker: 1 },
            { startSeconds: 0.5, endSeconds: 0.55, speaker: null },
            { startSeconds: 0.55, endSeconds: 1, speaker: 2 }
        ]);
        engine.createSpeakerTracker = () => ({ identify });
        await session.start();

        deliver("system", utteranceChunk(7, 16000), 3000);
        await session.stop();

        expect(identify).toHaveBeenCalledExactlyOnceWith(expect.any(Float32Array), [
            { text: "utterance", startSeconds: 0 },
            { text: "7", startSeconds: 0.6 }
        ]);
        // The middle turn holds no word, so it is left out.
        expect(written).toEqual([
            { source: "system", offsetMs: 2000, durationMs: 500, text: "utterance", speaker: 1 },
            { source: "system", offsetMs: 2550, durationMs: 450, text: "7", speaker: 2 }
        ]);
    });

    it("logs each source's peak level every 5 s, to spot a silent source", async () => {
        const { session, deliver } = createHarness();
        await session.start();
        for (let second = 1; second <= 5; second++) {
            deliver("system", speechChunk(false), 1000 + second * 1000);
        }
        expect(log.info).toHaveBeenCalledExactlyOnceWith("Transcription: system peak 1.0000 over 5 s");
        await session.stop();
    });

    it("reports the loudness of every chunk as it arrives, per source", async () => {
        const { session, deliver, onLevel } = createHarness();
        await session.start();
        const loud = speechChunk(true).fill(0.5, 3);
        deliver("microphone", speechChunk(false), 2000);
        deliver("system", loud, 3000);

        expect(onLevel).toHaveBeenCalledTimes(2);
        const [ [ quietSource, quiet ], [ loudSource, level ] ] = onLevel.mock.calls;
        expect(quietSource).toBe("microphone");
        expect(quiet).toBeCloseTo(Math.sqrt(1 / 16000));
        expect(loudSource).toBe("system");
        expect(level).toBeCloseTo(Math.sqrt((2 + 0.25 * 15997) / 16000));
        await session.stop();
    });

    it("transcribes without a level listener", async () => {
        const { session, deliver, written } = createHarness([], [], false);
        await session.start();
        deliver("microphone", utteranceChunk(1, 8000), 3000);
        await session.stop();

        expect(written).toEqual([
            { source: "microphone", offsetMs: 1500, durationMs: 1000, text: "utterance 1" }
        ]);
    });

    it("logs a failed transcription or tap, and still finishes the rest", async () => {
        const tap = { write: vi.fn(), close: vi.fn(() => {
            throw new Error("disk full");
        }) };
        const { session, engine, deliver, written, onPendingChanged } = createHarness([], [ tap ]);
        engine.recognizer.transcribe.mockRejectedValueOnce(new Error("decoder crashed"));
        await session.start();

        deliver("microphone", utteranceChunk(1, 0), 2000);
        deliver("microphone", utteranceChunk(2, 16000), 3000);
        await session.stop();
        expect(written.map((utterance) => utterance.text)).toEqual([ "utterance 2" ]);
        expect(onPendingChanged).toHaveBeenLastCalledWith([]);
        expect(log.error.mock.calls).toEqual([
            [ "Transcription: closing an audio tap failed: Error: disk full" ],
            [ "Transcription failed: Error: decoder crashed" ]
        ]);
    });

    it("logs a failing source instead of throwing into the capture", async () => {
        const { session, engine, deliver } = createHarness();
        engine.createSegmenter.mockImplementationOnce(() => {
            throw new Error("VAD model missing");
        });
        await session.start();

        expect(() => deliver("system", utteranceChunk(1, 0), 2000)).not.toThrow();
        expect(log.error).toHaveBeenCalledWith("Transcription: system failed: VAD model missing");
    });
});

describe("PortCapture", () => {
    it("delivers the page's chunks, and settles once the page has posted its last", async () => {
        const port = Object.assign(new EventEmitter(), { start: vi.fn(), close: vi.fn() });
        const onSamples = vi.fn();
        const capture = new PortCapture();
        capture.start(onSamples);
        capture.connect(port as never);
        let hasEnded = false;
        void capture.ended.then(() => {
            hasEnded = true;
        });

        const samples = new Float32Array(512);
        port.emit("message", { data: { source: "system", samples } });
        port.emit("message", { data: { source: "speakers", samples } });
        port.emit("message", { data: null });
        expect(onSamples).toHaveBeenCalledExactlyOnceWith("system", samples);
        await Promise.resolve();
        expect(hasEnded).toBe(false);

        port.emit("message", { data: { end: true } });
        await capture.ended;
        capture.stop();
        expect(port.close).toHaveBeenCalledOnce();

        const closed = new PortCapture();
        const closedPort = Object.assign(new EventEmitter(), { start: vi.fn(), close: vi.fn() });
        closed.connect(closedPort as never);
        closedPort.emit("close");
        await closed.ended;
    });
});
