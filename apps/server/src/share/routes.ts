import { NOTE_TYPE_IMAGE_ATTACHMENTS } from "@triliumnext/commons";
import { search as searchService, SearchContext, utils } from "@triliumnext/core";
import type { NextFunction, Request, Response, Router } from "express";
import safeCompare from "safe-compare";

import { getDefaultTemplatePath, renderNoteContent } from "./content_renderer.js";
import type SAttachment from "./shaca/entities/sattachment.js";
import type SNote from "./shaca/entities/snote.js";
import shaca from "./shaca/shaca.js";
import shacaLoader from "./shaca/shaca_loader.js";
import { isShareDbReady } from "./sql.js";

function assertShareDbReady(_req: Request, res: Response, next: NextFunction) {
    if (!isShareDbReady()) {
        res.status(503).send("The application is still initializing. Please try again in a moment.");
        return;
    }

    next();
}

function addNoIndexHeader(note: SNote, res: Response) {
    if (note.isLabelTruthy("shareDisallowRobotIndexing")) {
        res.setHeader("X-Robots-Tag", "noindex");
    }
}

function requestCredentials(res: Response) {
    res.setHeader("WWW-Authenticate", 'Basic realm="User Visible Realm", charset="UTF-8"').sendStatus(401);
}

function checkAttachmentAccess(attachmentId: string, req: Request, res: Response) {
    const attachment = shaca.getAttachment(attachmentId);

    if (!attachment) {
        res.status(404).json({ message: `Attachment '${attachmentId}' not found.` });

        return false;
    }

    const note = checkNoteAccess(attachment.ownerId, req, res);

    if (!note) {
        return false;
    }

    // Protected notes cannot be shared, and neither can their attachments
    // (GHSA-xmv9-3v98-7gq8).
    if (rejectProtected(note, res, `Attachment '${attachmentId}' not found.`)) {
        return false;
    }

    return attachment;
}

function checkNoteAccess(noteId: string, req: Request, res: Response) {
    const note = shaca.getNote(noteId);

    if (!note) {
        res.status(404).json({ message: `Note '${noteId}' not found.` });

        return false;
    }

    if (noteId === "_share" && !shaca.shareIndexEnabled) {
        res.status(403).json({ message: `Accessing share index is forbidden.` });

        return false;
    }

    const credentials = note.getCredentials();

    if (credentials.length === 0) {
        return note;
    }

    const header = req.header("Authorization");

    if (!header?.startsWith("Basic ")) {
        return false;
    }

    const base64Str = header.substring("Basic ".length);
    const buffer = Buffer.from(base64Str, "base64");
    const authString = buffer.toString("utf-8");

    for (const credentialLabel of credentials) {
        if (safeCompare(authString, credentialLabel.value)) {
            return note; // success;
        }
    }

    return false;
}

// Like checkNoteAccess, but additionally refuses protected notes. Used by the
// routes that stream a note's raw content/images: a protected note still shows
// up as "[protected]" in the shared tree (handled by content_renderer.ts), but
// its actual bytes must never be served anonymously (GHSA-xmv9-3v98-7gq8).
function checkNoteContentAccess(noteId: string, req: Request, res: Response) {
    const note = checkNoteAccess(noteId, req, res);

    if (!note) {
        return false;
    }

    if (rejectProtected(note, res, `Note '${noteId}' not found.`)) {
        return false;
    }

    return note;
}

// Sends a 404 and returns true when the note is protected, so callers can bail.
function rejectProtected(note: SNote, res: Response, message: string) {
    if (!note.isProtected) {
        return false;
    }

    res.status(404).json({ message });

    return true;
}

function renderImageAttachment(image: SNote, res: Response, attachmentName: string) {
    let svgString = "<svg/>";
    const attachment = image.getAttachmentByTitle(attachmentName);
    if (!attachment) {

        return;
    }
    const content = attachment.getContent();
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

    const svg = utils.sanitizeSvg(svgString);
    res.set("Content-Type", "image/svg+xml");
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Content-Security-Policy", utils.SVG_CONTENT_SECURITY_POLICY);
    res.set("X-Content-Type-Options", "nosniff");
    res.send(svg);
}

function render404(res: Response) {
    res.status(404);
    const shareThemePath = getDefaultTemplatePath("404");
    res.render(shareThemePath);
}

function register(router: Router) {
    // Guard: if the share DB is not yet initialized, return 503 for all /share routes.
    router.use("/share", assertShareDbReady);

    function renderNote(note: SNote, req: Request, res: Response) {
        if (!note) {
            console.log("Unable to find note ", note);
            res.status(404);
            render404(res);
            return;
        }

        if (!checkNoteAccess(note.noteId, req, res)) {
            requestCredentials(res);

            return;
        }

        addNoIndexHeader(note, res);

        if (note.isLabelTruthy("shareRaw") || typeof req.query.raw !== "undefined") {
            // A protected note is shown as a placeholder by renderNoteContent()
            // below, but the raw branch streams note.getContent() directly, so it
            // must refuse protected notes (GHSA-xmv9-3v98-7gq8).
            if (note.isProtected) {
                render404(res);

                return;
            }

            // For SVG content, add a restrictive Content-Security-Policy to prevent
            // stored XSS via script execution (CWE-79). HTML is intentionally served
            // unrestricted here: serving raw HTML requires the `#shareRaw` attribute (or an
            // explicit `?raw`), and `#shareRaw` is flagged dangerous (see builtin_attributes.ts),
            // so the instance owner is deliberately opting in to serve their own scriptable
            // content. Restricting it would break legitimate self-contained HTML pages.
            if (note.mime === "image/svg+xml") {
                res.setHeader("Content-Security-Policy", utils.SVG_CONTENT_SECURITY_POLICY);
                res.setHeader("X-Content-Type-Options", "nosniff");
            }

            res.setHeader("Content-Type", note.mime).send(note.getContent());

            return;
        }

        res.send(renderNoteContent(note));
    }

    router.get("/share/", (req, res) => {
        if (req.path.substr(-1) !== "/") {
            res.redirect("../share/");
            return;
        }

        shacaLoader.ensureLoad();

        if (!shaca.shareRootNote) {
            res.status(404).json({ message: "Share root note not found" });
            return;
        }

        renderNote(shaca.shareRootNote, req, res);
    });

    router.get("/share/:shareId", (req, res) => {
        shacaLoader.ensureLoad();

        const { shareId } = req.params;

        const note = shaca.aliasToNote[shareId] || shaca.notes[shareId];

        renderNote(note, req, res);
    });

    router.get("/share/api/notes/:noteId", (req, res) => {
        shacaLoader.ensureLoad();
        let note: SNote | boolean;

        if (!(note = checkNoteAccess(req.params.noteId, req, res))) {
            return;
        }

        addNoIndexHeader(note, res);

        res.json(note.getPojo());
    });

    router.get("/share/api/notes/:noteId/download", (req, res) => {
        shacaLoader.ensureLoad();

        let note: SNote | boolean;

        if (!(note = checkNoteContentAccess(req.params.noteId, req, res))) {
            return;
        }

        addNoIndexHeader(note, res);

        const filename = utils.formatDownloadTitle(note.title, note.type, note.mime);

        res.setHeader("Content-Disposition", utils.getContentDisposition(filename));

        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Content-Type", note.mime);

        res.send(note.getContent());
    });

    // :filename is not used by trilium, but instead used for "save as" to assign a human-readable filename
    router.get("/share/api/images/:noteId/:filename", (req, res) => {
        shacaLoader.ensureLoad();

        let image: SNote | boolean;

        if (!(image = checkNoteContentAccess(req.params.noteId, req, res))) {
            return;
        }

        if (image.type === "image") {
            addNoIndexHeader(image, res);
            if (image.mime === "image/svg+xml") {
                // SVG images require sanitization to prevent stored XSS
                const content = image.getContent();
                const svgContent = typeof content === "string" ? content : new TextDecoder().decode(content ?? new Uint8Array());
                const sanitized = utils.sanitizeSvg(svgContent);
                res.set("Content-Type", "image/svg+xml");
                res.set("Cache-Control", "no-cache, no-store, must-revalidate");
                res.set("Content-Security-Policy", utils.SVG_CONTENT_SECURITY_POLICY);
                res.set("X-Content-Type-Options", "nosniff");
                res.send(sanitized);
            } else {
                res.set("Content-Type", image.mime);
                res.send(image.getContent());
            }
        } else if (image.type === "canvas") {
            renderImageAttachment(image, res, NOTE_TYPE_IMAGE_ATTACHMENTS.canvas);
        } else if (image.type === "mermaid") {
            renderImageAttachment(image, res, NOTE_TYPE_IMAGE_ATTACHMENTS.mermaid);
        } else if (image.type === "mindMap") {
            renderImageAttachment(image, res, NOTE_TYPE_IMAGE_ATTACHMENTS.mindMap);
        } else {
            res.status(400).json({ message: "Requested note is not a shareable image" });
        }
    });

    // :filename is not used by trilium, but instead used for "save as" to assign a human-readable filename
    router.get("/share/api/attachments/:attachmentId/image/:filename", (req, res) => {
        shacaLoader.ensureLoad();

        let attachment: SAttachment | boolean;

        if (!(attachment = checkAttachmentAccess(req.params.attachmentId, req, res))) {
            return;
        }

        if (attachment.role === "image") {
            addNoIndexHeader(attachment.note, res);
            if (attachment.mime === "image/svg+xml") {
                // SVG attachments require sanitization to prevent stored XSS
                const content = attachment.getContent();
                const svgContent = typeof content === "string" ? content : new TextDecoder().decode(content ?? new Uint8Array());
                const sanitized = utils.sanitizeSvg(svgContent);
                res.set("Content-Type", "image/svg+xml");
                res.set("Cache-Control", "no-cache, no-store, must-revalidate");
                res.set("Content-Security-Policy", utils.SVG_CONTENT_SECURITY_POLICY);
                res.set("X-Content-Type-Options", "nosniff");
                res.send(sanitized);
            } else {
                res.set("Content-Type", attachment.mime);
                res.send(attachment.getContent());
            }
        } else {
            res.status(400).json({ message: "Requested attachment is not a shareable image" });
        }
    });

    router.get("/share/api/attachments/:attachmentId/download", (req, res) => {
        shacaLoader.ensureLoad();

        let attachment: SAttachment | boolean;

        if (!(attachment = checkAttachmentAccess(req.params.attachmentId, req, res))) {
            return;
        }

        addNoIndexHeader(attachment.note, res);

        const filename = utils.formatDownloadTitle(attachment.title, null, attachment.mime);

        res.setHeader("Content-Disposition", utils.getContentDisposition(filename));

        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Content-Type", attachment.mime);

        res.send(attachment.getContent());
    });

    // used for PDF viewing
    router.get("/share/api/notes/:noteId/view", (req, res) => {
        shacaLoader.ensureLoad();

        let note: SNote | boolean;

        if (!(note = checkNoteContentAccess(req.params.noteId, req, res))) {
            return;
        }

        addNoIndexHeader(note, res);

        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Content-Type", note.mime);

        res.send(note.getContent());
    });

    // Used for searching, require noteId so we know the subTreeRoot
    router.get("/share/api/notes", (req, res) => {
        shacaLoader.ensureLoad();

        const ancestorNoteId = req.query.ancestorNoteId ?? "_share";

        if (typeof ancestorNoteId !== "string") {
            res.status(400).json({ message: "'ancestorNoteId' parameter is mandatory." });
            return;
        }

        // This will automatically return if no ancestorNoteId is provided and there is no shareIndex
        if (!checkNoteAccess(ancestorNoteId, req, res)) {
            return;
        }

        const { search } = req.query;

        if (typeof search !== "string" || !search?.trim()) {
            res.status(400).json({ message: "'search' parameter is mandatory." });
            return;
        }

        const searchContext = new SearchContext({ ancestorNoteId });
        const searchResults = searchService.findResultsWithQuery(search, searchContext);

        // Extract content snippets so the share viewer can show what matched.
        // Snippet extraction reads each note's content and runs token highlighting, so we
        // cap it to the first SNIPPET_LIMIT results (the share popout only renders 5).
        // Results beyond the cap are still returned, just without a snippet.
        const SNIPPET_LIMIT = 20;
        const snippetTargets = searchResults.slice(0, SNIPPET_LIMIT);
        const { highlightedTokens } = searchContext;
        for (const result of snippetTargets) {
            result.contentSnippet = searchService.extractContentSnippet(
                result.noteId, highlightedTokens
            );
        }
        // highlightSearchResults wraps matched tokens in <b>...</b> on highlightedContentSnippet.
        // We pass ignoreInternalAttributes=true to match the share UX (no internal attrs).
        searchService.highlightSearchResults(snippetTargets, highlightedTokens, true);

        const filteredResults = searchResults.map((sr) => {
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

        res.json({ results: filteredResults });
    });
}

export default {
    register
};
