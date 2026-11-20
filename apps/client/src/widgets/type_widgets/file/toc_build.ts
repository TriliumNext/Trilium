import type { CachedTocResponse, ClientTocRequest, TocOutlineHeading } from "@triliumnext/commons";
import type { RefObject } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";

import froca from "../../../services/froca";
import { rememberHeadingTitles } from "../../../services/link";
import server from "../../../services/server";
import type { ClientTocBuild } from "../../sidebar/CachedToCProvider";

/** How long a request for a table of contents waits for the viewer's answer. */
const TOC_BUILD_TIMEOUT = 60_000;

/** What the build of a document is doing, and the latest ready cache it met. */
interface BuildState {
    status: ClientTocBuild["status"];
    ready?: { blobId: string; headings: TocOutlineHeading[] };
    /** The number of the latest request: only it moves the status. */
    latest: number;
    /** The request whose answer is pending from the viewer. */
    awaiting: number | null;
    timer?: number;
    /** The bytes of the latest save of the current load, which a demand builds from. */
    lastSave?: Blob;
}

/**
 * Lets the PDF viewer in `iframeRef` build the ToC cache of its document where the server cannot
 * read the PDF. `tocUrl` is the ToC route of the document, such as `notes/abc/toc`, and
 * `isProtected` whether the document is protected, which names its bytes.
 *
 * A viewer load and a save each start a request that supersedes the running one; a demand joins a
 * running request. A request is `building` from its `GET` until its `PUT` settles, and ends with
 * the ready cache that either found. Only the answer to the latest request is saved.
 */
export function useTocBuild(
    iframeRef: RefObject<HTMLIFrameElement | null>, tocUrl: string, isProtected: boolean
) {
    const stateRef = useRef<BuildState>({ status: "idle", latest: 0, awaiting: null });
    const documentRef = useRef({ tocUrl, isProtected });
    documentRef.current = { tocUrl, isProtected };
    // Changes with the status and the ready cache, so the widget publishes them again.
    const [ version, setVersion ] = useState(0);

    function update(changes: Partial<BuildState>) {
        Object.assign(stateRef.current, changes);
        setVersion((value) => value + 1);
    }

    function start(bytes: Blob | undefined) {
        const state = stateRef.current;
        const requestId = ++state.latest;
        state.awaiting = null;
        window.clearTimeout(state.timer);
        update({ status: "building" });
        void run(requestId, bytes);
    }

    /** Reads the ToC route, and requests a build from the viewer when it must build. */
    async function run(requestId: number, bytes: Blob | undefined) {
        const state = stateRef.current;
        const current = documentRef.current;
        let cached: CachedTocResponse;
        let data: Uint8Array | undefined;
        try {
            cached = await server.getWithSilentErrors<CachedTocResponse>(current.tocUrl);
            data = bytes ? new Uint8Array(await bytes.arrayBuffer()) : undefined;
        } catch {
            finish(requestId, { status: "failed" });
            return;
        }
        if (requestId !== state.latest) {
            return;
        }
        if (cached.status === "ready") {
            rememberHeadingTitles(current.tocUrl, cached.blobId, cached.headings);
            finish(requestId, { status: "idle", ready: toReady(cached) });
            return;
        }
        const isPending = (cached.status === "stale" || cached.status === "missing")
            && !!cached.pendingToc;
        if (!isPending) {
            // The server builds this document, or it has nothing to build.
            finish(requestId, { status: "idle" });
            return;
        }

        state.awaiting = requestId;
        state.timer = window.setTimeout(() => {
            if (state.awaiting === requestId) {
                state.awaiting = null;
                finish(requestId, { status: "failed" });
            }
        }, TOC_BUILD_TIMEOUT);
        iframeRef.current?.contentWindow?.postMessage({
            type: "trilium-build-toc", requestId, isProtected: current.isProtected, data
        }, window.location.origin, data ? [ data.buffer ] : []);
    }

    /** Ends the request `requestId` with `changes`, unless a newer one runs. */
    function finish(requestId: number, changes: Partial<BuildState>) {
        if (requestId === stateRef.current.latest) {
            update(changes);
        }
    }

    /** Saves the table of contents of an answer to the latest request. */
    async function saveBuild(answer: PdfViewerTocBuildMessage) {
        const state = stateRef.current;
        const { requestId } = answer;
        if (requestId !== state.awaiting || requestId !== state.latest) {
            return;
        }
        state.awaiting = null;
        window.clearTimeout(state.timer);
        if (answer.failed) {
            finish(requestId, { status: "failed" });
            return;
        }

        const { tocUrl: url } = documentRef.current;
        const { blobId, headings, isCut, properties, elapsedMs } = answer;
        try {
            const saved = await server.put<CachedTocResponse>(url, {
                targetBlobHash: blobId, headings, properties, isCut, elapsedMs
            } satisfies ClientTocRequest, undefined, { silentConflict: true });
            if (saved.status === "ready") {
                rememberHeadingTitles(url, saved.blobId, saved.headings);
                finish(requestId, { status: "idle", ready: toReady(saved) });
            } else {
                finish(requestId, { status: "idle" });
            }
        } catch (e) {
            // A 409: the document changed since the viewer read it, and its next load builds again.
            console.warn(`Failed to save the table of contents at '${url}':`, e);
            finish(requestId, { status: "failed" });
        }
    }

    const clientBuild = useMemo<ClientTocBuild>(() => ({
        get status() {
            return stateRef.current.status;
        },
        get ready() {
            return stateRef.current.ready;
        },
        request() {
            if (stateRef.current.status !== "building") {
                start(stateRef.current.lastSave);
            }
        }
    }), []);

    return {
        clientBuild,
        /** Changes whenever `clientBuild` does. */
        version,
        /** The viewer loaded a document: builds from it, and forgets the bytes of earlier saves. */
        onLoad() {
            stateRef.current.lastSave = undefined;
            start(undefined);
        },
        /** The viewer saved `bytes` over its document: builds from them. */
        onSave(bytes: Blob) {
            stateRef.current.lastSave = bytes;
            start(bytes);
        },
        /** The viewer could not load its document: the request of that load fails at once. */
        onLoadError() {
            const state = stateRef.current;
            if (state.status === "building") {
                state.latest++;
                state.awaiting = null;
                window.clearTimeout(state.timer);
                update({ status: "failed" });
            }
        },
        saveBuild
    };
}

function toReady({ blobId, headings }: { blobId: string; headings: TocOutlineHeading[] }) {
    return { blobId, headings };
}

/** A document that a type widget shows: a note, or an attachment of the note `ownerId`. */
export type ShownDocumentRef =
    | { kind: "note"; noteId: string }
    | { kind: "attachment"; attachmentId: string; ownerId: string };

/**
 * The current blob of the document `ref`, read from the server, or `null` when the attachment
 * is gone. Throws when the read fails.
 */
export async function refreshBlobId(ref: ShownDocumentRef): Promise<string | null> {
    if (ref.kind === "note") {
        // Updates the `FNote` in place, so the widgets that read it see the new blob.
        await froca.reloadNotes([ ref.noteId ]);
        return froca.getNoteFromCache(ref.noteId)?.blobId ?? null;
    }
    const attachments = await froca.getAttachmentsForNote(ref.ownerId);
    return attachments.find(({ attachmentId }) => attachmentId === ref.attachmentId)?.blobId
        ?? null;
}
