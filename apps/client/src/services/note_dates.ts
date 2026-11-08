import type { MetadataResponse } from "@triliumnext/commons";

import server from "./server";

/** How many notes one request asks about. */
const BATCH_SIZE = 1000;

/**
 * The creation time of every note asked about so far, in milliseconds.
 *
 * Notes the server does not know are stored with no time, so they are not requested again.
 * Nothing is evicted: `utcDateCreated` does not change once a note exists.
 */
const creationDates = new Map<string, number | undefined>();

/** The request covering each note being asked about, so two callers do not ask twice. */
const requests = new Map<string, Promise<void>>();

/**
 * Loads the creation dates of the given notes, skipping the ones already known.
 *
 * @returns whether anything was loaded, so a caller can skip redrawing.
 */
export async function loadCreationDates(noteIds: Iterable<string>) {
    const missing: string[] = [];
    const pending = new Set<Promise<void>>();

    for (const noteId of noteIds) {
        if (creationDates.has(noteId)) {
            continue;
        }

        const inFlight = requests.get(noteId);
        if (inFlight) {
            pending.add(inFlight);
        } else {
            missing.push(noteId);
        }
    }

    for (let at = 0; at < missing.length; at += BATCH_SIZE) {
        pending.add(load(missing.slice(at, at + BATCH_SIZE)));
    }

    if (!pending.size) {
        return false;
    }

    await Promise.all(pending);
    return true;
}

/** The creation time of a note in milliseconds, or undefined until it is loaded. */
export function getCreationDate(noteId: string) {
    return creationDates.get(noteId);
}

/** The creation and modification times of a note, in milliseconds. */
export interface NoteDates {
    created: number | undefined;
    modified: number | undefined;
}

/**
 * Loads the creation and modification dates of the given notes. Unlike `loadCreationDates()`, it
 * always asks the server, because `utcDateModified` changes with every edit. The creation dates it
 * reads are kept for `getCreationDate()`.
 *
 * @returns the dates by note ID, without the notes the server does not know.
 */
export async function loadNoteDates(noteIds: string[]) {
    const batches: Promise<Record<string, MetadataResponse>>[] = [];
    for (let at = 0; at < noteIds.length; at += BATCH_SIZE) {
        batches.push(fetchMetadata(noteIds.slice(at, at + BATCH_SIZE)));
    }

    const dates = new Map<string, NoteDates>();
    for (const metadata of await Promise.all(batches)) {
        for (const [ noteId, { utcDateCreated, utcDateModified } ] of Object.entries(metadata)) {
            const created = parseDate(utcDateCreated);
            creationDates.set(noteId, created);
            dates.set(noteId, { created, modified: parseDate(utcDateModified) });
        }
    }
    return dates;
}

function load(noteIds: string[]) {
    const request = fetchDates(noteIds).finally(() => {
        for (const noteId of noteIds) {
            requests.delete(noteId);
        }
    });

    for (const noteId of noteIds) {
        requests.set(noteId, request);
    }

    return request;
}

async function fetchDates(noteIds: string[]) {
    const metadata = await fetchMetadata(noteIds);

    for (const noteId of noteIds) {
        creationDates.set(noteId, parseDate(metadata[noteId]?.utcDateCreated));
    }
}

async function fetchMetadata(noteIds: string[]) {
    return await server.post<Record<string, MetadataResponse>>("notes/metadata", { noteIds }) ?? {};
}

function parseDate(value: string | undefined) {
    const time = Date.parse(value ?? "");
    return Number.isNaN(time) ? undefined : time;
}
