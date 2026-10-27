import type { TranscriptSource, TranscriptUtterance } from "@triliumnext/commons";
import { type MessagePortMain, utilityProcess, type UtilityProcess } from "electron";
import fs from "fs";
import path from "path";

import type { Logger, WorkerEvent, WorkerRequest } from "./protocol";

export interface WorkerListeners {
    onUtterance(utterance: TranscriptUtterance): void;
    onPendingChanged(sources: TranscriptSource[]): void;
    /** Called with the RMS of each chunk a source delivers, from 0 to 1. */
    onLevel(source: TranscriptSource, level: number): void;
    /** Called when the process ends without having been stopped, as when it crashes. */
    onUnexpectedExit(code: number): void;
    log: Logger;
}

type ReadyEvent = Extract<WorkerEvent, { type: "ready" }>;
type StartRequest = Extract<WorkerRequest, { type: "start" }>;

/** How long {@link TranscriptionWorker.stop} waits for the speech still queued. */
const STOP_TIMEOUT_MS = 2 * 60 * 1000;
/** How long {@link probeEngine} waits for the transcription process to load sherpa-onnx. */
const PROBE_TIMEOUT_MS = 30 * 1000;

/**
 * The transcription process (`transcription_worker.ts`), from the main process: starts it,
 * connects the capture page to it and relays what it reports. One instance runs one recording;
 * the process ends with it.
 */
export class TranscriptionWorker {
    private readonly child: UtilityProcess;
    private startRequest: { resolve(event: ReadyEvent): void; reject(error: Error): void } | null =
        null;
    private isStopping = false;
    private hasExited = false;

    constructor(private readonly listeners: WorkerListeners) {
        this.child = forkWorker();
        this.child.on("message", (event: WorkerEvent) => this.handle(event));
        this.child.on("exit", (code) => this.handleExit(code));
    }

    /** Loads the engine and starts the recording, without capturing yet. */
    start(request: Omit<StartRequest, "type">) {
        return new Promise<ReadyEvent>((resolve, reject) => {
            this.startRequest = { resolve, reject };
            this.child.postMessage({ type: "start", ...request } satisfies WorkerRequest);
        });
    }

    /** Hands over the port the capture page posts its samples to. */
    connectCapture(port: MessagePortMain) {
        this.child.postMessage({ type: "capture" } satisfies WorkerRequest, [ port ]);
    }

    /**
     * Waits until the speech already captured has been reported, then ends the process. Ends it
     * regardless after {@link STOP_TIMEOUT_MS}.
     */
    async stop() {
        if (this.hasExited) {
            return;
        }
        this.isStopping = true;
        const exited = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
        const timeout = setTimeout(() => {
            this.listeners.log.error(
                "Transcription: the transcription process did not stop in time.");
            this.child.kill();
        }, STOP_TIMEOUT_MS);
        this.child.postMessage({ type: "stop" } satisfies WorkerRequest);
        await exited;
        clearTimeout(timeout);
    }

    /** Ends the process at once, dropping what it has not reported. */
    kill() {
        this.isStopping = true;
        this.child.kill();
    }

    private handle(event: WorkerEvent) {
        switch (event.type) {
            case "ready":
                this.startRequest?.resolve(event);
                this.startRequest = null;
                break;
            case "failed":
                this.startRequest?.reject(new Error(event.message));
                this.startRequest = null;
                break;
            case "pending":
                this.listeners.onPendingChanged(event.sources);
                break;
            case "utterance":
                this.listeners.onUtterance(event.utterance);
                break;
            case "level":
                this.listeners.onLevel(event.source, event.level);
                break;
            case "log":
                this.listeners.log[event.level](event.message);
                break;
            case "stopped":
                this.child.kill();
                break;
        }
    }

    private handleExit(code: number) {
        this.hasExited = true;
        const error = new Error(`The transcription process exited with code ${code}.`);
        if (this.startRequest) {
            this.startRequest.reject(error);
            this.startRequest = null;
        } else if (!this.isStopping) {
            this.listeners.onUnexpectedExit(code);
        }
    }
}

/**
 * Starts a transcription process that only loads sherpa-onnx's native addon, without any model,
 * and ends it.
 *
 * @returns `null` once the addon loaded, or why it did not.
 */
export function probeEngine() {
    return new Promise<string | null>((resolve) => {
        const child = forkWorker();
        const timeout = setTimeout(
            () => finish("The transcription process did not answer in time."), PROBE_TIMEOUT_MS);
        function finish(error: string | null) {
            clearTimeout(timeout);
            child.removeAllListeners();
            child.kill();
            resolve(error);
        }

        child.on("message", (event: WorkerEvent) => {
            if (event.type === "probed") {
                finish("error" in event ? event.error : null);
            }
        });
        child.on("exit", (code) => finish(`The transcription process exited with code ${code}.`));
        child.postMessage({ type: "probe" } satisfies WorkerRequest);
    });
}

function forkWorker() {
    return utilityProcess.fork(getWorkerEntry(), [], { serviceName: "Trilium transcription" });
}

/**
 * The bundled `transcription_worker.cjs` beside the main bundle, or the TypeScript when running
 * from sources, which the utility process reads through the `--import tsx` it inherits in
 * `NODE_OPTIONS`.
 */
function getWorkerEntry() {
    const candidates = [
        path.join(__dirname, "transcription_worker.cjs"),
        path.join(__dirname, "transcription_worker.ts")
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}
