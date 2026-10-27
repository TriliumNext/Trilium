import type { TranscriptSource, TranscriptUtterance } from "@triliumnext/commons";
import type { MessagePortMain } from "electron";

import type { SpeakerTracker, SpeechEngine, SpeechSegment, SpeechSegmenter } from "./engine";
import { type CaptureMessage, type Logger, SAMPLE_RATE } from "./protocol";
import type { TimedWord } from "./speakers";

/** The sources whose speakers are told apart; the microphone carries only the local speaker. */
const DIARIZED_SOURCES: readonly TranscriptSource[] = [ "system" ];

export type SamplesListener = (source: TranscriptSource, samples: Float32Array) => void;

/** Produces mono {@link SAMPLE_RATE} samples per source until stopped. */
export interface AudioCapture {
    /** Starts delivering samples to `onSamples`. */
    start(onSamples: SamplesListener): void;
    stop(): void;
}

/** Receives the utterances of a recording in the order they were spoken per source. */
export interface TranscriptSink {
    /**
     * Called once before capturing starts, with the start time the offsets count from. A sink that
     * throws here keeps the recording from starting.
     */
    open?(startedAt: number): void | Promise<void>;
    write(utterance: TranscriptUtterance): void | Promise<void>;
    /** Called once after the last utterance. */
    close?(): void | Promise<void>;
}

/** Receives every source's samples as they are captured, before any segmentation. */
export interface AudioTap {
    /** Called once before capturing starts, as {@link TranscriptSink.open} is. */
    open?(startedAt: number): void | Promise<void>;
    /**
     * @param firstSampleOffsetMs Milliseconds from the start of the recording to the first sample
     * of `source`; the same for every call of one source.
     */
    write(source: TranscriptSource, samples: Float32Array, firstSampleOffsetMs: number): void;
    /** Called once after the last samples. */
    close?(): void | Promise<void>;
}

export interface RecordingSessionOptions {
    capture: AudioCapture;
    engine: SpeechEngine;
    sinks: TranscriptSink[];
    taps?: AudioTap[];
    log: Logger;
    /**
     * Called with the sources whose speech has not reached the sinks yet, either because it is
     * still being spoken or because it waits to be transcribed, every time that list changes.
     */
    onPendingChanged?: (sources: TranscriptSource[]) => void;
    /** Called with the RMS of every chunk as it arrives, from 0 to 1. */
    onLevel?: (source: TranscriptSource, level: number) => void;
    now?: () => number;
}

/**
 * One recording: runs each source of `capture` through its own segmenter, so a pause on one source
 * never cuts an utterance on the other, transcribes the utterances one at a time and hands each
 * to every sink.
 */
export class RecordingSession {
    private readonly pipelines = new Map<TranscriptSource, SourcePipeline>();
    private readonly speakerTrackers = new Map<TranscriptSource, SpeakerTracker>();
    /** How many utterances of each source wait to be transcribed or written. */
    private readonly queued = new Map<TranscriptSource, number>();
    private queue = Promise.resolve();
    private startedAtMs = 0;
    private pendingSources: TranscriptSource[] = [];

    constructor(private readonly options: RecordingSessionOptions) {}

    /** When the recording started, in milliseconds since the epoch; set by {@link start}. */
    get startedAt() {
        return this.startedAtMs;
    }

    async start() {
        this.startedAtMs = this.now();
        for (const receiver of [ ...this.options.sinks, ...this.options.taps ?? [] ]) {
            await receiver.open?.(this.startedAtMs);
        }
        this.options.capture.start((source, samples) => {
            // An exception thrown from the capture's listener ends the transcription process.
            try {
                const pipeline = this.pipelineFor(source, samples);
                this.tap(source, samples, pipeline.firstSampleOffsetMs);
                const level = pipeline.accept(samples);
                this.options.onLevel?.(source, level);
                this.updatePending();
            } catch (e) {
                this.log.error(`Transcription: ${source} failed: ${(e as Error)?.message ?? e}`);
            }
        });
    }

    /** Stops capturing, then waits until the speech already captured has reached every sink. */
    async stop() {
        this.options.capture.stop();
        for (const pipeline of this.pipelines.values()) {
            pipeline.flush();
        }
        this.updatePending();
        for (const tap of this.options.taps ?? []) {
            try {
                await tap.close?.();
            } catch (e) {
                this.log.error(`Transcription: closing an audio tap failed: ${e}`);
            }
        }
        await this.queue;

        for (const sink of this.options.sinks) {
            try {
                await sink.close?.();
            } catch (e) {
                this.log.error(`Transcription: closing a sink failed: ${e}`);
            }
        }
    }

    private tap(source: TranscriptSource, samples: Float32Array, firstSampleOffsetMs: number) {
        for (const tap of this.options.taps ?? []) {
            try {
                tap.write(source, samples, firstSampleOffsetMs);
            } catch (e) {
                this.log.error(`Transcription: an audio tap failed on ${source}: ${e}`);
            }
        }
    }

    /** Creates a source's pipeline on its first chunk, which was captured before it arrived. */
    private pipelineFor(source: TranscriptSource, firstChunk: Float32Array) {
        let pipeline = this.pipelines.get(source);
        if (!pipeline) {
            const chunkMs = firstChunk.length / SAMPLE_RATE * 1000;
            pipeline = new SourcePipeline(
                source,
                this.options.engine.createSegmenter(),
                Math.max(0, this.now() - this.startedAtMs - chunkMs),
                (offsetMs, samples) => this.enqueue(source, offsetMs, samples),
                this.options.log
            );
            this.pipelines.set(source, pipeline);
            const tracker = DIARIZED_SOURCES.includes(source)
                ? this.options.engine.createSpeakerTracker?.()
                : undefined;
            if (tracker) {
                this.speakerTrackers.set(source, tracker);
            }
        }
        return pipeline;
    }

    private enqueue(source: TranscriptSource, offsetMs: number, samples: Float32Array) {
        this.queued.set(source, (this.queued.get(source) ?? 0) + 1);
        this.queue = this.queue.then(async () => {
            const { text, words } = await this.options.engine.recognizer.transcribe(samples);
            if (!text) {
                return;
            }

            const durationMs = samples.length / SAMPLE_RATE * 1000;
            const turns = this.identifySpeakers(source, samples, words);
            const utterances: TranscriptUtterance[] = turns && turns.length > 1
                ? turns.map((turn) => ({
                    source,
                    offsetMs: offsetMs + Math.round(turn.startSeconds * 1000),
                    durationMs: Math.round((turn.endSeconds - turn.startSeconds) * 1000),
                    text: words
                        .filter(({ startSeconds }) =>
                            startSeconds >= turn.startSeconds && startSeconds < turn.endSeconds)
                        .map((word) => word.text)
                        .join(" "),
                    ...(turn.speaker === null ? {} : { speaker: turn.speaker })
                })).filter((utterance) => utterance.text)
                : [ {
                    source, offsetMs, durationMs, text,
                    ...(turns?.[0]?.speaker == null ? {} : { speaker: turns[0].speaker })
                } ];
            for (const utterance of utterances) {
                for (const sink of this.options.sinks) {
                    try {
                        await sink.write(utterance);
                    } catch (e) {
                        this.log.error(`Transcription: a sink failed: ${e}`);
                    }
                }
            }
        }).catch((e) => this.log.error(`Transcription failed: ${e}`)).finally(() => {
            this.queued.set(source, (this.queued.get(source) ?? 1) - 1);
            this.updatePending();
        });
    }

    /**
     * Returns the speakers' turns of an utterance, or `null` for a source without speakers. Runs
     * synchronously, 0.1–0.3 s per utterance, so the next chunks wait meanwhile.
     */
    private identifySpeakers(source: TranscriptSource, samples: Float32Array, words: TimedWord[]) {
        try {
            return this.speakerTrackers.get(source)?.identify(samples, words) ?? null;
        } catch (e) {
            this.log.error(`Transcription: identifying the speaker on ${source} failed: ${e}`);
            return null;
        }
    }

    /** Reports the sources with speech not yet written, when they differ from the last report. */
    private updatePending() {
        const pending = [ ...this.pipelines ]
            .filter(([ source, pipeline ]) => pipeline.isSpeaking() || this.queued.get(source))
            .map(([ source ]) => source)
            .sort();
        if (pending.join() !== this.pendingSources.join()) {
            this.pendingSources = pending;
            this.options.onPendingChanged?.(pending);
        }
    }

    private now() {
        return (this.options.now ?? Date.now)();
    }

    private get log() {
        return this.options.log;
    }
}

/**
 * Segments one source, measures each chunk's RMS and logs the source's peak level every 5 s, to
 * spot a silent source.
 */
class SourcePipeline {
    private peak = 0;
    private peakSampleCount = 0;

    constructor(
        private readonly source: TranscriptSource,
        private readonly segmenter: SpeechSegmenter,
        /** Milliseconds from the start of the recording to the source's first sample. */
        readonly firstSampleOffsetMs: number,
        private readonly onSegment: (offsetMs: number, samples: Float32Array) => void,
        private readonly log: Logger
    ) {}

    /** Segments `samples` and returns their RMS. */
    accept(samples: Float32Array) {
        const level = this.measure(samples);
        this.emit(this.segmenter.accept(samples));
        return level;
    }

    flush() {
        this.emit(this.segmenter.flush());
    }

    isSpeaking() {
        return this.segmenter.isSpeaking();
    }

    private emit(segments: SpeechSegment[]) {
        for (const segment of segments) {
            const offsetMs = this.firstSampleOffsetMs + segment.start / SAMPLE_RATE * 1000;
            this.onSegment(offsetMs, segment.samples);
        }
    }

    private measure(samples: Float32Array) {
        let sumOfSquares = 0;
        for (const sample of samples) {
            this.peak = Math.max(this.peak, Math.abs(sample));
            sumOfSquares += sample * sample;
        }
        this.peakSampleCount += samples.length;
        if (this.peakSampleCount >= 5 * SAMPLE_RATE) {
            this.log.info(`Transcription: ${this.source} peak ${this.peak.toFixed(4)} over 5 s`);
            this.peak = 0;
            this.peakSampleCount = 0;
        }
        return samples.length ? Math.sqrt(sumOfSquares / samples.length) : 0;
    }
}

/** The samples the capture page posts to the port the main process connects. */
export class PortCapture implements AudioCapture {
    /**
     * Settles once the page has posted its end marker or the port closed: every sample the page
     * captured has then been delivered.
     */
    readonly ended: Promise<void>;
    private port: MessagePortMain | null = null;
    private onSamples: SamplesListener | null = null;
    private markEnded = () => {};

    constructor() {
        this.ended = new Promise((resolve) => {
            this.markEnded = resolve;
        });
    }

    start(onSamples: SamplesListener) {
        this.onSamples = onSamples;
    }

    connect(port: MessagePortMain) {
        this.port = port;
        port.on("message", ({ data }) => {
            const message = data as CaptureMessage | null;
            if (!message) {
                return;
            }
            if ("end" in message) {
                this.markEnded();
            } else if (isSource(message.source) && message.samples instanceof Float32Array) {
                this.onSamples?.(message.source, message.samples);
            }
        });
        port.on("close", () => this.markEnded());
        port.start();
    }

    stop() {
        this.onSamples = null;
        this.port?.close();
        this.port = null;
    }
}

function isSource(source: unknown): source is TranscriptSource {
    return source === "microphone" || source === "system";
}
