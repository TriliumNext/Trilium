// Shared by the scripts: finding a development recording, its transcripts, and the models.

import fs from "node:fs";
import path from "node:path";

export const TRANSCRIPT_VERSION = 1;

/** Where `pnpm desktop:start` keeps recordings (its TRILIUM_DATA_DIR is apps/desktop/data). */
const DEV_RECORDINGS_DIR = path.resolve(
    import.meta.dirname, "../../../apps/desktop/data/transcription-recordings");
/** Where `pnpm desktop:start` downloads resources, one `<id>-<hash>` directory each. */
const DEV_RESOURCES_DIR = path.resolve(import.meta.dirname, "../../../apps/desktop/data/resources");

/** The resource IDs of the models, as `apps/desktop/src/services/transcription/model.ts` registers them. */
export const MODEL_RESOURCES = {
    int8: "transcription.parakeet",
    fp32: "transcription.parakeet-fp32",
    vad: "transcription.silero-vad",
    speaker: "transcription.titanet"
};

/**
 * Returns the directory the app downloaded the resource `id` into, the most recently installed
 * when several versions are there, or `null` when none finished downloading.
 */
export function findResource(id) {
    if (!fs.existsSync(DEV_RESOURCES_DIR)) {
        return null;
    }
    const installed = fs.readdirSync(DEV_RESOURCES_DIR)
        .filter((name) => name.slice(0, name.lastIndexOf("-")) === id)
        .map((name) => path.join(DEV_RESOURCES_DIR, name, ".verified.json"))
        .filter((record) => fs.existsSync(record))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return installed.length ? path.dirname(installed[0]) : null;
}

/** Like {@link findResource}, but fails with a hint to download the resource from the app. */
export function requireResource(id) {
    const directory = findResource(id);
    if (!directory) {
        throw new Error(`${id} is not downloaded to ${DEV_RESOURCES_DIR}. `
            + "Start a recording in `pnpm desktop:start` to download it.");
    }
    return directory;
}

/**
 * Splits argv into positional arguments and `--name value` options. Names in `multiple` collect
 * every value into an array; names in `flags` take no value.
 */
export function parseArgs(argv, { multiple = [], flags = [] } = {}) {
    const positional = [];
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) {
            positional.push(arg);
            continue;
        }
        const name = arg.slice(2);
        if (flags.includes(name)) {
            options[name] = true;
            continue;
        }
        const value = argv[++i];
        if (value === undefined) {
            throw new Error(`--${name} needs a value.`);
        }
        if (multiple.includes(name)) {
            (options[name] ??= []).push(value);
        } else {
            options[name] = value;
        }
    }
    return { positional, options };
}

/**
 * Reads the recording in `argument`, a recording directory or `latest` (the newest recording of
 * the development data directory).
 */
export function resolveRecording(argument) {
    let directory = argument;
    if (!argument || argument === "latest") {
        const names = fs.existsSync(DEV_RECORDINGS_DIR)
            ? fs.readdirSync(DEV_RECORDINGS_DIR).sort()
            : [];
        if (!names.length) {
            throw new Error(`No recordings in ${DEV_RECORDINGS_DIR}.`);
        }
        directory = path.join(DEV_RECORDINGS_DIR, names.at(-1));
    }
    const manifestPath = path.join(directory, "recording.json");
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`${directory} is not a recording: it has no recording.json.`);
    }
    return { directory, manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8")) };
}

/** The transcript file of `label`: `live` is the one written while recording. */
export function transcriptPath(directory, label) {
    return path.join(directory, label === "live" ? "transcript.json" : `transcript.${label}.json`);
}

/** Every transcript in a recording directory, by label. */
export function listTranscripts(directory) {
    const transcripts = new Map();
    for (const name of fs.readdirSync(directory).sort()) {
        const match = /^transcript(?:\.(.+))?\.json$/.exec(name);
        if (match) {
            transcripts.set(match[1] ?? "live", readTranscript(directory, match[1] ?? "live"));
        }
    }
    return transcripts;
}

export function readTranscript(directory, label) {
    const filePath = transcriptPath(directory, label);
    if (!fs.existsSync(filePath)) {
        throw new Error(`No transcript "${label}" in ${directory} (${path.basename(filePath)}).`);
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
