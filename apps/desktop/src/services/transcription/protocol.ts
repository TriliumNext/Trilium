import type { TranscriptionPrecision, TranscriptSource, TranscriptUtterance } from "@triliumnext/commons";

/** Every source and engine works on mono 16 kHz samples. */
export const SAMPLE_RATE = 16000;

/** Where the transcription process reports to, since it has no access to Trilium's log. */
export interface Logger {
    info(message: string): void;
    error(message: string): void;
}

/** Where the engine's models are. */
export interface ModelPaths {
    /** Parakeet: the directory holding `tokens.txt` and the encoder, decoder and joiner. */
    recognizer: { directory: string; precision: TranscriptionPrecision };
    /** Silero VAD's `.onnx` file. */
    vad: string;
    /** The speaker embedding model's `.onnx` file, or `null` to label no speakers. */
    speaker: string | null;
}

/** What the main process sends the transcription process, in this order. */
export type WorkerRequest =
    | {
        type: "start";
        noteId: string;
        models: ModelPaths;
        /** Where to keep the audio and the transcript as produced, or `null` to keep neither. */
        recordingDirectory: string | null;
    }
    /** Sent once the recording runs, with the port the capture page posts its samples to. */
    | { type: "capture" }
    | { type: "stop" }
    /** Sent instead of `start`: loads sherpa-onnx without any model, then reports `probed`. */
    | { type: "probe" };

/** What the transcription process reports to the main process. */
export type WorkerEvent =
    /** The engine is loaded and the recording's start time is set; capturing can begin. */
    | { type: "ready"; startedAt: number; settings: Record<string, unknown> }
    | { type: "failed"; message: string }
    | { type: "pending"; sources: TranscriptSource[] }
    | { type: "utterance"; utterance: TranscriptUtterance }
    /** The RMS of a source's latest chunk, from 0 to 1; one per chunk, about four a second. */
    | { type: "level"; source: TranscriptSource; level: number }
    | { type: "log"; level: keyof Logger; message: string }
    /** Every utterance captured before `stop` has been sent. */
    | { type: "stopped" }
    /** Answers `probe`: the version of sherpa-onnx that loaded, or why it did not load. */
    | { type: "probed"; version: string } | { type: "probed"; error: string };

/** One chunk of samples, posted by the capture page straight to the transcription process. */
export interface CaptureChunk {
    source: TranscriptSource;
    samples: Float32Array;
}

/** What the capture page posts: chunks, then once stopping, an end marker after the last one. */
export type CaptureMessage = CaptureChunk | { end: true };
