/**
 * The transcription process: an Electron utility process that runs one recording's VAD, speaker
 * embeddings and recognizer, so none of them takes time from the main process. The capture page
 * posts its samples here directly; the main process only receives the utterances. Started by
 * `TranscriptionWorker` in `worker_client.ts`, which also ends it.
 */

import { TranscriptFileSink, WavRecorder } from "./audio_recorder";
import { loadSherpaEngine, probeSherpa } from "./engine";
import type { Logger, WorkerEvent, WorkerRequest } from "./protocol";
import { type AudioTap, PortCapture, RecordingSession, type TranscriptSink } from "./session";

const log: Logger = {
    info: (message) => post({ type: "log", level: "info", message }),
    error: (message) => post({ type: "log", level: "error", message })
};

type StartRequest = Extract<WorkerRequest, { type: "start" }>;

/** How long stopping waits for the capture page's end marker. */
const CAPTURE_END_TIMEOUT_MS = 2000;

let session: RecordingSession | null = null;
let capture: PortCapture | null = null;

process.parentPort.on("message", ({ data, ports }) => {
    const request = data as WorkerRequest;
    switch (request.type) {
        case "start":
            start(request).catch((e) => {
                post({ type: "failed", message: (e as Error)?.message ?? String(e) });
            });
            break;
        case "capture":
            if (ports[0]) {
                capture?.connect(ports[0]);
            }
            break;
        case "stop":
            void stop();
            break;
        case "probe":
            probeSherpa().then(
                (version) => post({ type: "probed", version }),
                (e) => post({ type: "probed", error: (e as Error)?.message ?? String(e) }));
            break;
    }
});

async function start({ noteId, models, recordingDirectory }: StartRequest) {
    const engine = await loadSherpaEngine(models);
    const sinks: TranscriptSink[] = [
        { write: (utterance) => post({ type: "utterance", utterance }) }
    ];
    const taps: AudioTap[] = [];
    if (recordingDirectory) {
        sinks.push(new TranscriptFileSink(recordingDirectory));
        taps.push(new WavRecorder(recordingDirectory, noteId, engine.settings, log));
    }

    capture = new PortCapture();
    const newSession = new RecordingSession({
        capture,
        engine,
        sinks,
        taps,
        log,
        onPendingChanged: (sources) => post({ type: "pending", sources }),
        onLevel: (source, level) => post({ type: "level", source, level })
    });
    await newSession.start();
    session = newSession;
    post({ type: "ready", startedAt: newSession.startedAt, settings: engine.settings });
}

/**
 * Waits for the capture page's last chunks, which travel on another port than the stop request,
 * then transcribes what the session still holds.
 */
async function stop() {
    if (capture) {
        const timeout = new Promise((resolve) => setTimeout(resolve, CAPTURE_END_TIMEOUT_MS));
        await Promise.race([ capture.ended, timeout ]);
    }
    try {
        await session?.stop();
    } catch (e) {
        log.error(`Transcription: stopping failed: ${e}`);
    }
    post({ type: "stopped" });
}

function post(event: WorkerEvent) {
    process.parentPort.postMessage(event);
}
