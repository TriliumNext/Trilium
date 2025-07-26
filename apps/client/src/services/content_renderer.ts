import renderService from "./render.js";
import protectedSessionService from "./protected_session.js";
import protectedSessionHolder from "./protected_session_holder.js";
import openService from "./open.js";
import froca from "./froca.js";
import utils from "./utils.js";
import linkService from "./link.js";
import treeService from "./tree.js";
import FNote from "../entities/fnote.js";
import FAttachment from "../entities/fattachment.js";
import imageContextMenuService from "../menus/image_context_menu.js";
import { applySingleBlockSyntaxHighlight, formatCodeBlocks } from "./syntax_highlight.js";
import { loadElkIfNeeded, postprocessMermaidSvg } from "./mermaid.js";
import renderDoc from "./doc_renderer.js";
import { t } from "../services/i18n.js";
import WheelZoom from 'vanilla-js-wheel-zoom';
import { renderMathInElement } from "./math.js";
import { normalizeMimeTypeForCKEditor } from "@triliumnext/commons";

let idCounter = 1;

interface Options {
    tooltip?: boolean;
    trim?: boolean;
    imageHasZoom?: boolean;
    showOcrText?: boolean;
}

const CODE_MIME_TYPES = new Set(["application/json"]);

async function getRenderedContent(this: {} | { ctx: string }, entity: FNote | FAttachment, options: Options = {}) {

    options = Object.assign(
        {
            tooltip: false
        },
        options
    );

    const type = getRenderingType(entity);
    // attachment supports only image and file/pdf/audio/video

    const $renderedContent = $('<div class="rendered-content">');

    if (type === "text" || type === "book") {
        await renderText(entity, $renderedContent);
    } else if (type === "code") {
        await renderCode(entity, $renderedContent);
    } else if (["image", "canvas", "mindMap"].includes(type)) {
        await renderImage(entity, $renderedContent, options);
    } else if (!options.tooltip && ["file", "pdf", "audio", "video"].includes(type)) {
        await renderFile(entity, type, $renderedContent, options);
    } else if (type === "mermaid") {
        await renderMermaid(entity, $renderedContent);
    } else if (type === "render" && entity instanceof FNote) {
        const $content = $("<div>");

        await renderService.render(entity, $content);

        $renderedContent.append($content);
    } else if (type === "doc" && "noteId" in entity) {
        const $content = await renderDoc(entity);
        $renderedContent.html($content.html());
    } else if (!options.tooltip && type === "protectedSession") {
        const $button = $(`<button class="btn btn-sm"><span class="bx bx-log-in"></span> Enter protected session</button>`).on("click", protectedSessionService.enterProtectedSession);

        $renderedContent.append($("<div>").append("<div>This note is protected and to access it you need to enter password.</div>").append("<br/>").append($button));
    } else if (entity instanceof FNote) {
        $renderedContent.append(
            $("<div>")
                .css("display", "flex")
                .css("justify-content", "space-around")
                .css("align-items", "center")
                .css("height", "100%")
                .css("font-size", "500%")
                .append($("<span>").addClass(entity.getIcon()))
        );
    }

    if (entity instanceof FNote) {
        $renderedContent.addClass(entity.getCssClass());
    }

    return {
        $renderedContent,
        type
    };
}

async function renderText(note: FNote | FAttachment, $renderedContent: JQuery<HTMLElement>) {
    // entity must be FNote
    const blob = await note.getBlob();

    if (blob && !utils.isHtmlEmpty(blob.content)) {
        $renderedContent.append($('<div class="ck-content">').html(blob.content));

        if ($renderedContent.find("span.math-tex").length > 0) {
            renderMathInElement($renderedContent[0], { trust: true });
        }

        const getNoteIdFromLink = (el: HTMLElement) => treeService.getNoteIdFromUrl($(el).attr("href") || "");
        const referenceLinks = $renderedContent.find("a.reference-link");
        const noteIdsToPrefetch = referenceLinks.map((i, el) => getNoteIdFromLink(el));
        await froca.getNotes(noteIdsToPrefetch);

        for (const el of referenceLinks) {
            await linkService.loadReferenceLinkTitle($(el));
        }

        await formatCodeBlocks($renderedContent);
    } else if (note instanceof FNote) {
        await renderChildrenList($renderedContent, note);
    }
}

/**
 * Renders a code note, by displaying its content and applying syntax highlighting based on the selected MIME type.
 */
async function renderCode(note: FNote | FAttachment, $renderedContent: JQuery<HTMLElement>) {
    const blob = await note.getBlob();

    let content = blob?.content || "";
    if (note.mime === "application/json") {
        try {
            content = JSON.stringify(JSON.parse(content), null, 4);
        } catch (e) {
            // Ignore JSON parsing errors.
        }
    }

    const $codeBlock = $("<code>");
    $codeBlock.text(content);
    $renderedContent.append($("<pre>").append($codeBlock));
    await applySingleBlockSyntaxHighlight($codeBlock, normalizeMimeTypeForCKEditor(note.mime));
}

async function renderImage(entity: FNote | FAttachment, $renderedContent: JQuery<HTMLElement>, options: Options = {}) {
    const encodedTitle = encodeURIComponent(entity.title);

    let url;

    if (entity instanceof FNote) {
        url = `api/images/${entity.noteId}/${encodedTitle}?${Math.random()}`;
    } else if (entity instanceof FAttachment) {
        url = `api/attachments/${entity.attachmentId}/image/${encodedTitle}?${entity.utcDateModified}">`;
    }

    $renderedContent // styles needed for the zoom to work well
        .css("display", "flex")
        .css("align-items", "center")
        .css("justify-content", "center");

    const $img = $("<img>")
        .attr("src", url || "")
        .attr("id", "attachment-image-" + idCounter++)
        .css("max-width", "100%");

    $renderedContent.append($img);

    if (options.imageHasZoom) {
        const initZoom = async () => {
            const element = document.querySelector(`#${$img.attr("id")}`);
            if (element) {
                WheelZoom.create(`#${$img.attr("id")}`, {
                    maxScale: 50,
                    speed: 1.3,
                    zoomOnClick: false
                });
            } else {
                requestAnimationFrame(initZoom);
            }
        };
        initZoom();
    }

    imageContextMenuService.setupContextMenu($img);

    // Add OCR text display for image notes
    if (entity instanceof FNote && options.showOcrText) {
        await addOCRTextIfAvailable(entity, $renderedContent);
    }
}

async function addOCRTextIfAvailable(note: FNote, $content: JQuery<HTMLElement>) {
    try {
        const response = await fetch(`api/ocr/notes/${note.noteId}/text`);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.hasOcr && data.text) {
                const $ocrSection = $(`
                    <div class="ocr-text-section">
                        <div class="ocr-header">
                            <span class="bx bx-text"></span> ${t("ocr.extracted_text")}
                        </div>
                        <div class="ocr-content"></div>
                    </div>
                `);

                $ocrSection.find('.ocr-content').text(data.text);
                $content.append($ocrSection);
            }
        }
    } catch (error) {
        // Silently fail if OCR API is not available
        console.debug('Failed to fetch OCR text:', error);
    }
}

async function renderFile(entity: FNote | FAttachment, type: string, $renderedContent: JQuery<HTMLElement>, options: Options = {}) {
    let entityType, entityId;

    if (entity instanceof FNote) {
        entityType = "notes";
        entityId = entity.noteId;
    } else if (entity instanceof FAttachment) {
        entityType = "attachments";
        entityId = entity.attachmentId;
    } else {
        throw new Error(`Can't recognize entity type of '${entity}'`);
    }

    const $content = $('<div style="display: flex; flex-direction: column; height: 100%;">');

    if (type === "pdf") {
        const $pdfPreview = $('<iframe class="pdf-preview" style="width: 100%; flex-grow: 100;"></iframe>');
        $pdfPreview.attr("src", openService.getUrlForDownload(`api/${entityType}/${entityId}/open`));

        $content.append($pdfPreview);
    } else if (type === "audio") {
        const $audioPreview = $("<audio controls></audio>")
            .attr("src", openService.getUrlForDownload(`api/${entityType}/${entityId}/open-partial`))
            .attr("type", entity.mime)
            .css("width", "100%");

        $content.append($audioPreview);
    } else if (type === "video") {
        const $videoPreview = $("<video controls></video>")
            .attr("src", openService.getUrlForDownload(`api/${entityType}/${entityId}/open-partial`))
            .attr("type", entity.mime)
            .css("width", "100%");

        $content.append($videoPreview);
    }

    // Add OCR text display for file notes
    if (entity instanceof FNote && options.showOcrText) {
        await addOCRTextIfAvailable(entity, $content);
    }

    if (entityType === "notes" && "noteId" in entity) {
        // TODO: we should make this available also for attachments, but there's a problem with "Open externally" support
        //       in attachment list
        const $downloadButton = $(`
            <button class="file-download btn btn-primary" type="button">
                <span class="bx bx-download"></span>
                ${t("file_properties.download")}
            </button>
        `);

        const $openButton = $(`
            <button class="file-open btn btn-primary" type="button">
                <span class="bx bx-link-external"></span>
                ${t("file_properties.open")}
            </button>
        `);

        $downloadButton.on("click", () => openService.downloadFileNote(entity.noteId));
        $openButton.on("click", () => openService.openNoteExternally(entity.noteId, entity.mime));
        // open doesn't work for protected notes since it works through a browser which isn't in protected session
        $openButton.toggle(!entity.isProtected);

        $content.append($('<footer class="file-footer">').append($downloadButton).append($openButton));
    }

    $renderedContent.append($content);
}

async function renderMermaid(note: FNote | FAttachment, $renderedContent: JQuery<HTMLElement>) {
    const mermaid = (await import("mermaid")).default;

    const blob = await note.getBlob();
    const content = blob?.content || "";

    $renderedContent.css("display", "flex").css("justify-content", "space-around");

    const documentStyle = window.getComputedStyle(document.documentElement);
    const mermaidTheme = documentStyle.getPropertyValue("--mermaid-theme");

    mermaid.mermaidAPI.initialize({ startOnLoad: false, theme: mermaidTheme.trim() as "default", securityLevel: "antiscript" });

    try {
        await loadElkIfNeeded(mermaid, content);
        const { svg } = await mermaid.mermaidAPI.render("in-mermaid-graph-" + idCounter++, content);

        $renderedContent.append($(postprocessMermaidSvg(svg)));
    } catch (e) {
        const $error = $("<p>The diagram could not displayed.</p>");

        $renderedContent.append($error);
    }
}

/**
 * @param {jQuery} $renderedContent
 * @param {FNote} note
 * @returns {Promise<void>}
 */
async function renderChildrenList($renderedContent: JQuery<HTMLElement>, note: FNote) {
    let childNoteIds = note.getChildNoteIds();

    if (!childNoteIds.length) {
        return;
    }

    $renderedContent.css("padding", "10px");
    $renderedContent.addClass("text-with-ellipsis");

    if (childNoteIds.length > 10) {
        childNoteIds = childNoteIds.slice(0, 10);
    }

    // just load the first 10 child notes
    const childNotes = await froca.getNotes(childNoteIds);

    for (const childNote of childNotes) {
        $renderedContent.append(
            await linkService.createLink(`${note.noteId}/${childNote.noteId}`, {
                showTooltip: false,
                showNoteIcon: true
            })
        );

        $renderedContent.append("<br>");
    }
}

function getRenderingType(entity: FNote | FAttachment) {
    let type: string = "";
    if ("type" in entity) {
        type = entity.type;
    } else if ("role" in entity) {
        type = entity.role;
    }

    const mime = "mime" in entity && entity.mime;

    if (type === "file" && mime === "application/pdf") {
        type = "pdf";
    } else if ((type === "file" || type === "viewConfig") && mime && CODE_MIME_TYPES.has(mime)) {
        type = "code";
    } else if (type === "file" && mime && mime.startsWith("audio/")) {
        type = "audio";
    } else if (type === "file" && mime && mime.startsWith("video/")) {
        type = "video";
    }

    if (entity.isProtected) {
        if (protectedSessionHolder.isProtectedSessionAvailable()) {
            protectedSessionHolder.touchProtectedSession();
        } else {
            type = "protectedSession";
        }
    }

    return type;
}

export default {
    getRenderedContent
};
