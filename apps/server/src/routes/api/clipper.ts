import { escapeHtml, extractYouTubeVideoId, type LinkEmbedMetadata } from "@triliumnext/commons";
import { app_info as appInfo, attribute_formatter as attributeFormatter, attributes as attributeService, becca, type BNote, date_notes as dateNoteService, date_utils as dateUtils, getLog, note_service as noteService, options, resolveYouTubePreview, sanitize, search as searchService, storeFavicon, ValidationError, ws } from "@triliumnext/core";
import type { Request } from "express";
import { parse } from "node-html-parser";
import path from "path";

import imageService from "../../services/image.js";
import utils from "../../services/utils.js";

/** A browser tab as the extension sends it when saving the tabs of a window. */
interface ClippedTab {
    url?: unknown;
    title?: unknown;
    favicon?: unknown;
}

interface Image {
    src: string;
    dataUrl: string;
    imageId: string;
    /** Sent by recent versions of the extension; an older one's screenshots are shrunk to fit. */
    screenshot?: unknown;
}

async function addClipping(req: Request) {
    // if a #clipType=clippings note exists with the same 'pageUrl' attribute,
    // append the content to that note
    // otherwise create a new note under clipperInbox (or today's note)
    const { title, content, images, labels } = req.body;
    const clipType = "clippings";

    const pageUrl = sanitize.sanitizeUrl(req.body.pageUrl);
    let clippingNote = findClippingNote(pageUrl, clipType);

    if (!clippingNote) {
        const clipperInbox = await getClipperInboxNote();
        clippingNote = noteService.createNewNote({
            parentNoteId: clipperInbox.noteId,
            title,
            content: "",
            type: "text"
        }).note;

        clippingNote.setLabel("clipType", "clippings");
        clippingNote.setLabel("pageUrl", pageUrl);
    }

    setLabels(clippingNote, labels);

    const rewrittenContent = await processContent(images, clippingNote, content);

    const existingContent = clippingNote.getContent();
    if (typeof existingContent !== "string") {
        throw new ValidationError("Invalid note content type.");
    }

    clippingNote.setContent(`${existingContent}${existingContent.trim() ? "<br>" : ""}${rewrittenContent}`);

    return {
        noteId: clippingNote.noteId
    };
}

function findClippingNote(pageUrl: string, clipType: string | null) {
    if (!pageUrl) {
        return null;
    }

    const notes = searchService.searchNotes(
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
    const clipperInbox = attributeService.getNoteWithLabel("clipperInbox");
    if (clipperInbox) {
        return clipperInbox;
    }

    // Clipping a page is not a request for a journal, so a database without one keeps the
    // clipping at the top level rather than having a calendar built around it (#11034).
    if (!dateNoteService.hasCalendarRoot()) {
        return becca.getNoteOrThrow("root");
    }

    return await dateNoteService.getDayNote(dateUtils.localNowDate());
}

async function createNote(req: Request) {
    const { content, images, labels } = req.body;

    const clipType = sanitize.sanitizeHtml(req.body.clipType);
    const pageUrl = req.body.pageUrl ? sanitize.sanitizeUrl(req.body.pageUrl) : "";

    const trimmedTitle = (typeof req.body.title === "string") ? req.body.title.trim() : "";
    const title = trimmedTitle || `Clipped note from ${pageUrl}`;

    const clipperInbox = await getClipperInboxNote();
    let note = findClippingNote(pageUrl, clipType);

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
        }
    }

    setLabels(note, labels);

    const existingContent = note.getContent();
    if (typeof existingContent !== "string") {
        throw new ValidationError("Invalid note content type.");
    }
    const tabMentions = clipType === "tabs"
        ? await renderTabMentions(note, req.body.tabs)
        : undefined;
    const rewrittenContent = await processContent(images, note, tabMentions ?? content);
    const newContent = `${existingContent}${existingContent.trim() ? "<br/>" : ""}${rewrittenContent}`;
    note.setContent(newContent);

    void noteService.asyncPostProcessContent(note, newContent); // to mark attachments as used

    return {
        noteId: note.noteId
    };
}

/**
 * Saves a file the extension downloaded, such as the PDF a tab shows, as a file note. Each call
 * creates a note, since a file at the same address can have changed since it was last clipped.
 */
async function createFile(req: Request) {
    const { dataUrl, labels } = req.body;
    const header = typeof dataUrl === "string" ? /^data:([\w.+-]+\/[\w.+-]+);base64,/.exec(dataUrl) : null;
    if (!header) {
        throw new ValidationError("The file must be sent as a base64 data URL.");
    }

    const pageUrl = req.body.pageUrl ? sanitize.sanitizeUrl(req.body.pageUrl) : "";
    const fileName = typeof req.body.fileName === "string" ? path.basename(req.body.fileName).trim() : "";
    const trimmedTitle = typeof req.body.title === "string" ? req.body.title.trim() : "";
    const title = trimmedTitle || fileName || `Clipped file from ${pageUrl}`;

    const clipperInbox = await getClipperInboxNote();
    const { note } = noteService.createNewNote({
        parentNoteId: clipperInbox.noteId,
        title,
        content: Buffer.from(dataUrl.substring(header[0].length), "base64"),
        type: "file",
        mime: header[1]
    });

    note.setLabel("clipType", "file");
    if (pageUrl) {
        note.setLabel("pageUrl", pageUrl);
    }
    if (fileName) {
        note.setLabel("originalFileName", fileName);
    }
    setLabels(note, labels);

    return {
        noteId: note.noteId
    };
}

/**
 * Renders saved browser tabs as a list of link mentions, each with the tab's favicon stored as an
 * attachment of `note`. Returns undefined when automatic link previews are turned off or the
 * extension sent no tabs, so the plain list of links in `content` is kept.
 */
async function renderTabMentions(note: BNote, tabs: unknown) {
    if (!options.getOptionBool("textNoteAutoLinkPreviewsEnabled") || !Array.isArray(tabs)) {
        return undefined;
    }

    const items: string[] = [];
    for (const tab of tabs as (ClippedTab | null)[]) {
        if (typeof tab?.url !== "string") {
            continue;
        }

        const url = sanitize.sanitizeUrl(tab.url);
        const favicon = await storeTabFavicon(note, url, tab.favicon);
        const mention = renderLinkPreview("span", "link-mention", {
            url,
            embedType: extractYouTubeVideoId(url) ? "youtube" : "opengraph",
            title: typeof tab.title === "string" ? tab.title : undefined,
            favicon
        });
        items.push(`<li>${mention}</li>`);
    }

    return items.length ? `<ul>${items.join("")}</ul>` : undefined;
}

/** Stores a tab's favicon, sent as a base64 `data:image/…` URL, and returns its attachment URL. */
async function storeTabFavicon(note: BNote, pageUrl: string, dataUrl: unknown) {
    if (typeof dataUrl !== "string" || !/^data:image\/[^,]*;base64,/.test(dataUrl)) {
        return undefined;
    }

    const bytes = Buffer.from(dataUrl.substring(dataUrl.indexOf(",") + 1), "base64");
    return await storeFavicon(note.noteId, pageUrl, bytes);
}

/** Sets each label the extension sends, replacing the value a previous clipping set. */
function setLabels(note: BNote, labels: Record<string, string> | undefined) {
    for (const labelName in labels) {
        note.setLabel(labelName, sanitizeLabelValue(labels[labelName]));
    }
}

/**
 * Label values are plain text, so every tag is removed. `sanitize-html` writes `&` as `&amp;`;
 * turning it back cannot produce markup, since no `<` comes out of it.
 */
function sanitizeLabelValue(value: string) {
    return sanitize.sanitizeHtmlCustom(value, { allowedTags: [], allowedAttributes: {} })
        .replaceAll("&amp;", "&");
}

export async function processContent(images: Image[], note: BNote, content: string) {
    let rewrittenContent = sanitize.sanitizeHtml(await replaceYouTubePlayers(note, content));

    if (images) {
        for (const { src, dataUrl, imageId, screenshot } of images) {
            const filename = path.basename(src);

            if (!dataUrl || !dataUrl.startsWith("data:image")) {
                const excerpt = dataUrl ? dataUrl.substr(0, Math.min(100, dataUrl.length)) : "null";

                getLog().info(`Image could not be recognized as data URL: ${excerpt}`);
                continue;
            }

            const buffer = Buffer.from(dataUrl.split(",")[1], "base64");

            // A screenshot is held to the width setting only: fitting a long page into it by its
            // height would leave a strip too narrow to read.
            const attachment = imageService.saveImageToAttachment(
                note.noteId, buffer, filename, screenshot === true ? "width" : true);

            // The URL below goes into the note as an image source, and the note is opened as soon
            // as this answers. Waiting for the bytes is what stops the clipping from being read
            // with a hole where its picture should be.
            await imageService.awaitImageWrite(attachment.attachmentId);

            const encodedTitle = encodeURIComponent(attachment.title);
            const url = `api/attachments/${attachment.attachmentId}/image/${encodedTitle}`;

            getLog().info(`Replacing '${imageId}' with '${url}' in note '${note.noteId}'`);

            rewrittenContent = utils.replaceAll(rewrittenContent, imageId, url);
        }
    }

    // fallback if parsing/downloading images fails for some reason on the extension side (
    rewrittenContent = noteService.downloadImages(note.noteId, rewrittenContent);
    // Check if rewrittenContent contains at least one HTML tag
    if (!/<[^<>]+>/.test(rewrittenContent)) {
        rewrittenContent = `<p>${rewrittenContent}</p>`;
    }
    // Create a JSDOM object from the existing HTML content
    const dom = parse(rewrittenContent);

    // Get the content inside the body tag and serialize it
    rewrittenContent = dom.innerHTML ?? "";

    return rewrittenContent;
}

/**
 * Replaces each embedded YouTube player with a link preview, which the sanitizer keeps and which
 * starts playing only when clicked. The sanitizer removes every other iframe.
 */
async function replaceYouTubePlayers(note: BNote, content: string) {
    if (typeof content !== "string" || !content.includes("<iframe")) {
        return content;
    }

    const dom = parse(content);
    const players = dom.querySelectorAll("iframe").flatMap((iframe) => {
        const videoId = extractYouTubeVideoId(iframe.getAttribute("src") ?? "");
        return videoId ? [ { iframe, videoId } ] : [];
    });

    await Promise.all(players.map(async ({ iframe, videoId }) => {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        let metadata: LinkEmbedMetadata;
        try {
            metadata = await resolveYouTubePreview(note.noteId, url, videoId);
        } catch (e) {
            getLog().info(`Could not resolve the preview of a clipped YouTube video: ${e}`);
            metadata = { url, embedType: "youtube" };
        }
        iframe.replaceWith(renderLinkPreview("section", "link-embed", metadata));
    }));

    return dom.toString();
}

/** The markup the text editor stores for a link preview, a block `section` or an inline `span`. */
function renderLinkPreview(
    tagName: "section" | "span",
    className: string,
    metadata: LinkEmbedMetadata
) {
    const attributes = ([
        [ "data-url", metadata.url ],
        [ "data-embed-type", metadata.embedType ],
        [ "data-title", metadata.title ],
        [ "data-description", metadata.description ],
        [ "data-favicon", metadata.favicon ],
        [ "data-site-name", metadata.siteName ],
        [ "data-image", metadata.image ]
    ] as const)
        .filter(([ , value ]) => value)
        .map(([ name, value ]) => ` ${name}="${escapeHtml(value ?? "")}"`)
        .join("");
    return `<${tagName} class="${className}"${attributes}></${tagName}>`;
}

function openNote(req: Request<{ noteId: string }>) {
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

async function findNotesByUrl(req: Request<{ noteUrl: string }>) {
    const pageUrl = req.params.noteUrl;
    const foundPage = findClippingNote(pageUrl, null);
    return {
        noteId: foundPage ? foundPage.noteId : null
    };
}

export default {
    createNote,
    createFile,
    addClipping,
    openNote,
    handshake,
    findNotesByUrl
};
