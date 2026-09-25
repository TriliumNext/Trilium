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
    const metadata = await server.post<Record<string, MetadataResponse>>(
        "notes/metadata", { noteIds });

    for (const noteId of noteIds) {
        const created = Date.parse(metadata?.[noteId]?.utcDateCreated ?? "");
        creationDates.set(noteId, Number.isNaN(created) ? undefined : created);
    }
}
