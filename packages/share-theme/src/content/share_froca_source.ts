import type { FAttachmentRow } from "@triliumnext/client/src/entities/fattachment.js";
import type { Bundle } from "@triliumnext/client/src/services/bundle.js";
import type { FrocaSource, SubtreeResponse } from "@triliumnext/client/src/services/froca-interface.js";
import type { ImageUrlResolver } from "@triliumnext/client/src/services/image_urls.js";
import { getNoteMapDataKey } from "@triliumnext/commons/src/lib/share_hosting.js";

/** Rows of notes as the share answers them, with the share link of each note. */
export interface ShareFrocaRows extends SubtreeResponse {
    links: Record<string, string>;
}

/** A source of froca's notes that also links each note to its page. */
export interface ShareFrocaSource extends FrocaSource {
    /** The URL of a note's page, relative to the page, or `null` for a note without one. */
    getNoteLink(noteId: string): string | null;
}

/**
 * Reads the notes, attachments and blobs froca lacks from the share's API, relative to the page,
 * and records the share link of each note it loads in `links`. A note no row has linked yet links
 * to `./<noteId>`, which the share redirects to the note's own link.
 */
export function createShareFrocaSource(links: Record<string, string>): ShareFrocaSource {
    return {
        getNoteLink: (noteId) => links[noteId] ?? `./${encodeURIComponent(noteId)}`,
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

/**
 * The data the static export writes into `data/rows.json`: the rows of every note it holds, each
 * note's link and the paths of its files, relative to the export's root.
 */
interface StaticShareRows extends ShareFrocaRows {
    attachments: Record<string, FAttachmentRow[]>;
    attachmentPaths: Record<string, string>;
    images: Record<string, string>;
    noteMaps: Record<string, string>;
}

/** A source of froca's notes that also finds the images of the export. */
export interface StaticFrocaSource extends ShareFrocaSource {
    /**
     * The URL of the file of a note's image or of an image attachment, relative to the page, or
     * `null` for one the export does not hold or before the source has read `rows.json`.
     */
    getImageUrl: ImageUrlResolver;
}

/**
 * Reads the notes, attachments and blobs froca lacks from the files the static export writes
 * under `data/`, `basePath` being the export's root from the page, and records the link of each
 * note it loads in `links`. A view cannot search or change notes there: a search finds nothing, but
 * for the one listing a note's children that are not archived, and a save holds only while the page
 * is open.
 */
export function createStaticFrocaSource(
    links: Record<string, string>,
    basePath: string
): StaticFrocaSource {
    let rows: StaticShareRows | undefined;
    let rowsPromise: Promise<StaticShareRows> | undefined;
    const readRows = () => {
        rowsPromise ??= getJson<StaticShareRows>(`${basePath}data/rows.json`).then((read) => {
            rows = read;
            return read;
        });
        return rowsPromise;
    };
    const resolve = (path: string) => (path ? `${basePath}${path}` : basePath || "./");
    const readData = <T>(path: string) => getJson<T>(`${basePath}data/${path}`);

    return {
        getNoteLink: (noteId) => links[noteId] ?? null,
        loadNotes: async () => {
            const { notes, branches, attributes, links: rootLinks } = await readRows();
            for (const [ noteId, link ] of Object.entries(rootLinks)) {
                links[noteId] = resolve(link);
            }
            return { notes, branches, attributes };
        },
        getSiblingAttachments: async (attachmentId) => {
            const siblings = Object.values((await readRows()).attachments).find((attachments) =>
                attachments.some((attachment) => attachment.attachmentId === attachmentId));
            if (!siblings) {
                throw new Error(`The export holds no attachment '${attachmentId}'.`);
            }
            return siblings;
        },
        getAttachments: async (noteId) => (await readRows()).attachments[noteId] ?? [],
        getBlob: (entityType, entityId) =>
            readData(`blobs/${entityType}/${encodeURIComponent(entityId)}.json`),
        searchNoteIds: async (query) => {
            const parentNoteId = UNARCHIVED_CHILDREN.exec(query)?.[1];
            if (!parentNoteId) {
                return [];
            }
            const { branches, attributes } = await readRows();
            const archived = new Set(attributes
                .filter((attribute) => attribute.type === "label" && attribute.name === "archived")
                .map((attribute) => attribute.noteId));
            return branches
                .filter((branch) => branch.parentNoteId === parentNoteId)
                .filter((branch) => !archived.has(branch.noteId))
                .map((branch) => branch.noteId);
        },
        saveAttachment: async () => {},
        removeAttachment: async () => {},
        searchInSubtree: async () => ({
            searchResultNoteIds: [], highlightedTokens: [], error: null
        }),
        getAttributeNames: async () => [],
        lintSearch: async () => ({ error: null }),
        getNoteMap: async (mapRootNoteId, mapType, filters) => {
            const { noteMaps } = await readRows();
            const prefix = `${mapRootNoteId}/${mapType}?`;
            const path = noteMaps[getNoteMapDataKey(mapRootNoteId, mapType, filters)]
                ?? Object.entries(noteMaps).find(([ key ]) => key.startsWith(prefix))?.[1];
            return path
                ? await getJson(resolve(path))
                : { notes: [], links: [], noteIdToDescendantCountMap: {} };
        },
        getRelationMap: (relationMapNoteId) =>
            readData(`relation-map/${encodeURIComponent(relationMapNoteId)}.json`),
        getScriptBundle: (noteId) =>
            readData<Bundle>(`script/${encodeURIComponent(noteId)}.json`).catch(() => undefined),
        getImageUrl: (target) => {
            const path = "noteId" in target
                ? rows?.images[target.noteId]
                : rows?.attachmentPaths[target.attachmentId];
            return path ? resolve(path) : null;
        }
    };
}

/** The search `FNote.getChildNoteIdsWithArchiveFiltering()` lists a note's children with. */
const UNARCHIVED_CHILDREN = /^note\.parents\.noteId="(\w+)" #!archived$/;

async function getJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${url}`);
    }
    return await response.json() as T;
}
