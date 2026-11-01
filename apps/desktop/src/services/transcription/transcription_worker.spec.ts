import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkerEvent, WorkerRequest } from "./protocol";

const h = vi.hoisted(() => ({
    loadEngine: vi.fn(),
    probe: vi.fn(),
    fileSinks: [] as string[],
    recorders: [] as unknown[][]
}));

vi.mock("./engine", () => ({ loadSherpaEngine: h.loadEngine, probeSherpa: h.probe }));
vi.mock("./audio_recorder", () => ({
    TranscriptFileSink: class {
        constructor(directory: string) {
            h.fileSinks.push(directory);
        }
        write() {}
    },
    WavRecorder: class {
        constructor(...args: unknown[]) {
            h.recorders.push(args);
            (args[3] as { info(message: string): void }).info("keeping the audio");
        }
        write() {}
    }
}));

/** The parent port of an Electron utility process, as the transcription process uses it. */
class FakeParentPort extends EventEmitter {
    posted: WorkerEvent[] = [];
    postMessage = (event: WorkerEvent) => {
        this.posted.push(event);
    };

    send(request: WorkerRequest, ports: unknown[] = []) {
        this.emit("message", { data: request, ports });
    }

    /** Resolves with the first event of `type` posted so far or later. */
    async next(type: WorkerEvent["type"]) {
        await vi.waitFor(() => expect(this.posted.map((event) => event.type)).toContain(type));
        return this.posted.find((event) => event.type === type);
    }
}

/** An engine whose segmenter completes an utterance per chunk, transcribed as "Chunk <n>". */
const engine = {
    settings: { recognizer: { decodingMethod: "greedy_search" } },
    recognizer: {
        transcribe: async (samples: Float32Array) => ({ text: `Chunk ${samples[0]}`, words: [] })
    },
    createSegmenter: () => ({
        accept: (samples: Float32Array) => [ { start: 0, samples } ],
        flush: () => [],
        isSpeaking: () => false
    })
};

let parentPort: FakeParentPort;

async function startWorker() {
    parentPort = new FakeParentPort();
    Object.defineProperty(process, "parentPort", { value: parentPort, configurable: true });
    vi.resetModules();
    await import("./transcription_worker");
    return parentPort;
}

function capturePort() {
    return Object.assign(new EventEmitter(), { start: vi.fn(), close: vi.fn() });
}

const MODELS = {
    recognizer: { directory: "/models", precision: "int8" as const },
    vad: "/models/silero_vad.onnx",
    speaker: null
};

const START: WorkerRequest = {
    type: "start", noteId: "meeting", models: MODELS, recordingDirectory: null
};

beforeEach(() => {
    vi.clearAllMocks();
    h.fileSinks.length = 0;
    h.recorders.length = 0;
    h.loadEngine.mockResolvedValue(engine);
});

afterEach(() => {
    Reflect.deleteProperty(process, "parentPort");
    vi.useRealTimers();
});

describe("transcription process", () => {
    it("transcribes what the capture page posts, and stops once its last chunk arrived", async () => {
        const parent = await startWorker();
        parent.send(START);
        const ready = await parent.next("ready");
        expect(ready).toMatchObject({ type: "ready", settings: engine.settings });
        expect(h.loadEngine).toHaveBeenCalledExactlyOnceWith(MODELS);
        expect(h.fileSinks).toEqual([]);

        const port = capturePort();
        parent.send({ type: "capture" }, [ port ]);
        expect(port.start).toHaveBeenCalledOnce();
        port.emit("message", { data: { source: "system", samples: Float32Array.of(7) } });
        expect(await parent.next("utterance")).toMatchObject({
            utterance: { source: "system", text: "Chunk 7" }
        });

        parent.send({ type: "stop" });
        await new Promise((resolve) => setTimeout(resolve));
        expect(parent.posted.map((event) => event.type)).not.toContain("stopped");
        port.emit("message", { data: { end: true } });
        await parent.next("stopped");
        expect(port.close).toHaveBeenCalledOnce();
    });

    it("relays the session's errors, and stops even when its capture cannot close", async () => {
        const parent = await startWorker();
        h.loadEngine.mockResolvedValueOnce({
            ...engine,
            createSegmenter: () => {
                throw new Error("VAD model missing");
            }
        });
        parent.send(START);
        await parent.next("ready");
        parent.send({ type: "capture" });

        const port = capturePort();
        port.close.mockImplementation(() => {
            throw new Error("port already closed");
        });
        parent.send({ type: "capture" }, [ port ]);
        port.emit("message", { data: { source: "system", samples: Float32Array.of(1) } });
        expect(parent.posted).toContainEqual({
            type: "log", level: "error", message: "Transcription: system failed: VAD model missing"
        });

        port.emit("message", { data: { end: true } });
        parent.send({ type: "stop" });
        await parent.next("stopped");
        expect(parent.posted).toContainEqual({
            type: "log", level: "error",
            message: "Transcription: stopping failed: Error: port already closed"
        });
    });

    it("keeps the audio and the transcript of a development recording", async () => {
        const parent = await startWorker();
        parent.send({ ...START, recordingDirectory: "/recordings/meeting" });
        await parent.next("ready");

        expect(h.fileSinks).toEqual([ "/recordings/meeting" ]);
        expect(h.recorders).toEqual([
            [ "/recordings/meeting", "meeting", engine.settings, expect.anything() ]
        ]);
        expect(parent.posted).toContainEqual(
            { type: "log", level: "info", message: "keeping the audio" });
    });

    it("reports an engine that cannot load", async () => {
        h.loadEngine.mockRejectedValueOnce(new Error("Protobuf parsing failed"));
        const parent = await startWorker();
        parent.send(START);
        expect(await parent.next("failed"))
            .toEqual({ type: "failed", message: "Protobuf parsing failed" });
    });

    it("answers a probe with the engine's version, or why it did not load", async () => {
        h.probe.mockResolvedValueOnce("1.13.8");
        const parent = await startWorker();
        parent.send({ type: "probe" });
        expect(await parent.next("probed")).toEqual({ type: "probed", version: "1.13.8" });
        expect(h.loadEngine).not.toHaveBeenCalled();

        h.probe.mockRejectedValueOnce(new Error("Could not find sherpa-onnx-node."));
        const failing = await startWorker();
        failing.send({ type: "probe" });
        expect(await failing.next("probed"))
            .toEqual({ type: "probed", error: "Could not find sherpa-onnx-node." });
    });

    it("stops regardless when the capture page never posts its end", async () => {
        const parent = await startWorker();
        parent.send(START);
        await parent.next("ready");
        parent.send({ type: "capture" }, [ capturePort() ]);

        vi.useFakeTimers();
        parent.send({ type: "stop" });
        await vi.advanceTimersByTimeAsync(2000);
        vi.useRealTimers();
        await parent.next("stopped");
    });
});
