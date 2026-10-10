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
            getJson(`api/${entityType}/${encodeURIComponent(entityId)}/blob`),
        searchNoteIds: async (query, ancestorNoteId) => {
            const params = new URLSearchParams({ search: query, ancestorNoteId });
            const { results } = await getJson<{ results: { noteId: string }[] }>(`api/notes?${params}`);
            return results.map((result) => result.noteId);
        },
        // A visitor cannot change notes, so what a view saves holds only while the page is open.
        saveAttachment: async () => {},
        removeAttachment: async () => {},
        searchInSubtree: (query, ancestorNoteId) => {
            const params = new URLSearchParams({ searchString: query, ancestorNoteId });
            return getJson(`api/search?${params}`);
        },
        getAttributeNames: (type, query) =>
            getJson(`api/attribute-names?${new URLSearchParams({ type, query })}`),
        lintSearch: (searchString) => getJson(`api/search/lint?${new URLSearchParams({ searchString })}`),
        getNoteMap: (mapRootNoteId, mapType, { excludeRelations, includeRelations }) => {
            const params = new URLSearchParams([
                ...excludeRelations.map((name) => [ "excludeRelation", name ]),
                ...includeRelations.map((name) => [ "includeRelation", name ])
            ]);
            return getJson(`api/note-map/${encodeURIComponent(mapRootNoteId)}/${mapType}?${params}`);
        },
        // The share reads the notes from the map's own content, so a visitor cannot name others.
        getRelationMap: (relationMapNoteId) =>
            getJson(`api/relation-map/${encodeURIComponent(relationMapNoteId)}`),
        getScriptBundle: (noteId) => getJson(`api/script/bundle/${encodeURIComponent(noteId)}`)
    };
}

async function getJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${url}`);
    }
    return await response.json() as T;
}
