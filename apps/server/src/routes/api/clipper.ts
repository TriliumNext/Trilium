import { sanitize, ValidationError } from "@triliumnext/core";
import type { Request } from "express";
import { parse } from "node-html-parser";
import path from "path";

import type BNote from "../../becca/entities/bnote.js";
import appInfo from "../../services/app_info.js";
import attributeFormatter from "../../services/attribute_formatter.js";
import attributeService from "../../services/attributes.js";
import cloneService from "../../services/cloning.js";
import dateNoteService from "../../services/date_notes.js";
import dateUtils from "../../services/date_utils.js";
import imageService from "../../services/image.js";
import log from "../../services/log.js";
import noteService from "../../services/notes.js";
import utils from "../../services/utils.js";
import ws from "../../services/ws.js";

interface Image {
    src: string;
    dataUrl: string;
    imageId: string;
}

async function addClipping(req: Request) {
    // if a note under the clipperInbox has the same 'pageUrl' attribute,
    // add the content to that note and clone it under today's inbox
    // otherwise just create a new note under today's inbox
    const { title, content, images } = req.body;
    const clipType = "clippings";

    const clipperInbox = await getClipperInboxNote();

    const pageUrl = sanitize.sanitizeUrl(req.body.pageUrl);
    let clippingNote = findClippingNote(clipperInbox, pageUrl, clipType);

    if (!clippingNote) {
        clippingNote = noteService.createNewNote({
            parentNoteId: clipperInbox.noteId,
            title,
            content: "",
            type: "text"
        }).note;

        clippingNote.setLabel("clipType", "clippings");
        clippingNote.setLabel("pageUrl", pageUrl);
        clippingNote.setLabel("iconClass", "bx bx-globe");
    }

    const rewrittenContent = processContent(images, clippingNote, content);

    const existingContent = clippingNote.getContent();
    if (typeof existingContent !== "string") {
        throw new ValidationError("Invalid note content type.");
    }

    clippingNote.setContent(`${existingContent}${existingContent.trim() ? "<br>" : ""}${rewrittenContent}`);

    // TODO: Is parentNoteId ever defined?
    if ((clippingNote as any).parentNoteId !== clipperInbox.noteId) {
        cloneService.cloneNoteToParentNote(clippingNote.noteId, clipperInbox.noteId);
    }

    return {
        noteId: clippingNote.noteId
    };
}

function findClippingNote(clipperInboxNote: BNote, pageUrl: string, clipType: string | null) {
    if (!pageUrl) {
        return null;
    }

    const notes = clipperInboxNote.searchNotesInSubtree(
        attributeFormatter.formatAttrForSearch(
            {
                type: "label",
                name: "pageUrl",
                value: pageUrl
            },
            true
        )
    );

    return clipType ? notes.find((note) => note.getOwnedLabelValue("clipType") === clipType) : notes[0];
}

async function getClipperInboxNote() {
    let clipperInbox = attributeService.getNoteWithLabel("clipperInbox");

    if (!clipperInbox) {
        clipperInbox = await dateNoteService.getDayNote(dateUtils.localNowDate());
    }

    return clipperInbox;
}

async function createNote(req: Request) {
    const { content, images, labels } = req.body;

    const clipType = sanitize.sanitizeHtml(req.body.clipType);
    const pageUrl = sanitize.sanitizeUrl(req.body.pageUrl);

    const trimmedTitle = (typeof req.body.title === "string") ? req.body.title.trim() : "";
    const title = trimmedTitle || `Clipped note from ${pageUrl}`;

    const clipperInbox = await getClipperInboxNote();
    let note = findClippingNote(clipperInbox, pageUrl, clipType);

    if (!note) {
        note = noteService.createNewNote({
            parentNoteId: clipperInbox.noteId,
            title,
            content: "",
            type: "text"
        }).note;

        note.setLabel("clipType", clipType);

        if (pageUrl) {
            note.setLabel("pageUrl", pageUrl);
            note.setLabel("iconClass", "bx bx-globe");
        }
    }

    if (labels) {
        for (const labelName in labels) {
            const labelValue = sanitize.sanitizeHtml(labels[labelName]);
            note.setLabel(labelName, labelValue);
        }
    }

    const existingContent = note.getContent();
    if (typeof existingContent !== "string") {
        throw new ValidationError("Invalid note content type.");
    }
    const rewrittenContent = processContent(images, note, content);
    const newContent = `${existingContent}${existingContent.trim() ? "<br/>" : ""}${rewrittenContent}`;
    note.setContent(newContent);

    noteService.asyncPostProcessContent(note, newContent); // to mark attachments as used

    return {
        noteId: note.noteId
    };
}

export function processContent(images: Image[], note: BNote, content: string) {
    let rewrittenContent = sanitize.sanitizeHtml(content);

    if (images) {
        for (const { src, dataUrl, imageId } of images) {
            const filename = path.basename(src);

            if (!dataUrl || !dataUrl.startsWith("data:image")) {
                const excerpt = dataUrl ? dataUrl.substr(0, Math.min(100, dataUrl.length)) : "null";

                log.info(`Image could not be recognized as data URL: ${excerpt}`);
                continue;
            }

            const buffer = Buffer.from(dataUrl.split(",")[1], "base64");

            const attachment = imageService.saveImageToAttachment(note.noteId, buffer, filename, true);

            const encodedTitle = encodeURIComponent(attachment.title);
            const url = `api/attachments/${attachment.attachmentId}/image/${encodedTitle}`;

            log.info(`Replacing '${imageId}' with '${url}' in note '${note.noteId}'`);

            rewrittenContent = utils.replaceAll(rewrittenContent, imageId, url);
        }
    }

    // fallback if parsing/downloading images fails for some reason on the extension side (
    rewrittenContent = noteService.downloadImages(note.noteId, rewrittenContent);
    // Check if rewrittenContent contains at least one HTML tag
    if (!/<.+?>/.test(rewrittenContent)) {
        rewrittenContent = `<p>${rewrittenContent}</p>`;
    }
    // Create a JSDOM object from the existing HTML content
    const dom = parse(rewrittenContent);

    // Get the content inside the body tag and serialize it
    rewrittenContent = dom.innerHTML ?? "";

    return rewrittenContent;
}

function openNote(req: Request) {
    if (utils.isElectron) {
        ws.sendMessageToAllClients({
            type: "openNote",
            noteId: req.params.noteId
        });

        return {
            result: "ok"
        };
    }
    return {
        result: "open-in-browser"
    };

}

function handshake() {
    return {
        appName: "trilium",
        protocolVersion: appInfo.clipperProtocolVersion
    };
}

async function findNotesByUrl(req: Request) {
    const pageUrl = req.params.noteUrl;
    const clipperInbox = await getClipperInboxNote();
    const foundPage = findClippingNote(clipperInbox, pageUrl, null);
    return {
        noteId: foundPage ? foundPage.noteId : null
    };
}

export default {
    createNote,
    addClipping,
    openNote,
    handshake,
    findNotesByUrl
};
