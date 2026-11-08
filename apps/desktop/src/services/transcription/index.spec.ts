import type { TranscriptionState } from "@triliumnext/commons";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CaptureWindowOptions } from "./capture";
import type { WorkerListeners } from "./worker_client";

const h = vi.hoisted(() => ({
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    appListeners: new Map<string, (...args: unknown[]) => unknown>(),
    quit: vi.fn(),
    broadcast: [] as TranscriptionState[],
    levels: [] as [ string, number ][],
    notes: new Set<string>([ "meeting" ]),
    isProtected: false,
    isProtectedSessionAvailable: false,
    coreListeners: new Map<string, () => void>(),
    keepRecordings: false,
    mkdirSync: vi.fn(),
    installedResources: [] as string[],
    transcriptionModel: null as string | null,
    speakersEnabled: true,
    registerResource: vi.fn(),
    log: { info: vi.fn(), error: vi.fn() },
    probe: vi.fn(),
    listeners: null as WorkerListeners | null,
    captureOptions: null as CaptureWindowOptions | null,
    worker: { start: vi.fn(), connectCapture: vi.fn(), stop: vi.fn(), kill: vi.fn() },
    capture: { start: vi.fn(), stop: vi.fn() },
    sink: { open: vi.fn(), write: vi.fn(), save: vi.fn(), renameSpeaker: vi.fn() }
}));

vi.mock("electron", () => ({
    app: {
        on: (event: string, listener: (...args: unknown[]) => unknown) =>
            h.appListeners.set(event, listener),
        quit: h.quit
    },
    ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
            h.handlers.set(channel, handler)
    },
    BrowserWindow: {
        getAllWindows: () => [ 1, 2 ].map(() => ({
            webContents: {
                send: (channel: string, ...args: unknown[]) => {
                    if (channel === "transcription-state") {
                        h.broadcast.push(args[0] as TranscriptionState);
                    } else if (channel === "transcription-level") {
                        h.levels.push(args as [ string, number ]);
                    }
                }
            }
        }))
    },
    MessageChannelMain: class {
        port1 = "capture end";
        port2 = "worker end";
    }
}));
vi.mock("@triliumnext/core", () => ({
    becca: {
        getNote: (noteId: string) =>
            h.notes.has(noteId) ? { noteId, isProtected: h.isProtected } : null
    },
    events: {
        ENTER_PROTECTED_SESSION: "ENTER_PROTECTED_SESSION",
        subscribe: (event: string, listener: () => void) => h.coreListeners.set(event, listener)
    },
    getLog: () => h.log,
    options: {
        getOptionOrNull: (name: string) => name === "transcriptionModel" ? h.transcriptionModel : null,
        getOptionBool: (name: string) =>
            (name === "transcriptionSpeakersEnabled" && h.speakersEnabled)
            || (name === "transcriptionKeepRecordings" && h.keepRecordings)
    },
    protected_session: { isProtectedSessionAvailable: () => h.isProtectedSessionAvailable },
}));
vi.mock("fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs")>();
    return { default: { ...actual, mkdirSync: h.mkdirSync } };
});
vi.mock("i18next", () => ({
    t: (key: string, options?: object) => options ? `${key} ${JSON.stringify(options)}` : key
}));
vi.mock("@triliumnext/server/src/services/data_dir.js", () => ({
    default: { TRILIUM_DATA_DIR: "data" }
}));
vi.mock("@triliumnext/server/src/services/resources.js", () => ({
    default: {
        register: h.registerResource,
        getPath: (id: string) => h.installedResources.includes(id) ? `/data/resources/${id}` : null
    }
}));
vi.mock("./capture", () => ({
    CaptureWindow: class {
        start = h.capture.start;
        stop = h.capture.stop;

        constructor(options: CaptureWindowOptions) {
            h.captureOptions = options;
        }
    }
}));
vi.mock("./attachment_sink", () => ({
    AttachmentSink: class {
        open = h.sink.open;
        write = h.sink.write;
        save = h.sink.save;
        renameSpeaker = h.sink.renameSpeaker;
        attachmentId = "transcript1";

        constructor(readonly noteId: string) {}
    }
}));
vi.mock("./worker_client", () => ({
    probeEngine: h.probe,
    TranscriptionWorker: class {
        start = h.worker.start;
        connectCapture = h.worker.connectCapture;
        stop = h.worker.stop;
        kill = h.worker.kill;

        constructor(listeners: WorkerListeners) {
            h.listeners = listeners;
        }
    }
}));

const IDLE: TranscriptionState = { status: "idle", noteId: null, pendingSources: [] };
const STARTED_AT = Date.parse("2026-10-14T09:30:00.000Z");

async function loadService() {
    vi.resetModules();
    const service = await import("./index");
    service.setupTranscriptionHandlers();
    return (channel: string, ...args: unknown[]) => h.handlers.get(channel)?.({}, ...args);
}

beforeEach(() => {
    vi.clearAllMocks();
    h.handlers.clear();
    h.appListeners.clear();
    h.coreListeners.clear();
    h.isProtected = false;
    h.isProtectedSessionAvailable = false;
    h.broadcast.length = 0;
    h.levels.length = 0;
    h.keepRecordings = false;
    h.transcriptionModel = null;
    h.speakersEnabled = true;
    h.installedResources = [
        "transcription.parakeet", "transcription.silero-vad", "transcription.titanet"
    ];
    h.listeners = null;
    h.worker.start.mockResolvedValue({ type: "ready", startedAt: STARTED_AT, settings: {} });
    h.capture.start.mockResolvedValue([ "microphone", "system" ]);
    h.worker.stop.mockResolvedValue(undefined);
    h.capture.stop.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.useRealTimers();
});

describe("transcription IPC", () => {
    it("records one meeting at a time and tells every window about each step", async () => {
        const invoke = await loadService();

        expect(await invoke("transcription-start", "meeting")).toBe("");
        expect(await invoke("transcription-start", "meeting"))
            .toBe("transcription.already-recording");
        expect(await invoke("transcription-get-state")).toEqual({
            status: "recording", noteId: "meeting", pendingSources: [], startedAt: STARTED_AT
        });

        await invoke("transcription-stop");
        expect(h.capture.stop.mock.invocationCallOrder[0])
            .toBeLessThan(h.worker.stop.mock.invocationCallOrder[0]);
        expect(h.broadcast.map((state) => state.status)).toEqual([
            "starting", "starting", "recording", "recording",
            "stopping", "stopping", "idle", "idle"
        ]);
        expect(await invoke("transcription-get-state")).toEqual(IDLE);
    });

    it("stops the engine only once the capture window has posted what it still held", async () => {
        const invoke = await loadService();
        await invoke("transcription-start", "meeting");
        let finishCapture = () => {};
        h.capture.stop.mockImplementationOnce(() => new Promise<void>((resolve) => {
            finishCapture = resolve;
        }));

        const stopped = invoke("transcription-stop");
        await Promise.resolve();
        expect(h.capture.stop).toHaveBeenCalledOnce();
        expect(h.worker.stop).not.toHaveBeenCalled();
        finishCapture();
        await stopped;
        expect(h.worker.stop).toHaveBeenCalledOnce();
    });

    it("connects the capture window to the transcription process once that is ready", async () => {
        const invoke = await loadService();
        await invoke("transcription-start", "meeting");

        expect(h.worker.start).toHaveBeenCalledExactlyOnceWith({
            noteId: "meeting",
            models: {
                recognizer: { directory: "/data/resources/transcription.parakeet", precision: "int8" },
                vad: path.join("/data/resources/transcription.silero-vad", "silero_vad.onnx"),
                speaker: path.join("/data/resources/transcription.titanet", "nemo_en_titanet_small.onnx")
            },
            recordingDirectory: null
        });
        expect(h.sink.open).toHaveBeenCalledExactlyOnceWith(STARTED_AT);
        expect(h.worker.connectCapture).toHaveBeenCalledExactlyOnceWith("worker end");
        expect(h.capture.start).toHaveBeenCalledExactlyOnceWith("capture end");
        expect(h.sink.open.mock.invocationCallOrder[0])
            .toBeLessThan(h.capture.start.mock.invocationCallOrder[0]);
    });

    it("stores the utterances and tells every window which sources are pending", async () => {
        const invoke = await loadService();
        await invoke("transcription-start", "meeting");
        const utterance = { source: "system" as const, offsetMs: 0, text: "Hi" };

        h.listeners?.onUtterance(utterance);
        h.sink.write.mockImplementationOnce(() => {
            throw new Error("note deleted");
        });
        h.listeners?.onUtterance(utterance);
        expect(h.sink.write).toHaveBeenCalledTimes(2);
        expect(h.log.error).toHaveBeenCalledWith(
            "Transcription: saving an utterance failed: Error: note deleted");

        h.listeners?.onPendingChanged([ "system" ]);
        expect(h.broadcast.at(-1)).toEqual({
            status: "recording", noteId: "meeting", pendingSources: [ "system" ], startedAt: STARTED_AT
        });
        expect(await invoke("transcription-get-state")).toEqual(h.broadcast.at(-1));

        await invoke("transcription-stop");
        const stopping = h.broadcast.find((state) => state.status === "stopping");
        expect(stopping?.pendingSources).toEqual([ "system" ]);
        expect(h.broadcast.at(-1)).toEqual(IDLE);
    });

    it("passes each source's level on to every window", async () => {
        const invoke = await loadService();
        await invoke("transcription-start", "meeting");
        h.listeners?.onLevel("system", 0.125);
        expect(h.levels).toEqual([ [ "system", 0.125 ], [ "system", 0.125 ] ]);
    });

    it("flags a source no audio has come from for 10 s, until it comes again", async () => {
        const invoke = await loadService();
        vi.useFakeTimers();
        await invoke("transcription-start", "meeting");
        const recording = {
            status: "recording", noteId: "meeting", pendingSources: [], startedAt: STARTED_AT
        };
        const tick = async () => {
            await vi.advanceTimersByTimeAsync(1000);
            h.listeners?.onLevel("system", 0.1);
        };

        for (let second = 1; second < 10; second++) {
            await tick();
        }
        expect(h.broadcast.at(-1)).toEqual(recording);
        await tick();
        expect(h.broadcast.at(-1))
            .toEqual({ ...recording, sourceIssues: { microphone: "no_audio" } });
        expect(await invoke("transcription-get-state")).toEqual(h.broadcast.at(-1));
        expect(h.log.error).toHaveBeenCalledExactlyOnceWith(
            "Transcription: no audio from the microphone for 10 s.");
        const flagged = h.broadcast.length;
        await tick();
        expect(h.broadcast).toHaveLength(flagged);

        h.listeners?.onLevel("microphone", 0);
        expect(h.broadcast.at(-1)).toEqual(recording);
        expect(h.log.info).toHaveBeenCalledWith("Transcription: audio from the microphone again.");

        await invoke("transcription-stop");
        const stopped = h.broadcast.length;
        await vi.advanceTimersByTimeAsync(20_000);
        expect(h.broadcast).toHaveLength(stopped);
        vi.useRealTimers();
    });

    it("flags a source that could not be captured from the start, and never as stalled", async () => {
        const invoke = await loadService();
        vi.useFakeTimers();
        h.capture.start.mockResolvedValue([ "microphone" ]);
        await invoke("transcription-start", "meeting");
        const recording = {
            status: "recording", noteId: "meeting", pendingSources: [], startedAt: STARTED_AT,
            sourceIssues: { system: "not_captured" }
        };

        expect(h.broadcast.at(-1)).toEqual(recording);
        for (let second = 1; second <= 12; second++) {
            await vi.advanceTimersByTimeAsync(1000);
            h.listeners?.onLevel("microphone", 0.1);
        }
        expect(h.broadcast.at(-1)).toEqual(recording);
        await invoke("transcription-stop");
        expect(h.broadcast.at(-1)).toEqual(IDLE);
    });

    it("flags a source that delivers only silence, the microphone sooner, until it sounds", async () => {
        const invoke = await loadService();
        vi.useFakeTimers();
        await invoke("transcription-start", "meeting");
        const recording = {
            status: "recording", noteId: "meeting", pendingSources: [], startedAt: STARTED_AT
        };
        const runFor = async (seconds: number) => {
            for (let second = 0; second < seconds; second++) {
                await vi.advanceTimersByTimeAsync(1000);
                h.listeners?.onLevel("microphone", 0);
                h.listeners?.onLevel("system", 0);
            }
        };

        await runFor(14);
        expect(h.broadcast.at(-1)).toEqual(recording);
        await runFor(1);
        expect(h.broadcast.at(-1)).toEqual({ ...recording, sourceIssues: { microphone: "silent" } });
        expect(h.log.error).toHaveBeenCalledExactlyOnceWith(
            "Transcription: only silence from the microphone for 15 s.");

        h.listeners?.onLevel("microphone", 0.01);
        expect(h.broadcast.at(-1)).toEqual(recording);
        expect(h.log.info).toHaveBeenCalledWith("Transcription: audio from the microphone again.");

        await runFor(45);
        expect(h.broadcast.at(-1)).toEqual({
            ...recording, sourceIssues: { microphone: "silent", system: "silent" }
        });
        expect(h.log.error).toHaveBeenCalledWith(
            "Transcription: only silence from the system for 60 s.");
        await invoke("transcription-stop");
        vi.useRealTimers();
    });

    it("says once that a locked protected session holds back the transcript, and saves it on unlocking", async () => {
        h.isProtected = true;
        const invoke = await loadService();
        await invoke("transcription-start", "meeting");
        h.sink.write.mockImplementation(() => {
            throw new Error("Cannot update content of blob since protected session is not available.");
        });
        const utterance = { source: "system" as const, offsetMs: 0, text: "Hi" };

        h.listeners?.onUtterance(utterance);
        h.listeners?.onUtterance(utterance);
        const errors = h.broadcast.filter((state) => state.error);
        expect(errors).toEqual([ 1, 2 ].map(() => ({
            status: "recording", noteId: "meeting", pendingSources: [], startedAt: STARTED_AT,
            error: "transcription.save-locked"
        })));
        expect(await invoke("transcription-get-state")).not.toHaveProperty("error");

        await invoke("transcription-stop");
        h.coreListeners.get("ENTER_PROTECTED_SESSION")?.();
        expect(h.sink.save).toHaveBeenCalledOnce();
        h.coreListeners.get("ENTER_PROTECTED_SESSION")?.();
        expect(h.sink.save).toHaveBeenCalledOnce();
        h.sink.write.mockReset();
    });

    it("says why an unprotected transcript cannot be saved, and retries until a save works", async () => {
        const invoke = await loadService();
        await invoke("transcription-start", "meeting");
        h.sink.write.mockImplementationOnce(() => {
            throw new Error("disk full");
        });
        h.listeners?.onUtterance({ source: "system", offsetMs: 0, text: "Hi" });
        expect(h.broadcast.at(-1)?.error)
            .toBe(`transcription.save-failed {"message":"disk full"}`);
        await invoke("transcription-stop");

        h.sink.save.mockImplementationOnce(() => {
            throw new Error("still locked");
        });
        h.coreListeners.get("ENTER_PROTECTED_SESSION")?.();
        expect(h.log.error).toHaveBeenCalledWith(
            "Transcription: saving a transcript still failed: Error: still locked");
        h.coreListeners.get("ENTER_PROTECTED_SESSION")?.();
        h.coreListeners.get("ENTER_PROTECTED_SESSION")?.();
        expect(h.sink.save).toHaveBeenCalledTimes(2);
    });

    it("ignores a lost capture or a dead process once the recording has stopped", async () => {
        const invoke = await loadService();
        await invoke("transcription-start", "meeting");
        await invoke("transcription-stop");
        const broadcasts = h.broadcast.length;

        h.captureOptions?.onLost("the capture page ended (killed)");
        h.listeners?.onUnexpectedExit(0);
        await new Promise((resolve) => setTimeout(resolve));
        expect(h.broadcast).toHaveLength(broadcasts);
        expect(h.worker.stop).toHaveBeenCalledOnce();
    });

    it("renames a speaker through the recording that writes the transcript, until it stops", async () => {
        const invoke = await loadService();
        const rename = (attachmentId: unknown, key: unknown, name: unknown) =>
            invoke("transcription-rename-speaker", attachmentId, key, name);
        expect(await rename("transcript1", "system:1", "Alexandra")).toBe(false);

        await invoke("transcription-start", "meeting");
        expect(await rename("transcript1", "system:1", "Alexandra")).toBe(true);
        expect(h.sink.renameSpeaker).toHaveBeenCalledExactlyOnceWith("system:1", "Alexandra");
        // An older transcript of the same note is not the one the recording writes.
        expect(await rename("olderTranscript", "system:1", "Bob")).toBe(false);
        expect(await rename("transcript1", "system:1", 42)).toBe(false);

        let finishStopping = () => {};
        h.worker.stop.mockImplementationOnce(() => new Promise<void>((resolve) => {
            finishStopping = resolve;
        }));
        const stopped = invoke("transcription-stop");
        expect(await rename("transcript1", "microphone", "Elian")).toBe(true);
        finishStopping();
        await stopped;
        expect(await rename("transcript1", "microphone", "Elian")).toBe(false);
        expect(h.sink.renameSpeaker).toHaveBeenCalledTimes(2);
    });

    it("keeps the audio and the transcript as produced only while the option is on", async () => {
        vi.useFakeTimers({ now: STARTED_AT, toFake: [ "Date" ] });
        const invoke = await loadService();

        await invoke("transcription-start", "meeting");
        expect(h.worker.start.mock.calls[0][0].recordingDirectory).toBeNull();
        await invoke("transcription-stop");

        h.keepRecordings = true;
        await invoke("transcription-start", "meeting");
        expect(h.worker.start.mock.calls[1][0].recordingDirectory)
            .toBe(path.resolve("data", "transcription-recordings", "2026-10-14T09-30-00-000Z_meeting"));
        vi.useRealTimers();
    });

    it("is supported where the engine loads, probing once per run and logging why it did not", async () => {
        h.probe.mockResolvedValue(null);
        let invoke = await loadService();
        expect(await invoke("transcription-is-supported")).toBe(true);
        expect(await invoke("transcription-is-supported")).toBe(true);
        expect(h.probe).toHaveBeenCalledOnce();
        expect(h.log.error).not.toHaveBeenCalled();

        h.probe.mockResolvedValue("libstdc++.so.6: version `GLIBCXX_3.4.29' not found");
        invoke = await loadService();
        expect(await invoke("transcription-is-supported")).toBe(false);
        expect(h.log.error).toHaveBeenCalledExactlyOnceWith("Transcription is unavailable on "
            + "this computer: libstdc++.so.6: version `GLIBCXX_3.4.29' not found");
    });

    it("tells where the recordings are kept, as an absolute path, creating the directory", async () => {
        const invoke = await loadService();
        const directory = path.resolve("data", "transcription-recordings");
        expect(await invoke("transcription-get-recordings-directory")).toBe(directory);
        expect(path.isAbsolute(directory)).toBe(true);
        expect(h.mkdirSync).toHaveBeenCalledExactlyOnceWith(directory, { recursive: true });
    });

    it("refuses a missing note or model, without changing state", async () => {
        const invoke = await loadService();

        expect(await invoke("transcription-start", "deleted")).toBe("transcription.note-not-found");
        expect(await invoke("transcription-start", { noteId: "meeting" }))
            .toBe("transcription.note-not-found");
        h.installedResources = [ "transcription.parakeet", "transcription.titanet" ];
        expect(await invoke("transcription-start", "meeting"))
            .toBe("transcription.model-not-downloaded");
        expect(h.listeners).toBeNull();
        expect(h.broadcast).toEqual([]);
    });

    it("registers every model, and records without the speaker model", async () => {
        const invoke = await loadService();
        expect(h.registerResource.mock.calls[0].map(({ id }: { id: string }) => id)).toEqual([
            "transcription.parakeet", "transcription.parakeet-fp32", "transcription.silero-vad",
            "transcription.titanet"
        ]);

        h.installedResources = [ "transcription.parakeet", "transcription.silero-vad" ];
        expect(await invoke("transcription-start", "meeting")).toBe("");
        expect(h.worker.start.mock.calls[0][0].models.speaker).toBeNull();
    });

    it("records without the speaker model while speaker identification is off", async () => {
        const invoke = await loadService();
        h.speakersEnabled = false;
        expect(await invoke("transcription-start", "meeting")).toBe("");
        expect(h.worker.start.mock.calls[0][0].models.speaker).toBeNull();
    });

    it("records with the model the option selects, refusing while it is not downloaded", async () => {
        const invoke = await loadService();
        h.transcriptionModel = "parakeet-fp32";
        expect(await invoke("transcription-start", "meeting"))
            .toBe("transcription.model-not-downloaded");

        h.installedResources.push("transcription.parakeet-fp32");
        expect(await invoke("transcription-start", "meeting")).toBe("");
        expect(h.worker.start.mock.calls[0][0].models.recognizer).toEqual({
            directory: "/data/resources/transcription.parakeet-fp32", precision: "fp32"
        });
    });

    it("explains why it could not start, ends the process and returns to idle", async () => {
        const invoke = await loadService();

        h.worker.start.mockRejectedValueOnce(new Error("Protobuf parsing failed"));
        expect(await invoke("transcription-start", "meeting"))
            .toBe(`transcription.start-failed {"message":"Protobuf parsing failed"}`);
        expect(h.capture.start).not.toHaveBeenCalled();

        h.capture.start.mockRejectedValueOnce(new Error("No audio source could be captured."));
        expect(await invoke("transcription-start", "meeting"))
            .toBe(`transcription.start-failed {"message":"No audio source could be captured."}`);

        expect(h.worker.kill).toHaveBeenCalledTimes(2);
        expect(h.capture.stop).toHaveBeenCalledTimes(2);
        expect(await invoke("transcription-get-state")).toEqual(IDLE);
        await invoke("transcription-stop");
        expect(h.worker.stop).not.toHaveBeenCalled();
    });

    it("stops a recording whose capture was lost, keeping its queued speech, and says why", async () => {
        const invoke = await loadService();
        await invoke("transcription-start", "meeting");

        h.captureOptions?.onLost("every audio source ended");
        await vi.waitFor(() => expect(h.broadcast.at(-1))
            .toEqual({ ...IDLE, error: "transcription.capture-lost" }));
        expect(h.capture.stop).toHaveBeenCalledOnce();
        expect(h.worker.stop).toHaveBeenCalledOnce();
        expect(h.worker.kill).not.toHaveBeenCalled();
        expect(await invoke("transcription-get-state")).toEqual(IDLE);
        expect(h.log.error).toHaveBeenCalledWith(
            "Transcription: the capture stopped: every audio source ended.");
    });

    it("ends a recording whose transcription process died, and says why once", async () => {
        const invoke = await loadService();
        await invoke("transcription-start", "meeting");

        h.listeners?.onUnexpectedExit(139);
        expect(h.capture.stop).toHaveBeenCalledOnce();
        expect(h.broadcast.at(-1))
            .toEqual({ ...IDLE, error: "transcription.stopped-unexpectedly" });
        expect(await invoke("transcription-get-state")).toEqual(IDLE);
        expect(h.log.error).toHaveBeenCalledWith(
            "Transcription: the transcription process exited with code 139.");

        await invoke("transcription-stop");
        expect(h.worker.stop).not.toHaveBeenCalled();
        expect(await invoke("transcription-start", "meeting")).toBe("");
    });

    it("finishes the transcription before the application quits", async () => {
        const invoke = await loadService();
        const quit = () => {
            const event = { preventDefault: vi.fn() };
            h.appListeners.get("before-quit")?.(event);
            return event;
        };
        expect(quit().preventDefault).not.toHaveBeenCalled();

        await invoke("transcription-start", "meeting");
        let finishStopping = () => {};
        h.worker.stop.mockImplementationOnce(() => new Promise<void>((resolve) => {
            finishStopping = resolve;
        }));
        expect(quit().preventDefault).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(h.worker.stop).toHaveBeenCalledOnce());
        expect(quit().preventDefault).toHaveBeenCalledOnce();
        expect(h.quit).not.toHaveBeenCalled();

        finishStopping();
        await vi.waitFor(() => expect(h.quit).toHaveBeenCalledOnce());
        expect(await invoke("transcription-get-state")).toEqual(IDLE);
        expect(quit().preventDefault).not.toHaveBeenCalled();
    });

    it("quits regardless once the transcription takes too long to finish", async () => {
        const invoke = await loadService();
        await invoke("transcription-start", "meeting");
        h.worker.stop.mockImplementationOnce(() => new Promise<void>(() => {}));
        vi.useFakeTimers();

        h.appListeners.get("before-quit")?.({ preventDefault: vi.fn() });
        await vi.advanceTimersByTimeAsync(15_000);
        expect(h.quit).toHaveBeenCalledOnce();
        vi.useRealTimers();
    });
});
