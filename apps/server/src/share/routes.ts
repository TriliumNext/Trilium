import safeCompare from "safe-compare";

import type { Request, Response, Router } from "express";

import shaca from "./shaca/shaca.js";
import shacaLoader from "./shaca/shaca_loader.js";
import searchService from "../services/search/services/search.js";
import SearchContext from "../services/search/search_context.js";
import type SNote from "./shaca/entities/snote.js";
import type SAttachment from "./shaca/entities/sattachment.js";
import { getDefaultTemplatePath, renderNoteContent } from "./content_renderer.js";
import utils from "../services/utils.js";
import { sanitizeSvg, setSvgHeaders } from "../services/svg_sanitizer.js";

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

    // truthy note means the user has access, and we can return the attachment
    return note ? attachment : false;
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

    const sanitized = sanitizeSvg(svgString);
    setSvgHeaders(res);
    res.send(sanitized);
}

function render404(res: Response) {
    res.status(404);
    const shareThemePath = getDefaultTemplatePath("404");
    res.render(shareThemePath);
}

function register(router: Router) {

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
            // For HTML and SVG content, add restrictive Content-Security-Policy
            // to prevent stored XSS via script execution (CWE-79).
            if (note.mime === "text/html" || note.mime === "image/svg+xml") {
                res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src * data:; font-src * data:");
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

        if (!(note = checkNoteAccess(req.params.noteId, req, res))) {
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

        if (!(image = checkNoteAccess(req.params.noteId, req, res))) {
            return;
        }

        if (image.type === "image") {
            addNoIndexHeader(image, res);
            if (image.mime === "image/svg+xml") {
                // SVG images require sanitization to prevent stored XSS
                const content = image.getContent();
                const sanitized = sanitizeSvg(typeof content === "string" ? content : content?.toString("utf-8") ?? "");
                setSvgHeaders(res);
                res.send(sanitized);
            } else {
                res.set("Content-Type", image.mime);
                res.send(image.getContent());
            }
        } else if (image.type === "canvas") {
            renderImageAttachment(image, res, "canvas-export.svg");
        } else if (image.type === "mermaid") {
            renderImageAttachment(image, res, "mermaid-export.svg");
        } else if (image.type === "mindMap") {
            renderImageAttachment(image, res, "mindmap-export.svg");
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
                const sanitized = sanitizeSvg(typeof content === "string" ? content : content?.toString("utf-8") ?? "");
                setSvgHeaders(res);
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

        if (!(note = checkNoteAccess(req.params.noteId, req, res))) {
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

        const searchContext = new SearchContext({ ancestorNoteId: ancestorNoteId });
        const searchResults = searchService.findResultsWithQuery(search, searchContext);
        const filteredResults = searchResults.map((sr) => {
            const fullNote = shaca.notes[sr.noteId];
            const startIndex = sr.notePathArray.indexOf(ancestorNoteId);
            const localPathArray = sr.notePathArray.slice(startIndex + 1).filter((id) => shaca.notes[id]);
            const pathTitle = localPathArray.map((id) => shaca.notes[id].title).join(" / ");
            return { id: fullNote.shareId, title: fullNote.title, score: sr.score, path: pathTitle };
        });

        res.json({ results: filteredResults });
    });
}

export default {
    register
};
