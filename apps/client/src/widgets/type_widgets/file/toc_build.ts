import type { CachedTocResponse, ClientTocRequest } from "@triliumnext/commons";
import type { RefObject } from "preact";
import { useRef } from "preact/hooks";

import { rememberHeadingTitles } from "../../../services/link";
import server from "../../../services/server";

/** How long a request for a table of contents waits for the viewer's answer. */
const TOC_BUILD_TIMEOUT = 60_000;

/**
 * Lets the PDF viewer in `iframeRef` build the ToC cache of its document where the server cannot
 * read the PDF. `tocUrl` is the ToC route of the document, such as `notes/abc/toc`, and
 * `isProtected` whether the document is protected, which names its bytes.
 *
 * Each request takes the next number, and only the answer to the latest request is saved: a
 * reload or a save never waits for an earlier build, and an answer for an older document is
 * dropped.
 */
export function useTocBuild(
    iframeRef: RefObject<HTMLIFrameElement | null>, tocUrl: string, isProtected: boolean
) {
    const stateRef = useRef<{ latest: number; awaiting: number | null; timer?: number }>({
        latest: 0, awaiting: null
    });
    const documentRef = useRef({ tocUrl, isProtected });
    documentRef.current = { tocUrl, isProtected };

    /**
     * Asks the ToC route whether the viewer must build the table of contents, and asks the viewer
     * to when so. `data` are the bytes of a save, which the viewer reads instead of its document.
     */
    async function requestBuild(data?: Uint8Array) {
        const state = stateRef.current;
        const requestId = ++state.latest;
        const current = documentRef.current;
        let cached: CachedTocResponse;
        try {
            cached = await server.get<CachedTocResponse>(current.tocUrl, undefined, false, {
                silentBadRequest: true, silentNotFound: true
            });
        } catch {
            return;
        }
        if (requestId !== state.latest || !("pendingToc" in cached && cached.pendingToc)) return;

        state.awaiting = requestId;
        window.clearTimeout(state.timer);
        state.timer = window.setTimeout(() => {
            if (state.awaiting === requestId) state.awaiting = null;
        }, TOC_BUILD_TIMEOUT);
        iframeRef.current?.contentWindow?.postMessage({
            type: "trilium-build-toc", requestId, isProtected: current.isProtected, data
        }, window.location.origin, data ? [ data.buffer ] : []);
    }

    /** Saves the table of contents of an answer to the latest request. */
    async function saveBuild(answer: PdfViewerTocBuildMessage) {
        const state = stateRef.current;
        if (answer.requestId !== state.awaiting || answer.requestId !== state.latest) return;
        state.awaiting = null;
        window.clearTimeout(state.timer);
        if (answer.failed) return;

        const { tocUrl } = documentRef.current;
        const { blobId, headings, isCut, properties, elapsedMs } = answer;
        try {
            const saved = await server.put<CachedTocResponse>(tocUrl, {
                targetBlobHash: blobId, headings, properties, isCut, elapsedMs
            } satisfies ClientTocRequest, undefined, { silentConflict: true });
            if (saved.status === "ready") {
                rememberHeadingTitles(tocUrl, saved.blobId, saved.headings);
            }
        } catch (e) {
            // A 409: the document changed since the viewer read it, and its next load builds again.
            console.warn(`Failed to save the table of contents at '${tocUrl}':`, e);
        }
    }

    return { requestBuild, saveBuild };
}
