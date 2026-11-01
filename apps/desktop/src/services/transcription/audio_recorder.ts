import type { Transcript, TranscriptSource, TranscriptUtterance } from "@triliumnext/commons";
import fs from "fs";
import path from "path";

import { type Logger, SAMPLE_RATE } from "./protocol";
import type { AudioTap, TranscriptSink } from "./session";

/** The transcript the recording produced live, beside the audio it came from. */
export const TRANSCRIPT_FILE = "transcript.json";

/** The `recording.json` next to the audio files, which lines the sources up with the transcript. */
export interface RecordingManifest {
    noteId: string;
    /** When the recording started, as an ISO 8601 timestamp, like the transcript's `startedAt`. */
    startedAt: string;
    sampleRate: number;
    /** The settings of the engine that produced `transcript.json`. */
    engine: Record<string, unknown>;
    sources: Partial<Record<TranscriptSource, {
        file: string;
        /** Milliseconds from `startedAt` to the file's first sample. */
        firstSampleOffsetMs: number;
    }>>;
}

/**
 * Keeps a recording's audio in `directory` as one mono 16-bit WAV file per source, plus a
 * `recording.json` manifest. Each write also updates the WAV header, so the files stay playable if
 * the application quits mid-recording.
 */
export class WavRecorder implements AudioTap {
    private manifest: RecordingManifest | null = null;
    private readonly files = new Map<TranscriptSource, WavFile>();
    private failed = false;

    constructor(
        private readonly directory: string,
        private readonly noteId: string,
        private readonly engineSettings: Record<string, unknown>,
        private readonly log: Logger
    ) {}

    open(startedAt: number) {
        fs.mkdirSync(this.directory, { recursive: true });
        this.manifest = {
            noteId: this.noteId,
            startedAt: new Date(startedAt).toISOString(),
            sampleRate: SAMPLE_RATE,
            engine: this.engineSettings,
            sources: {}
        };
        this.writeManifest();
        this.log.info(`Transcription: keeping the audio in ${this.directory}`);
    }

    write(source: TranscriptSource, samples: Float32Array, firstSampleOffsetMs: number) {
        const { directory, manifest } = this;
        if (this.failed || !manifest) {
            return;
        }

        try {
            let file = this.files.get(source);
            if (!file) {
                const fileName = `${source}.wav`;
                file = new WavFile(path.join(directory, fileName));
                this.files.set(source, file);
                manifest.sources[source] = { file: fileName, firstSampleOffsetMs };
                this.writeManifest();
            }
            file.append(samples);
        } catch (e) {
            // Stops for good, so a full disk logs once rather than on every chunk.
            this.failed = true;
            this.log.error(`Transcription: stopped keeping the audio: ${e}`);
        }
    }

    close() {
        for (const file of this.files.values()) {
            file.close();
        }
        this.files.clear();
    }

    private writeManifest() {
        const manifestPath = path.join(this.directory, "recording.json");
        fs.writeFileSync(manifestPath, JSON.stringify(this.manifest, null, 2));
    }
}

/**
 * Writes the transcript to {@link TRANSCRIPT_FILE} in `directory` after every utterance, in the
 * format of the `transcript` attachment, so it stays as the recording produced it.
 */
export class TranscriptFileSink implements TranscriptSink {
    private transcript: Transcript | null = null;

    constructor(private readonly directory: string) {}

    open(startedAt: number) {
        fs.mkdirSync(this.directory, { recursive: true });
        this.transcript = {
            version: 1,
            startedAt: new Date(startedAt).toISOString(),
            utterances: []
        };
        this.save();
    }

    write(utterance: TranscriptUtterance) {
        if (!this.transcript) {
            throw new Error("The transcript file was not opened.");
        }
        this.transcript.utterances.push(utterance);
        this.save();
    }

    private save() {
        const filePath = path.join(this.directory, TRANSCRIPT_FILE);
        fs.writeFileSync(filePath, JSON.stringify(this.transcript, null, 2));
    }
}

const WAV_HEADER_SIZE = 44;
const BYTES_PER_SAMPLE = 2;

/** A mono 16-bit PCM WAV file at {@link SAMPLE_RATE}, written as samples arrive. */
class WavFile {
    private readonly fd: number;
    private dataSize = 0;

    constructor(filePath: string) {
        this.fd = fs.openSync(filePath, "w");
        fs.writeSync(this.fd, encodeWavHeader(0));
    }

    append(samples: Float32Array) {
        const pcm = toPcm16(samples);
        fs.writeSync(this.fd, pcm, 0, pcm.length, WAV_HEADER_SIZE + this.dataSize);
        this.dataSize += pcm.length;
        fs.writeSync(this.fd, encodeWavHeader(this.dataSize), 0, WAV_HEADER_SIZE, 0);
    }

    close() {
        fs.closeSync(this.fd);
    }
}

/** The 44-byte header of a mono 16-bit PCM WAV file whose samples take `dataSize` bytes. */
export function encodeWavHeader(dataSize: number) {
    const header = Buffer.alloc(WAV_HEADER_SIZE);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(WAV_HEADER_SIZE - 8 + dataSize, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
    header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
    header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(dataSize, 40);
    return header;
}

/** Converts samples in [-1, 1] to little-endian 16-bit PCM, clipping any beyond that range. */
export function toPcm16(samples: Float32Array) {
    const pcm = Buffer.alloc(samples.length * BYTES_PER_SAMPLE);
    for (const [ index, sample ] of samples.entries()) {
        const clipped = Math.max(-1, Math.min(1, sample));
        pcm.writeInt16LE(Math.round(clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff),
            index * BYTES_PER_SAMPLE);
    }
    return pcm;
}
