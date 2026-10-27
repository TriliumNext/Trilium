import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: never[]) => unknown;

const h = vi.hoisted(() => ({
    windows: [] as FakeWindow[],
    log: { info: vi.fn(), error: vi.fn() },
    sessionHandlers: {} as Record<string, Handler>,
    /** How the page answers each call; the default starts the source. */
    pageCalls: {} as Record<string, () => Promise<unknown>>
}));

/** The parts of a `BrowserWindow` the capture window uses. */
class FakeWindow {
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), {
        ipc: new EventEmitter(),
        postMessage: vi.fn(),
        executeJavaScript: vi.fn((call: string) =>
            h.pageCalls[call]?.() ?? Promise.resolve({ tracks: call }))
    });

    constructor() {
        h.windows.push(this);
    }

    loadFile = vi.fn(async () => {});
    isDestroyed = () => this.destroyed;
    destroy = vi.fn(() => {
        this.destroyed = true;
    });
}

vi.mock("electron", () => ({
    app: { getPath: () => "/tmp" },
    BrowserWindow: FakeWindow,
    session: {
        fromPartition: () => ({
            setPermissionRequestHandler: (handler: Handler) => {
                h.sessionHandlers.request = handler;
            },
            setPermissionCheckHandler: (handler: Handler) => {
                h.sessionHandlers.check = handler;
            },
            setDisplayMediaRequestHandler: (handler: Handler) => {
                h.sessionHandlers.displayMedia = handler;
            }
        })
    }
}));
vi.mock("fs", () => ({ default: { writeFileSync: vi.fn() } }));
vi.mock("@triliumnext/core", () => ({ getLog: () => h.log }));

const { CAPTURE_PROCESSOR, CaptureWindow } = await import("./capture");

interface FakeProcessor {
    port: {
        postMessage: ReturnType<typeof vi.fn>;
        onmessage: ((event: { data: unknown }) => void) | null;
    };
    process(inputs: Float32Array[][]): boolean;
}

/** Runs the worklet's source with fake `AudioWorkletProcessor` and `registerProcessor` globals. */
function createProcessor(chunkSamples: number, windowSamples: number): FakeProcessor {
    class AudioWorkletProcessor {
        port = { postMessage: vi.fn(), onmessage: null };
    }
    let Processor: (new (options: object) => FakeProcessor) | null = null;
    const registerProcessor = (_name: string, processor: typeof Processor) => {
        Processor = processor;
    };
    new Function("AudioWorkletProcessor", "registerProcessor", CAPTURE_PROCESSOR)(
        AudioWorkletProcessor, registerProcessor);
    if (!Processor) {
        throw new Error("The worklet registered no processor.");
    }
    return new (Processor as new (options: object) => FakeProcessor)({
        processorOptions: { chunkSamples, windowSamples }
    });
}

/** One 128-frame render quantum whose samples all hold `value`. */
function quantum(value: number) {
    return [ [ new Float32Array(128).fill(value) ] ];
}

describe("CAPTURE_PROCESSOR", () => {
    it("posts whole chunks, then on a flush what it holds, padded to whole windows", () => {
        const processor = createProcessor(512, 256);
        for (let i = 1; i <= 5; i++) {
            processor.process(quantum(i));
        }
        expect(processor.port.postMessage).toHaveBeenCalledOnce();
        expect([ ...processor.port.postMessage.mock.calls[0][0] as Float32Array ])
            .toEqual([ 1, 2, 3, 4 ].flatMap((value) => new Array(128).fill(value)));

        processor.port.onmessage?.({ data: "flush" });
        const [ , [ partial ], [ done ] ] = processor.port.postMessage.mock.calls;
        expect([ ...partial as Float32Array ])
            .toEqual([ ...new Array(128).fill(5), ...new Array(128).fill(0) ]);
        expect(done).toBe("flushed");

        processor.port.onmessage?.({ data: "flush" });
        expect(processor.port.postMessage.mock.calls.at(-1)?.[0]).toBe("flushed");
        expect(processor.port.postMessage).toHaveBeenCalledTimes(4);
    });
});

describe("CaptureWindow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.pageCalls = {};
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function startCapture() {
        h.windows.length = 0;
        const onLost = vi.fn();
        const capture = new CaptureWindow({ onLost });
        expect(await capture.start("port" as never)).toEqual([ "microphone", "system" ]);
        const window = h.windows[0];
        expect(window.webContents.postMessage)
            .toHaveBeenCalledExactlyOnceWith("transcription-capture-port", null, [ "port" ]);
        return { capture, onLost, window };
    }

    it("reports the capture lost when its page crashes", async () => {
        const { onLost, window } = await startCapture();
        window.webContents.emit("render-process-gone", {}, { reason: "oom" });
        window.webContents.emit("render-process-gone", {}, { reason: "oom" });
        expect(onLost).toHaveBeenCalledExactlyOnceWith("the capture page ended (oom)");
    });

    it("reports the capture lost when its page reloads", async () => {
        const { onLost, window } = await startCapture();
        const url = "file:///tmp/trilium-transcription.html";
        window.webContents.emit("did-start-navigation",
            { url: `${url}#x`, isMainFrame: true, isSameDocument: true });
        window.webContents.emit("did-start-navigation",
            { url, isMainFrame: false, isSameDocument: false });
        expect(onLost).not.toHaveBeenCalled();
        window.webContents.emit("did-start-navigation",
            { url, isMainFrame: true, isSameDocument: false });
        expect(onLost).toHaveBeenCalledExactlyOnceWith("the capture page reloaded");
    });

    it("reports the capture lost once every source has ended", async () => {
        const { onLost, window } = await startCapture();
        window.webContents.ipc.emit("transcription-source-ended", {}, "microphone");
        expect(onLost).not.toHaveBeenCalled();
        expect(h.log.error).toHaveBeenCalledWith("Transcription: the microphone source ended.");
        window.webContents.ipc.emit("transcription-source-ended", {}, "system");
        expect(onLost).toHaveBeenCalledExactlyOnceWith("every audio source ended");
    });

    it("finishes the page before closing it, and reports nothing once stopped", async () => {
        const { capture, onLost, window } = await startCapture();
        await capture.stop();
        expect(window.webContents.executeJavaScript).toHaveBeenLastCalledWith("finishCapture()");
        expect(window.destroy).toHaveBeenCalledOnce();

        window.webContents.emit("render-process-gone", {}, { reason: "killed" });
        expect(onLost).not.toHaveBeenCalled();
    });

    it("grants its page the microphone and its own audio, and nothing else", async () => {
        await startCapture();
        const request = h.sessionHandlers.request as (...args: unknown[]) => void;
        const check = h.sessionHandlers.check as (...args: unknown[]) => boolean;
        const answers: boolean[] = [];
        for (const permission of [ "media", "display-capture", "geolocation" ]) {
            request({}, permission, (granted: boolean) => answers.push(granted));
        }
        expect(answers).toEqual([ true, true, false ]);
        expect(check({}, "media")).toBe(true);
        expect(check({}, "notifications")).toBe(false);

        const displayMedia = h.sessionHandlers.displayMedia as (...args: unknown[]) => void;
        const callback = vi.fn();
        displayMedia({ frame: "the page" }, callback);
        displayMedia({}, callback);
        expect(callback.mock.calls).toEqual([
            [ { video: "the page", audio: "loopback" } ],
            [ { video: undefined, audio: "loopback" } ]
        ]);
    });

    it("logs what its page logs", async () => {
        const { window } = await startCapture();
        window.webContents.emit("console-message", { message: "System track muted=false" });
        expect(h.log.info).toHaveBeenCalledWith(
            "Transcription (capture): System track muted=false");
    });

    it("runs the sources that start, and fails when none does", async () => {
        h.pageCalls["run(captureSystemAudio)"] = () =>
            Promise.resolve({ error: "NotAllowedError: Permission denied" });
        h.windows.length = 0;
        const capture = new CaptureWindow({ onLost: vi.fn() });
        expect(await capture.start("port" as never)).toEqual([ "microphone" ]);
        expect(h.log.error).toHaveBeenCalledWith(
            "Transcription: system unavailable: NotAllowedError: Permission denied");

        h.pageCalls["run(captureMicrophone)"] = () =>
            Promise.reject(new Error("render frame was disposed"));
        await expect(new CaptureWindow({ onLost: vi.fn() }).start("port" as never))
            .rejects.toThrow("No audio source could be captured.");
        expect(h.windows[1].destroy).toHaveBeenCalledOnce();
    });

    it("closes a page that does not finish in time, and one that is already gone", async () => {
        const { capture, window } = await startCapture();
        h.pageCalls["finishCapture()"] = () => new Promise(() => {});
        vi.useFakeTimers();
        const stopped = capture.stop();
        await vi.advanceTimersByTimeAsync(1000);
        await stopped;
        expect(h.log.error).toHaveBeenCalledWith(
            "Transcription: finishing the capture failed: timed out");
        expect(window.destroy).toHaveBeenCalledOnce();

        const crashed = await startCapture();
        crashed.window.destroyed = true;
        await crashed.capture.stop();
        await crashed.capture.stop();
        expect(crashed.window.webContents.executeJavaScript)
            .not.toHaveBeenCalledWith("finishCapture()");
    });
});
