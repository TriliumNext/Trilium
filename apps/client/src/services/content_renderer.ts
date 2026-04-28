import "./content_renderer.css";

import { normalizeMimeTypeForCKEditor, renderToHtml, type TextRepresentationResponse } from "@triliumnext/commons";
import DOMPurify from "dompurify";
import { h, render } from "preact";
import WheelZoom from 'vanilla-js-wheel-zoom';

import FAttachment from "../entities/fattachment.js";
import FNote from "../entities/fnote.js";
import imageContextMenuService from "../menus/image_context_menu.js";
import { t } from "../services/i18n.js";
import renderText, { postProcessRichContent, renderChildrenList } from "./content_renderer_text.js";
import renderDoc from "./doc_renderer.js";
import { loadElkIfNeeded, postprocessMermaidSvg } from "./mermaid.js";
import openService from "./open.js";
import protectedSessionService from "./protected_session.js";
import protectedSessionHolder from "./protected_session_holder.js";
import renderService from "./render.js";
import server from "./server.js";
import { applySingleBlockSyntaxHighlight } from "./syntax_highlight.js";
import utils, { getErrorMessage } from "./utils.js";

let idCounter = 1;

export interface RenderOptions {
    tooltip?: boolean;
    trim?: boolean;
    imageHasZoom?: boolean;
    /** If enabled, it will prevent the default behavior in which an empty note would display a list of children. */
    noChildrenList?: boolean;
    /** If enabled, it will prevent rendering of included notes. */
    noIncludedNotes?: boolean;
    /** If enabled, it will include archived notes when rendering children list. */
    includeArchivedNotes?: boolean;
    /** Set of note IDs that have already been seen during rendering to prevent infinite recursion. */
    seenNoteIds?: Set<string>;
    showTextRepresentation?: boolean;
}

const CODE_MIME_TYPES = new Set(["application/json"]);

export async function getRenderedContent(this: {} | { ctx: string }, entity: FNote | FAttachment, options: RenderOptions = {}) {

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
        await renderText(entity, $renderedContent, options);
    } else if (type === "markdown") {
        await renderMarkdown(entity, $renderedContent, options);
    } else if (type === "code") {
        await renderCode(entity, $renderedContent);
    } else if (["image", "canvas", "mindMap", "spreadsheet"].includes(type)) {
        await renderImage(entity, $renderedContent, options);
    } else if (!options.tooltip && ["file", "pdf", "audio", "video"].includes(type)) {
        await renderFile(entity, type, $renderedContent, options);
    } else if (type === "mermaid") {
        await renderMermaid(entity, $renderedContent);
    } else if (type === "render" && entity instanceof FNote) {
        const $content = $("<div>");

        await renderService.render(entity, $content, (e) => {
            const $error = $("<div>").addClass("admonition caution").text(typeof e === "string" ? e : getErrorMessage(e));
            $content.empty().append($error);
        });

        $renderedContent.append($content);
    } else if (type === "doc" && "noteId" in entity) {
        const $content = await renderDoc(entity);
        $renderedContent.html($content.html());
    } else if (!options.tooltip && type === "protectedSession") {
        const $button = $(`<button class="btn btn-sm"><span class="bx bx-log-in"></span> Enter protected session</button>`).on("click", protectedSessionService.enterProtectedSession);

        $renderedContent.append($("<div>").append("<div>This note is protected and to access it you need to enter password.</div>").append("<br/>").append($button));
    } else if (entity instanceof FNote) {
        $renderedContent.addClass("no-preview");
        $renderedContent.append(
            $("<div>").append($("<span>").addClass(entity.getIcon()))
        );

        if (entity.type === "webView" && entity.hasLabel("webViewSrc")) {
            const $footer = $("<footer>")
                .addClass("webview-footer");
            const $openButton = $(`
                <button class="file-open btn btn-primary" type="button">
                    <span class="bx bx-link-external"></span>
                    ${t("content_renderer.open_externally")}
                </button>
            `)
                .appendTo($footer)
                .on("click", () => {
                    const webViewSrc = entity.getLabelValue("webViewSrc");
                    if (webViewSrc) {
                        if (utils.isElectron()) {
                            const electron = utils.dynamicRequire("electron");
                            electron.shell.openExternal(webViewSrc);
                        } else {
                            window.open(webViewSrc, '_blank', 'noopener,noreferrer');
                        }
                    }
                });
            $footer.appendTo($renderedContent);
        }
    }

    if (entity instanceof FNote) {
        $renderedContent.addClass(entity.getCssClass());
    }

    return {
        $renderedContent,
        type
    };
}

/**
 * Renders a markdown note by converting its source to CKEditor-compatible HTML,
 * then running the same post-render pipeline as text notes (included notes,
 * math, reference links, Mermaid, code highlight) so the preview matches what
 * the user sees in the Markdown note type's preview pane.
 */
async function renderMarkdown(note: FNote | FAttachment, $renderedContent: JQuery<HTMLElement>, options: RenderOptions) {
    const blob = await note.getBlob();
    const source = blob?.content ?? "";

    if (!source.trim()) {
        if (note instanceof FNote && !options.noChildrenList) {
            await renderChildrenList($renderedContent, note, options.includeArchivedNotes ?? false);
        }
        return;
    }

    const html = renderToHtml(source, note.title, {
        sanitize: (dirty) => DOMPurify.sanitize(dirty),
        wikiLink: { formatHref: (id) => `#root/${id}` }
    });
    $renderedContent.append($('<div class="ck-content">').html(html));
    await postProcessRichContent(note, $renderedContent, options);
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

async function renderImage(entity: FNote | FAttachment, $renderedContent: JQuery<HTMLElement>, options: RenderOptions = {}) {
    const encodedTitle = encodeURIComponent(entity.title);

    let url;

    if (entity instanceof FNote) {
        url = `api/images/${entity.noteId}/${encodedTitle}?${Math.random()}`;
    } else if (entity instanceof FAttachment) {
        url = `api/attachments/${entity.attachmentId}/image/${encodedTitle}?${entity.utcDateModified}`;
    }

    $renderedContent // styles needed for the zoom to work well
        .css("display", "flex")
        .css("align-items", "center")
        .css("justify-content", "center")
        .css("flex-direction", "column");   // OCR text is displayed below the image.

    const $img = $("<img>")
        .attr("src", url || "")
        .attr("id", `attachment-image-${idCounter++}`)
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

    if (entity instanceof FNote && options.showTextRepresentation) {
        await addOCRTextIfAvailable(entity, $renderedContent);
    }
}

async function addOCRTextIfAvailable(note: FNote, $content: JQuery<HTMLElement>) {
    try {
        const data = await server.get<TextRepresentationResponse>(`ocr/notes/${note.noteId}/text`);
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
    } catch (error) {
        // Silently fail if OCR API is not available
        console.debug('Failed to fetch OCR text:', error);
    }
}

async function renderFile(entity: FNote | FAttachment, type: string, $renderedContent: JQuery<HTMLElement>, options: RenderOptions = {}) {
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

    const $content = $('<div style="display: flex; flex-direction: column; height: 100%; justify-content: end;">');

    if (type === "pdf") {
        const url = `../../api/${entityType}/${entityId}/open`;
        const $viewer = $(`<div style="height: 100%">`);
        const PdfViewer = (await import("../widgets/type_widgets/file/PdfViewer")).default;
        render(h(PdfViewer, {pdfUrl: url, editable: false, toolbar: false}), $viewer.get(0)!);

        $content.append($viewer);


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

    if (entity instanceof FNote && options.showTextRepresentation) {
        await addOCRTextIfAvailable(entity, $content);
    }

    if (entityType === "notes" && "noteId" in entity) {
        // TODO: we should make this available also for attachments, but there's a problem with "Open externally" support
        //       in attachment list
        const $downloadButton = $(`
            <button class="file-download btn btn-primary" type="button">
                <span class="tn-icon bx bx-download"></span>
                ${t("file_properties.download")}
            </button>
        `);

        const $openButton = $(`
            <button class="file-open btn btn-primary" type="button">
                <span class="tn-icon bx bx-link-external"></span>
                ${t("file_properties.open")}
            </button>
        `);

        $downloadButton.on("click", (e) => {
            e.stopPropagation();
            openService.downloadFileNote(entity, null, null);
        });
        $openButton.on("click", async (e) => {
            const iconEl = $openButton.find("> .bx");
            iconEl.removeClass("bx bx-link-external");
            iconEl.addClass("bx bx-loader spin");
            e.stopPropagation();
            await openService.openNoteExternally(entity.noteId, entity.mime);
            iconEl.removeClass("bx bx-loader spin");
            iconEl.addClass("bx bx-link-external");
        });
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
        const { svg } = await mermaid.mermaidAPI.render(`in-mermaid-graph-${idCounter++}`, content);

        $renderedContent.append($(postprocessMermaidSvg(svg)));
    } catch (e) {
        const $error = $("<p>The diagram could not displayed.</p>");

        $renderedContent.append($error);
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
    const isIconPack = entity instanceof FNote && entity.hasLabel("iconPack");

    if (type === "file" && mime === "application/pdf") {
        type = "pdf";
    } else if (type === "code" && entity instanceof FNote && entity.isMarkdown()) {
        type = "markdown";
    } else if ((type === "file" || type === "viewConfig") && mime && CODE_MIME_TYPES.has(mime) && !isIconPack) {
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
