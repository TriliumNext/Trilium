import { EventEmitter } from "events";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { Logger, WorkerEvent } from "./protocol";
import { probeEngine, TranscriptionWorker, type WorkerListeners } from "./worker_client";

const h = vi.hoisted(() => ({
    fork: vi.fn(),
    hasBundle: false,
    hasSources: true
}));

vi.mock("electron", () => ({ utilityProcess: { fork: h.fork } }));
vi.mock("fs", () => ({
    default: {
        existsSync: (file: string) => file.endsWith(".cjs") ? h.hasBundle : h.hasSources
    }
}));

class FakeProcess extends EventEmitter {
    postMessage = vi.fn();
    kill = vi.fn(() => {
        this.emit("exit", 0);
        return true;
    });

    report(event: WorkerEvent) {
        this.emit("message", event);
    }
}

let child: FakeProcess;
let listeners: {
    [ name in keyof Omit<WorkerListeners, "log"> ]: Mock<WorkerListeners[name]>
} & { log: { info: Mock<Logger["info"]>; error: Mock<Logger["error"]> } };

beforeEach(() => {
    vi.clearAllMocks();
    h.hasBundle = false;
    h.hasSources = true;
    child = new FakeProcess();
    h.fork.mockReturnValue(child);
    listeners = {
        onUtterance: vi.fn(),
        onPendingChanged: vi.fn(),
        onLevel: vi.fn(),
        onUnexpectedExit: vi.fn(),
        log: { info: vi.fn(), error: vi.fn() }
    };
});

afterEach(() => {
    vi.useRealTimers();
});

const REQUEST = {
    noteId: "meeting",
    models: {
        recognizer: { directory: "/models", precision: "int8" as const },
        vad: "/models/silero_vad.onnx",
        speaker: null
    },
    recordingDirectory: null
};

describe("TranscriptionWorker", () => {
    it("starts the bundled worker, or the sources when there is no bundle", () => {
        new TranscriptionWorker(listeners);
        h.hasBundle = true;
        new TranscriptionWorker(listeners);
        // Neither: the bundle's path, so the failure names the file a build would have.
        h.hasBundle = false;
        h.hasSources = false;
        new TranscriptionWorker(listeners);

        expect(h.fork.mock.calls.map(([ file ]) => path.basename(file as string))).toEqual([
            "transcription_worker.ts", "transcription_worker.cjs", "transcription_worker.cjs"
        ]);
    });

    it("resolves once the engine is ready, then relays what the process reports", async () => {
        const worker = new TranscriptionWorker(listeners);
        const started = worker.start(REQUEST);
        expect(child.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "start", ...REQUEST });

        child.report({ type: "ready", startedAt: 1000, settings: { vad: {} } });
        await expect(started).resolves.toEqual({
            type: "ready", startedAt: 1000, settings: { vad: {} }
        });

        const port = { start: vi.fn() };
        worker.connectCapture(port as never);
        expect(child.postMessage).toHaveBeenLastCalledWith({ type: "capture" }, [ port ]);

        const utterance = { source: "system" as const, offsetMs: 0, text: "Hi" };
        child.report({ type: "utterance", utterance });
        child.report({ type: "pending", sources: [ "system" ] });
        child.report({ type: "log", level: "error", message: "system failed" });
        child.report({ type: "level", source: "microphone", level: 0.25 });
        expect(listeners.onLevel).toHaveBeenCalledExactlyOnceWith("microphone", 0.25);
        expect(listeners.onUtterance).toHaveBeenCalledExactlyOnceWith(utterance);
        expect(listeners.onPendingChanged).toHaveBeenCalledExactlyOnceWith([ "system" ]);
        expect(listeners.log.error).toHaveBeenCalledExactlyOnceWith("system failed");
    });

    it("rejects the start when the engine fails or the process dies first", async () => {
        const failing = new TranscriptionWorker(listeners).start(REQUEST);
        child.report({ type: "failed", message: "Protobuf parsing failed" });
        await expect(failing).rejects.toThrow("Protobuf parsing failed");

        child = new FakeProcess();
        h.fork.mockReturnValue(child);
        const crashing = new TranscriptionWorker(listeners).start(REQUEST);
        child.emit("exit", 139);
        await expect(crashing).rejects.toThrow("The transcription process exited with code 139.");
        expect(listeners.onUnexpectedExit).not.toHaveBeenCalled();
    });

    it("stops once the process has reported everything, then ends it", async () => {
        const worker = new TranscriptionWorker(listeners);
        let isStopped = false;
        const stopped = worker.stop().then(() => {
            isStopped = true;
        });
        expect(child.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "stop" });
        await Promise.resolve();
        expect(isStopped).toBe(false);

        child.report({ type: "stopped" });
        await stopped;
        expect(child.kill).toHaveBeenCalledOnce();
        expect(listeners.onUnexpectedExit).not.toHaveBeenCalled();
        await worker.stop();
        expect(child.postMessage).toHaveBeenCalledOnce();
    });

    it("ends a process that does not stop in time", async () => {
        vi.useFakeTimers();
        const worker = new TranscriptionWorker(listeners);
        const stopped = worker.stop();

        await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
        await stopped;
        expect(child.kill).toHaveBeenCalledOnce();
        expect(listeners.log.error).toHaveBeenCalledExactlyOnceWith(
            "Transcription: the transcription process did not stop in time.");
    });

    it("reports a process that exits while recording, but not one it ended", () => {
        new TranscriptionWorker(listeners);
        child.emit("exit", 139);
        expect(listeners.onUnexpectedExit).toHaveBeenCalledExactlyOnceWith(139);

        child = new FakeProcess();
        h.fork.mockReturnValue(child);
        new TranscriptionWorker(listeners).kill();
        expect(listeners.onUnexpectedExit).toHaveBeenCalledOnce();
    });
});

describe("probeEngine", () => {
    it("asks a process of its own to load the engine, and ends it with the answer", async () => {
        const loaded = probeEngine();
        expect(child.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "probe" });
        child.report({ type: "probed", version: "1.13.8" });
        expect(await loaded).toBeNull();
        expect(child.kill).toHaveBeenCalledOnce();

        child = new FakeProcess();
        h.fork.mockReturnValue(child);
        const failed = probeEngine();
        child.report({ type: "log", level: "info", message: "loading" });
        child.report({ type: "probed", error: "Could not find sherpa-onnx-node." });
        expect(await failed).toBe("Could not find sherpa-onnx-node.");
        expect(child.kill).toHaveBeenCalledOnce();
    });

    it("says so when the process dies or does not answer", async () => {
        const crashed = probeEngine();
        child.emit("exit", 133);
        expect(await crashed).toBe("The transcription process exited with code 133.");

        vi.useFakeTimers();
        child = new FakeProcess();
        h.fork.mockReturnValue(child);
        const silent = probeEngine();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(await silent).toBe("The transcription process did not answer in time.");
        expect(child.kill).toHaveBeenCalledOnce();
    });
});
