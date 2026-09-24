import { isImageAttachmentRole, isSvgMime, NOTE_TYPE_IMAGE_ATTACHMENTS } from "@triliumnext/commons";
import ejs from "ejs";
import { t } from "i18next";

import { getCrypto } from "../services/encryption/crypto.js";
import searchService from "../services/search/services/search.js";
import SearchContext from "../services/search/search_context.js";
import { decodeBase64, decodeUtf8, encodeUtf8 } from "../services/utils/binary.js";
import * as utils from "../services/utils/index.js";
import { readShareTemplate, renderNoteContent } from "./content_renderer.js";
import { SHARE_ROUTE_PATHS, type ShareRoutePath } from "./route_paths.js";
import { isShareReady } from "./share_provider.js";
import type SAttachment from "./shaca/entities/sattachment.js";
import type SNote from "./shaca/entities/snote.js";
import shaca from "./shaca/shaca.js";
import shacaLoader from "./shaca/shaca_loader.js";

/** A share request, reduced to what the handlers read, so both Express and the browser can supply it. */
export interface ShareRequest {
    /** The full request path, such as `/share/my-alias`. */
    path: string;
    params: Record<string, string | undefined>;
    query: Record<string, string | string[] | undefined>;
    /** Returns the named request header, or `undefined` when the caller did not send it. */
    getHeader(name: string): string | undefined;
}

/** What a handler answers with, for the caller's transport to write out. */
export interface ShareReply {
    status: number;
    headers: Record<string, string>;
    /** Absent on a reply that carries none, such as a redirect. */
    body?: string | Uint8Array;
    /** Where to send the caller, instead of a body. */
    redirect?: string;
}

export interface ShareRoute {
    /** Express-style pattern, such as `/share/api/notes/:noteId`. */
    path: ShareRoutePath;
    handle(req: ShareRequest): ShareReply;
}

/** Returns the share routes, in the order {@link SHARE_ROUTE_PATHS} lays down. */
export function getShareRoutes(): ShareRoute[] {
    return SHARE_ROUTE_PATHS.map((path) => ({ path, handle: HANDLERS[path] }));
}

/** Returns the handler for one share path, for a router that registered the paths on their own. */
export function getShareRoute(path: ShareRoutePath): ShareRoute {
    return { path, handle: HANDLERS[path] };
}

/**
 * Runs a share handler, turning the replies its access checks raise into the handler's own result.
 * Every transport adapter dispatches through this rather than calling {@link ShareRoute.handle}.
 */
export function handleShareRequest(route: ShareRoute, req: ShareRequest): ShareReply {
    if (!isShareReady()) {
        return {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            body: "The application is still initializing. Please try again in a moment."
        };
    }

    try {
        shacaLoader.ensureLoad();

        return route.handle(req);
    } catch (e: unknown) {
        if (e instanceof ShareReplyError) {
            return e.reply;
        }

        throw e;
    }
}

const HANDLERS: Record<ShareRoutePath, (req: ShareRequest) => ShareReply> = {
    "/share/api/notes/:noteId/download": downloadNote,
    "/share/api/notes/:noteId/view": viewNote,
    "/share/api/notes/:noteId": getNote,
    "/share/api/notes": searchNotes,
    "/share/api/images/:noteId/:filename": getImage,
    "/share/api/attachments/:attachmentId/image/:filename": getAttachmentImage,
    "/share/api/attachments/:attachmentId/download": downloadAttachment,
    "/share/": getShareRoot,
    "/share/:shareId": getShareNote
};

/** Carries a finished reply out of the access checks, which run several frames below the handler. */
class ShareReplyError extends Error {
    constructor(readonly reply: ShareReply) {
        super(`Share request rejected with ${reply.status}.`);
    }
}

function getShareRoot(req: ShareRequest): ShareReply {
    if (!req.path.endsWith("/")) {
        return { status: 302, headers: {}, redirect: "../share/" };
    }

    if (!shaca.shareRootNote) {
        return jsonReply(404, { message: "Share root note not found" });
    }

    return renderNote(shaca.shareRootNote, req);
}

function getShareNote(req: ShareRequest): ShareReply {
    const shareId = req.params.shareId ?? "";
    const note = shaca.aliasToNote[shareId] || shaca.notes[shareId];

    return renderNote(note, req);
}

function renderNote(note: SNote | undefined, req: ShareRequest): ShareReply {
    if (!note) {
        return render404();
    }

    // Raises the refusal when the caller may not read this note; the note it returns is this one.
    checkNoteAccess(note.noteId, req);

    const headers = noIndexHeaders(note);

    if (note.isLabelTruthy("shareRaw") || typeof req.query.raw !== "undefined") {
        // A protected note is shown as a placeholder by renderNoteContent() below, but the raw
        // branch streams note.getContent() directly, so it must refuse protected notes
        // (GHSA-xmv9-3v98-7gq8).
        if (note.isProtected) {
            return render404();
        }

        // For SVG content, add a restrictive Content-Security-Policy to prevent stored XSS via
        // script execution (CWE-79). HTML is intentionally served unrestricted here: serving raw
        // HTML requires the `#shareRaw` attribute (or an explicit `?raw`), and `#shareRaw` is
        // flagged dangerous (see builtin_attributes.ts), so the instance owner is deliberately
        // opting in to serve their own scriptable content. Restricting it would break legitimate
        // self-contained HTML pages.
        if (isSvgMime(note.mime)) {
            headers["Content-Security-Policy"] = utils.SVG_CONTENT_SECURITY_POLICY;
            headers["X-Content-Type-Options"] = "nosniff";
        }

        headers["Content-Type"] = note.mime;

        return { status: 200, headers, body: note.getContent() };
    }

    headers["Content-Type"] = "text/html; charset=utf-8";

    return {
        status: 200,
        headers,
        body: renderNoteContent(note, (includedNote) => hasCredentialAccess(includedNote, req))
    };
}

function getNote(req: ShareRequest): ShareReply {
    const note = checkNoteAccess(req.params.noteId ?? "", req);

    return jsonReply(200, note.getPojo(), noIndexHeaders(note));
}

function downloadNote(req: ShareRequest): ShareReply {
    const note = checkNoteContentAccess(req.params.noteId ?? "", req);
    const filename = utils.formatDownloadTitle(note.title, note.type, note.mime);

    return {
        status: 200,
        headers: {
            ...noIndexHeaders(note),
            "Content-Disposition": utils.getContentDisposition(filename),
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Content-Type": note.mime
        },
        body: note.getContent()
    };
}

/** Used for PDF viewing. */
function viewNote(req: ShareRequest): ShareReply {
    const note = checkNoteContentAccess(req.params.noteId ?? "", req);

    return {
        status: 200,
        headers: {
            ...noIndexHeaders(note),
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Content-Type": note.mime
        },
        body: note.getContent()
    };
}

function getImage(req: ShareRequest): ShareReply {
    const image = checkNoteContentAccess(req.params.noteId ?? "", req);

    switch (image.type) {
        case "image":
            return serveImageBytes(image.getContent(), image.mime, noIndexHeaders(image));
        case "canvas":
            return renderImageAttachment(image, NOTE_TYPE_IMAGE_ATTACHMENTS.canvas);
        case "mermaid":
            return renderImageAttachment(image, NOTE_TYPE_IMAGE_ATTACHMENTS.mermaid);
        case "mindMap":
            return renderImageAttachment(image, NOTE_TYPE_IMAGE_ATTACHMENTS.mindMap);
        default:
            return jsonReply(400, { message: "Requested note is not a shareable image" });
    }
}

function getAttachmentImage(req: ShareRequest): ShareReply {
    const attachment = checkAttachmentAccess(req.params.attachmentId ?? "", req);

    if (!isImageAttachmentRole(attachment.role)) {
        return jsonReply(400, { message: "Requested attachment is not a shareable image" });
    }

    return serveImageBytes(attachment.getContent(), attachment.mime, noIndexHeaders(attachment.note));
}

function downloadAttachment(req: ShareRequest): ShareReply {
    const attachment = checkAttachmentAccess(req.params.attachmentId ?? "", req);
    const filename = utils.formatDownloadTitle(attachment.title, null, attachment.mime);

    return {
        status: 200,
        headers: {
            ...noIndexHeaders(attachment.note),
            "Content-Disposition": utils.getContentDisposition(filename),
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Content-Type": attachment.mime
        },
        body: attachment.getContent()
    };
}

/** Used for searching; requires a noteId so the subtree root is known. */
function searchNotes(req: ShareRequest): ShareReply {
    const ancestorNoteId = req.query.ancestorNoteId ?? "_share";

    if (typeof ancestorNoteId !== "string") {
        return jsonReply(400, { message: "'ancestorNoteId' parameter is mandatory." });
    }

    // This will automatically return if no ancestorNoteId is provided and there is no shareIndex
    checkNoteAccess(ancestorNoteId, req);

    const { search } = req.query;

    if (typeof search !== "string" || !search.trim()) {
        return jsonReply(400, { message: "'search' parameter is mandatory." });
    }

    const searchContext = new SearchContext({ ancestorNoteId });
    const searchResults = searchService.findResultsWithQuery(search, searchContext);
    const authorizedResults = searchResults
        // Apply the same per-note authorization as the direct content routes: drop protected
        // notes (GHSA-xmv9-3v98-7gq8) and keep only results the caller can access that are
        // visible in the tree.
        .filter((sr) => {
            const fullNote = shaca.notes[sr.noteId];

            return fullNote
                && !fullNote.isProtected
                && hasCredentialAccess(fullNote, req)
                && isVisibleInShareTree(ancestorNoteId, sr.notePathArray);
        });

    // buildSearchResultDetails() reads each note's content to set contentSnippet and
    // highlightedContentSnippet, so it runs only on authorized results and only on the first
    // SNIPPET_LIMIT of them (the share popout renders 5); later results carry no snippet.
    const SNIPPET_LIMIT = 20;
    searchService.buildSearchResultDetails(authorizedResults.slice(0, SNIPPET_LIMIT), searchContext);

    const filteredResults = authorizedResults.map((sr) => {
        const fullNote = shaca.notes[sr.noteId];
        const startIndex = sr.notePathArray.indexOf(ancestorNoteId);
        const localPathArray = sr.notePathArray.slice(startIndex + 1).filter((id) => shaca.notes[id]);
        const pathTitle = localPathArray.map((id) => shaca.notes[id].title).join(" / ");

        return {
            id: fullNote.shareId,
            title: fullNote.title,
            score: sr.score,
            path: pathTitle,
            // Plain-text fallback and the <b>-highlighted variant from the search service.
            snippet: sr.contentSnippet,
            highlightedSnippet: sr.highlightedContentSnippet
        };
    });

    return jsonReply(200, { results: filteredResults });
}

/**
 * Returns true when the note reached via `notePathArray` is actually visible in the public share
 * tree below `ancestorNoteId`: every hop from the ancestor down to the note must be a non-hidden
 * branch whose child note is not `shareHiddenFromTree`. Mirrors SNote.getVisibleChildBranches() so
 * that search cannot enumerate notes the navigation tree deliberately hides. Exported for tests: a
 * clone's best note path can bypass the share subtree entirely, which is impractical to stage
 * through the full search stack.
 */
export function isVisibleInShareTree(ancestorNoteId: string, notePathArray: string[]) {
    const startIndex = notePathArray.indexOf(ancestorNoteId);

    if (startIndex < 0) {
        return false;
    }

    for (let i = startIndex + 1; i < notePathArray.length; i++) {
        const childNote = shaca.notes[notePathArray[i]];
        const branch = shaca.getBranchFromChildAndParent(notePathArray[i], notePathArray[i - 1]);

        if (!childNote || !branch || branch.isHidden || childNote.isLabelTruthy("shareHiddenFromTree")) {
            return false;
        }
    }

    return true;
}

/** Returns the note, or raises the reply that refuses the caller. */
function checkNoteAccess(noteId: string, req: ShareRequest): SNote {
    const note = shaca.getNote(noteId);

    if (!note) {
        throw new ShareReplyError(jsonReply(404, { message: `Note '${noteId}' not found.` }));
    }

    if (noteId === "_share" && !shaca.shareIndexEnabled) {
        throw new ShareReplyError(jsonReply(403, { message: `Accessing share index is forbidden.` }));
    }

    if (!hasCredentialAccess(note, req)) {
        throw new ShareReplyError(requestCredentials());
    }

    return note;
}

/**
 * Like checkNoteAccess, but additionally refuses protected notes. Used by the routes that stream a
 * note's raw content/images: a protected note still shows up as "[protected]" in the shared tree
 * (handled by content_renderer.ts), but its actual bytes must never be served anonymously
 * (GHSA-xmv9-3v98-7gq8).
 */
function checkNoteContentAccess(noteId: string, req: ShareRequest): SNote {
    const note = checkNoteAccess(noteId, req);

    rejectProtected(note, `Note '${noteId}' not found.`);

    return note;
}

function checkAttachmentAccess(attachmentId: string, req: ShareRequest): SAttachment {
    const attachment = shaca.getAttachment(attachmentId);

    if (!attachment) {
        throw new ShareReplyError(jsonReply(404, { message: `Attachment '${attachmentId}' not found.` }));
    }

    const note = checkNoteAccess(attachment.ownerId, req);

    // Protected notes cannot be shared, and neither can their attachments (GHSA-xmv9-3v98-7gq8).
    rejectProtected(note, `Attachment '${attachmentId}' not found.`);

    return attachment;
}

/** Raises a 404 when the note is protected, so the caller never reaches its bytes. */
function rejectProtected(note: SNote, message: string) {
    if (note.isProtected) {
        throw new ShareReplyError(jsonReply(404, { message }));
    }
}

/**
 * Returns true when the request is allowed to read the given note: either the note (including
 * inherited attributes) carries no shareCredentials, or the request presents matching HTTP Basic
 * credentials. Pure predicate — it raises nothing, so it can also filter search results.
 */
function hasCredentialAccess(note: SNote, req: ShareRequest) {
    const credentials = note.getCredentials();

    if (credentials.length === 0) {
        return true;
    }

    const header = req.getHeader("authorization");

    if (!header?.startsWith("Basic ")) {
        return false;
    }

    let authString: string;

    try {
        authString = decodeUtf8(decodeBase64(header.substring("Basic ".length)));
    } catch {
        return false;
    }

    const given = encodeUtf8(authString);

    return credentials.some((credentialLabel) => getCrypto().constantTimeCompare(given, encodeUtf8(credentialLabel.value)));
}

function requestCredentials(): ShareReply {
    return {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="User Visible Realm", charset="UTF-8"' }
    };
}

/**
 * Serves the rendered SVG a canvas, mermaid or mind map note keeps in a named attachment, falling
 * back to an empty image when neither that attachment nor the note's own content holds one.
 */
function renderImageAttachment(image: SNote, attachmentName: string): ShareReply {
    let svgString = "<svg/>";
    const content = image.getAttachmentByTitle(attachmentName)?.getContent();

    if (typeof content === "string") {
        svgString = content;
    } else {
        // backwards compatibility, before attachments, the SVG was stored in the main note content as a separate key
        const possibleSvgContent = image.getJsonContentSafely();

        const contentSvg = (typeof possibleSvgContent === "object"
            && possibleSvgContent !== null
            && "svg" in possibleSvgContent
            && typeof possibleSvgContent.svg === "string")
            ? possibleSvgContent.svg
            : null;

        if (contentSvg) {
            svgString = contentSvg;
        }
    }

    return svgReply(utils.sanitizeSvg(svgString));
}

/** Serves an image's bytes, sanitizing first when the image is an SVG, which can carry script. */
function serveImageBytes(content: string | Uint8Array | undefined, mime: string, headers: Record<string, string>): ShareReply {
    if (isSvgMime(mime)) {
        const svgContent = typeof content === "string" ? content : decodeUtf8(content ?? new Uint8Array());

        return svgReply(utils.sanitizeSvg(svgContent), headers);
    }

    return {
        status: 200,
        headers: { ...headers, "Content-Type": mime },
        body: content
    };
}

function svgReply(svg: string, headers: Record<string, string> = {}): ShareReply {
    return {
        status: 200,
        headers: {
            ...headers,
            "Content-Type": "image/svg+xml",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Content-Security-Policy": utils.SVG_CONTENT_SECURITY_POLICY,
            "X-Content-Type-Options": "nosniff"
        },
        body: svg
    };
}

function render404(): ShareReply {
    return {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: ejs.render(readShareTemplate("404"), { t })
    };
}

function noIndexHeaders(note: SNote): Record<string, string> {
    return note.isLabelTruthy("shareDisallowRobotIndexing") ? { "X-Robots-Tag": "noindex" } : {};
}

function jsonReply(status: number, payload: unknown, headers: Record<string, string> = {}): ShareReply {
    return {
        status,
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload)
    };
}
