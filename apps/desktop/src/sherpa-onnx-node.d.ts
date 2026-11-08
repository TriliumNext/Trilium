declare module "sherpa-onnx-node" {
    /** The sherpa-onnx version of the native addon. */
    export const version: string;

    export interface OfflineStream {
        acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void;
    }

    export class OfflineRecognizer {
        static createAsync(config: object): Promise<OfflineRecognizer>;
        createStream(): OfflineStream;
        /** `timestamps` holds each token's start in seconds from the start of the stream. */
        decodeAsync(stream: OfflineStream): Promise<{
            text: string;
            tokens: string[];
            timestamps: number[];
        }>;
    }

    export interface SpeakerEmbeddingStream {
        acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void;
        inputFinished(): void;
    }

    export class SpeakerEmbeddingExtractor {
        constructor(config: object);
        createStream(): SpeakerEmbeddingStream;
        isReady(stream: SpeakerEmbeddingStream): boolean;
        compute(stream: SpeakerEmbeddingStream, enableExternalBuffer: boolean): Float32Array;
    }

    export class Vad {
        constructor(config: object, bufferSizeInSeconds: number);
        acceptWaveform(samples: Float32Array): void;
        isEmpty(): boolean;
        isDetected(): boolean;
        front(enableExternalBuffer: boolean): { start: number; samples: Float32Array };
        pop(): void;
        flush(): void;
    }
}
