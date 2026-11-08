import type {
    TranscriptionState, TranscriptSource, TranscriptSourceIssue, TranscriptUtterance
} from "@triliumnext/commons";
import { becca, events, getLog, options, protected_session } from "@triliumnext/core";
import dataDirs from "@triliumnext/server/src/services/data_dir.js";
import resources from "@triliumnext/server/src/services/resources.js";
import { app, BrowserWindow, ipcMain, MessageChannelMain } from "electron";
import fs from "fs";
import { t } from "i18next";
import path from "path";

import { AttachmentSink } from "./attachment_sink";
import { CaptureWindow } from "./capture";
import { getModelPaths, TRANSCRIPTION_MODELS } from "./model";
import { probeEngine, TranscriptionWorker } from "./worker_client";

/**
 * Where the audio and the transcript as produced of each recording are kept, one directory per
 * recording, while `transcriptionKeepRecordings` is on.
 */
export const RECORDINGS_DIR = path.resolve(dataDirs.TRILIUM_DATA_DIR, "transcription-recordings");

const IDLE: TranscriptionState = { status: "idle", noteId: null, pendingSources: [] };

/** How long quitting waits for a running transcription to finish. */
const QUIT_TIMEOUT_MS = 15_000;

/**
 * How long a source can go without delivering a chunk before it counts as stalled. A silent
 * source still delivers chunks of silence, about four a second.
 */
const NO_AUDIO_MS = 10_000;

/**
 * How long a source can deliver only digital silence before it counts as silent. A working
 * microphone picks up some noise even in a quiet room, while the meeting audio is digital silence
 * whenever nobody speaks, so the meeting gets longer.
 */
const SILENCE_MS: Record<TranscriptSource, number> = {
    microphone: 15_000,
    system: 60_000
};
const SOURCES = Object.keys(SILENCE_MS) as TranscriptSource[];

interface Recording {
    worker: TranscriptionWorker;
    capture: CaptureWindow;
    /** When each captured source last delivered a chunk, in milliseconds since the epoch. */
    lastHeard: Map<TranscriptSource, number>;
    /** When each captured source last delivered a chunk that was not digital silence. */
    lastSound: Map<TranscriptSource, number>;
    audioCheck?: ReturnType<typeof setInterval>;
}

let state = IDLE;
let activeRecording: Recording | null = null;
/** The transcript the running recording writes, until its stop has written the last utterance. */
let writer: AttachmentSink | null = null;
/** The running stop, while the speech already captured is still being transcribed. */
let stopping: Promise<void> | null = null;
/**
 * Transcripts whose last utterances could not be saved, kept until a save succeeds: on the next
 * utterance, or once the protected session is entered.
 */
const unsavedSinks = new Set<AttachmentSink>();
/** `waiting` while a quit waits for the transcription, `done` once it may go ahead. */
let quitting: "no" | "waiting" | "done" = "no";
/** {@link isSupported}'s answer, once asked. */
let isSupportedHere: Promise<boolean> | null = null;

export function setupTranscriptionHandlers() {
    resources.register(...TRANSCRIPTION_MODELS);
    ipcMain.handle("transcription-is-supported", () => isSupported());
    ipcMain.handle("transcription-start", (_event, noteId: unknown) => startRecording(noteId));
    ipcMain.handle("transcription-stop", () => stopRecording());
    ipcMain.handle("transcription-get-state", () => getState());
    ipcMain.handle("transcription-get-recordings-directory", () => getRecordingsDirectory());
    ipcMain.handle("transcription-rename-speaker", (_event, attachmentId: unknown, key: unknown,
        name: unknown) => renameSpeaker(attachmentId, key, name));
    app.on("before-quit", (event) => finishBeforeQuit(event));
    events.subscribe(events.ENTER_PROTECTED_SESSION, () => saveUnsaved());
}

/**
 * Starts recording for the meeting note `noteId`. The engine runs in a utility process, which
 * the capture window posts its samples to; the main process only stores the utterances.
 *
 * @returns An empty string once recording runs, or the reason it cannot start.
 */
export async function startRecording(noteId: unknown): Promise<string> {
    if (state.status !== "idle") {
        return t("transcription.already-recording");
    }
    if (typeof noteId !== "string" || !becca.getNote(noteId)) {
        return t("transcription.note-not-found");
    }
    const models = getModelPaths(
        options.getOptionOrNull("transcriptionModel"),
        options.getOptionBool("transcriptionSpeakersEnabled")
    );
    if (!models) {
        return t("transcription.model-not-downloaded");
    }

    setState({ status: "starting", noteId, pendingSources: [] });
    const sink = new AttachmentSink(noteId);
    const recording: Recording = {
        capture: new CaptureWindow({
            onLost: (reason) => handleCaptureLost(recording, reason)
        }),
        worker: new TranscriptionWorker({
            onUtterance: (utterance) => writeUtterance(sink, noteId, utterance),
            onPendingChanged: (pendingSources) => setState({ ...state, pendingSources }),
            onLevel: (source, level) => handleLevel(recording, source, level),
            onUnexpectedExit: (code) => handleUnexpectedExit(recording, code),
            log: getLog()
        }),
        lastHeard: new Map(),
        lastSound: new Map()
    };
    activeRecording = recording;
    try {
        const { startedAt } = await recording.worker.start({
            noteId,
            models,
            recordingDirectory: options.getOptionBool("transcriptionKeepRecordings")
                ? getRecordingDirectory(Date.now(), noteId)
                : null
        });
        sink.open(startedAt);
        writer = sink;
        const { port1, port2 } = new MessageChannelMain();
        recording.worker.connectCapture(port2);
        const sources = await recording.capture.start(port1);
        getLog().info(`Transcription: recording ${sources.join(" and ")} for note ${noteId}.`);
        for (const source of sources) {
            recording.lastHeard.set(source, Date.now());
            recording.lastSound.set(source, Date.now());
        }
        recording.audioCheck = setInterval(() => updateSourceIssues(recording), 1000);
        setState({ ...state, status: "recording", startedAt });
        updateSourceIssues(recording);
        return "";
    } catch (e) {
        activeRecording = null;
        writer = null;
        clearInterval(recording.audioCheck);
        void recording.capture.stop();
        recording.worker.kill();
        setState(IDLE);
        getLog().error(`Transcription did not start: ${(e as Error)?.stack ?? e}`);
        return t("transcription.start-failed", { message: (e as Error)?.message ?? String(e) });
    }
}

/**
 * Stops the recording, resolving once its speech is transcribed; joins a stop that runs. An
 * `error` is reported to every window with the idle state that follows.
 */
export function stopRecording(error?: string): Promise<void> {
    const recording = activeRecording;
    if (state.status !== "recording" || !recording) {
        return stopping ?? Promise.resolve();
    }

    setState({ ...state, status: "stopping" });
    activeRecording = null;
    clearInterval(recording.audioCheck);
    const { noteId } = state;
    stopping = recording.capture.stop()
        .then(() => recording.worker.stop())
        .then(() => getLog().info(`Transcription: recording for note ${noteId} stopped.`))
        .finally(() => {
            stopping = null;
            writer = null;
            state = IDLE;
            broadcast(error ? { ...IDLE, error } : IDLE);
        });
    return stopping;
}

export function getState() {
    return state;
}

/**
 * Whether sherpa-onnx's native addon loads on this computer, which a transcription process tries
 * once per run, without any model. A build without the addon for this platform and processor, or
 * a system missing a library it needs, cannot transcribe.
 */
export function isSupported() {
    isSupportedHere ??= probeEngine().then((error) => {
        if (error) {
            getLog().error(`Transcription is unavailable on this computer: ${error}`);
        }
        return !error;
    });
    return isSupportedHere;
}

/**
 * Names a speaker of the transcript attachment `attachmentId` through the running recording's
 * sink, when that is the transcript it writes: the sink is then its only writer.
 *
 * @returns `false` when no recording writes `attachmentId`, or the arguments are not strings.
 */
export function renameSpeaker(attachmentId: unknown, key: unknown, name: unknown) {
    const isValid = typeof key === "string" && typeof name === "string";
    if (!writer || writer.attachmentId !== attachmentId || !isValid) {
        return false;
    }
    writer.renameSpeaker(key, name);
    return true;
}

/** Returns {@link RECORDINGS_DIR}, creating it so that the settings can open it before any recording. */
function getRecordingsDirectory() {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    return RECORDINGS_DIR;
}

/** The directory under {@link RECORDINGS_DIR} for a recording of `noteId` begun at `createdAt`. */
export function getRecordingDirectory(createdAt: number, noteId: string) {
    const timestamp = new Date(createdAt).toISOString().replace(/[:.]/g, "-");
    return path.join(RECORDINGS_DIR, `${timestamp}_${noteId}`);
}

/**
 * Holds back a quit while a transcription runs, until the speech already captured is transcribed
 * or {@link QUIT_TIMEOUT_MS} passes, then quits again.
 */
function finishBeforeQuit(event: Electron.Event) {
    if (quitting === "done") {
        return;
    }
    if (quitting === "waiting") {
        event.preventDefault();
        return;
    }
    const finished = state.status === "recording" ? stopRecording() : stopping;
    if (!finished) {
        return;
    }

    event.preventDefault();
    quitting = "waiting";
    const timeout = new Promise((resolve) => setTimeout(resolve, QUIT_TIMEOUT_MS));
    void Promise.race([ finished, timeout ]).finally(() => {
        quitting = "done";
        app.quit();
    });
}

/**
 * Saves an utterance. When that fails, the sink keeps it and every window is told once, until a
 * later save succeeds.
 */
function writeUtterance(sink: AttachmentSink, noteId: string, utterance: TranscriptUtterance) {
    try {
        sink.write(utterance);
        unsavedSinks.delete(sink);
    } catch (e) {
        getLog().error(`Transcription: saving an utterance failed: ${e}`);
        if (unsavedSinks.has(sink)) {
            return;
        }
        unsavedSinks.add(sink);
        const isLocked = becca.getNote(noteId)?.isProtected
            && !protected_session.isProtectedSessionAvailable();
        broadcast({
            ...state,
            error: isLocked
                ? t("transcription.save-locked")
                : t("transcription.save-failed", { message: (e as Error)?.message ?? String(e) })
        });
    }
}

/** Saves the transcripts that failed to save before, as while the protected session was locked. */
function saveUnsaved() {
    for (const sink of unsavedSinks) {
        try {
            sink.save();
            unsavedSinks.delete(sink);
            getLog().info("Transcription: saved a transcript that could not be saved before.");
        } catch (e) {
            getLog().error(`Transcription: saving a transcript still failed: ${e}`);
        }
    }
}

/** Stops a recording whose capture stopped on its own, transcribing what it captured. */
function handleCaptureLost(recording: Recording, reason: string) {
    if (activeRecording !== recording || state.status !== "recording") {
        return;
    }
    getLog().error(`Transcription: the capture stopped: ${reason}.`);
    void stopRecording(t("transcription.capture-lost"));
}

/**
 * Ends a recording whose transcription process died, keeping what was transcribed, and tells
 * every window why it ended.
 */
function handleUnexpectedExit(recording: Recording, code: number) {
    if (activeRecording !== recording) {
        return;
    }
    activeRecording = null;
    writer = null;
    clearInterval(recording.audioCheck);
    void recording.capture.stop();
    getLog().error(`Transcription: the transcription process exited with code ${code}.`);
    state = IDLE;
    broadcast({ ...IDLE, error: t("transcription.stopped-unexpectedly") });
}

/** Passes a source's level on to every window, and updates the sources' issues. */
function handleLevel(recording: Recording, source: TranscriptSource, level: number) {
    if (activeRecording !== recording) {
        return;
    }
    const now = Date.now();
    recording.lastHeard.set(source, now);
    if (level > 0) {
        recording.lastSound.set(source, now);
    }
    for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send("transcription-level", source, level);
    }
    updateSourceIssues(recording);
}

/** Works out the issue of every source, logs each one that changed, and reports them. */
function updateSourceIssues(recording: Recording) {
    if (activeRecording !== recording || state.status !== "recording") {
        return;
    }
    const now = Date.now();
    const current = state.sourceIssues ?? {};
    const issues: Partial<Record<TranscriptSource, TranscriptSourceIssue>> = {};
    let hasChanged = false;
    for (const source of SOURCES) {
        const issue = getSourceIssue(recording, source, now);
        if (issue) {
            issues[source] = issue;
        }
        if (issue !== current[source]) {
            hasChanged = true;
            logSourceIssue(source, issue);
        }
    }
    if (!hasChanged) {
        return;
    }
    const { sourceIssues: _, ...rest } = state;
    setState(Object.keys(issues).length ? { ...rest, sourceIssues: issues } : rest);
}

function getSourceIssue(
    recording: Recording, source: TranscriptSource, now: number
): TranscriptSourceIssue | undefined {
    const lastHeard = recording.lastHeard.get(source);
    if (lastHeard === undefined) {
        return "not_captured";
    }
    if (now - lastHeard >= NO_AUDIO_MS) {
        return "no_audio";
    }
    if (now - (recording.lastSound.get(source) ?? lastHeard) >= SILENCE_MS[source]) {
        return "silent";
    }
}

function logSourceIssue(source: TranscriptSource, issue: TranscriptSourceIssue | undefined) {
    switch (issue) {
        case "not_captured":
            getLog().error(`Transcription: the ${source} is not captured.`);
            break;
        case "no_audio":
            getLog().error(`Transcription: no audio from the ${source} for ${NO_AUDIO_MS / 1000} s.`);
            break;
        case "silent":
            getLog().error(
                `Transcription: only silence from the ${source} for ${SILENCE_MS[source] / 1000} s.`);
            break;
        case undefined:
            getLog().info(`Transcription: audio from the ${source} again.`);
            break;
    }
}

function setState(newState: TranscriptionState) {
    state = newState;
    broadcast(state);
}

function broadcast(stateToSend: TranscriptionState) {
    for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send("transcription-state", stateToSend);
    }
}
