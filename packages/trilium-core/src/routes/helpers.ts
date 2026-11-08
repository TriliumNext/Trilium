import { isSvgMime } from "@triliumnext/commons";
import { Response } from "../http_interface";
import becca from "../becca/becca";
import BNote from "../becca/entities/bnote";
import noteService from "../services/notes";
import protected_session from "../services/protected_session";
import BAttachment from "../becca/entities/battachment";
import { unwrapStringOrBuffer } from "../services/utils/binary";
import { getContentDisposition, getInlineContentHeaders, sanitizeSvg, SVG_CONTENT_SECURITY_POLICY } from "../services/utils/index";

export function downloadNoteInt(noteId: string, res: Response, contentDisposition = true) {
    const note = becca.getNote(noteId);

    if (!note) {
        return res.setHeader("Content-Type", "text/plain").status(404).send(`Note '${noteId}' doesn't exist.`);
    }

    return downloadData(note, res, contentDisposition);
}

export function downloadData(noteOrAttachment: BNote | BAttachment, res: Response, contentDisposition: boolean) {
    if (noteOrAttachment.isProtected && !protected_session.isProtectedSessionAvailable()) {
        return res.status(401).send("Protected session not available");
    }

    if (contentDisposition) {
        const fileName = noteOrAttachment.getFileName();

        res.setHeader("Content-Disposition", getContentDisposition(fileName));
    }

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Content-Type", noteOrAttachment.mime);

    // Without a Content-Disposition the browser renders the response instead of saving it, and an SVG
    // or HTML document runs its scripts in Trilium's origin. A download is left byte-for-byte:
    // `getContentDisposition()` marks it `attachment`, which never renders, and the file the user
    // asked for has to reach the disk as it was stored.
    if (!contentDisposition) {
        if (isSvgMime(noteOrAttachment.mime)) {
            return sendSanitizedSvg(res, noteOrAttachment.getContent());
        }

        setHeaders(res, getInlineContentHeaders(noteOrAttachment.mime));
    }

    res.send(noteService.getPortableContent(noteOrAttachment));
}

/** Serves stored content inline: an SVG sanitized, anything else as is under {@link getInlineContentHeaders}. */
export function sendInlineContent(res: Response, mime: string, content: string | Uint8Array) {
    if (isSvgMime(mime)) {
        return sendSanitizedSvg(res, content);
    }

    setHeaders(res, getInlineContentHeaders(mime));
    res.send(content);
}

/**
 * Serves SVG content stripped of everything that executes, behind a Content-Security-Policy that
 * blocks scripting even if a payload survives {@link sanitizeSvg}, and `nosniff` so the response
 * cannot be re-typed into something scriptable.
 */
export function sendSanitizedSvg(res: Response, content: string | Uint8Array) {
    const svgString = unwrapStringOrBuffer(content);
    res.setHeader("Content-Security-Policy", SVG_CONTENT_SECURITY_POLICY);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(sanitizeSvg(svgString));
}

function setHeaders(res: Response, headers: Record<string, string>) {
    for (const [ name, value ] of Object.entries(headers)) {
        res.setHeader(name, value);
    }
}
