// Shared by replay.mjs and diarize.mjs: loading sherpa-onnx-node and cutting audio as the app does.

import { createRequire } from "node:module";
import path from "node:path";

export const SAMPLE_RATE = 16000;

/** The desktop app's sherpa-onnx-node, which runs in plain Node too. */
export function loadSherpa() {
    const repoRoot = path.resolve(import.meta.dirname, "../../..");
    const require = createRequire(path.join(repoRoot, "apps/desktop/package.json"));
    return require("sherpa-onnx-node");
}

/**
 * Cuts one source into utterances with Silero VAD, as the live `VadSegmenter` does: 512-sample
 * windows, then a flush at the end.
 */
export function* segmentSource(sherpa, samples, vadSettings, vadModel) {
    const windowSize = vadSettings.windowSize ?? 512;
    const vad = new sherpa.Vad({
        sileroVad: { model: vadModel, ...vadSettings, windowSize },
        sampleRate: SAMPLE_RATE,
        numThreads: 1,
        provider: "cpu"
    }, 60);
    const drain = function* () {
        while (!vad.isEmpty()) {
            yield vad.front();
            vad.pop();
        }
    };
    for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
        vad.acceptWaveform(samples.subarray(i, i + windowSize));
        yield* drain();
    }
    vad.flush();
    yield* drain();
}
