import type { FrocaSource, SubtreeResponse } from "@triliumnext/client/src/services/froca-interface.js";

/** Rows of notes as the share answers them, with the share link of each note. */
export interface ShareFrocaRows extends SubtreeResponse {
    links: Record<string, string>;
}

/**
 * Reads the notes, attachments and blobs froca lacks from the share's API, relative to the page,
 * and records the share link of each note it loads in `links`.
 */
export function createShareFrocaSource(links: Record<string, string>): FrocaSource {
    return {
        loadNotes: async (noteIds) => {
            const query = noteIds.map(encodeURIComponent).join(",");
            const rows = await getJson<ShareFrocaRows>(`api/tree?noteIds=${query}`);
            Object.assign(links, rows.links);
            return rows;
        },
        getSiblingAttachments: (attachmentId) =>
            getJson(`api/attachments/${encodeURIComponent(attachmentId)}/all`),
        getAttachments: (noteId) => getJson(`api/notes/${encodeURIComponent(noteId)}/attachments`),
        getBlob: (entityType, entityId) =>
            getJson(`api/${entityType}/${encodeURIComponent(entityId)}/blob`)
    };
}

async function getJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${url}`);
    }
    return await response.json() as T;
}
