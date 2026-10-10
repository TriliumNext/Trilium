import "./content_renderer.css";

import {
    attachmentIcon,
    CANVAS_ATTACHMENT_MIME,
    getEditableBlockRun,
    getMimeTypeFromFileName,
    isAcceptedImageMime,
    isImageAttachmentRole,
    isOfficeMimeType,
    normalizeMimeTypeForCKEditor,
    type TextRepresentationResponse
} from "@triliumnext/commons";
import DOMPurify from "dompurify";
import { h, type JSX, render } from "preact";

import type Component from "../components/component.js";
import type { SaveState } from "../components/note_context.js";
import FAttachment from "../entities/fattachment.js";
import FNote from "../entities/fnote.js";
import imageContextMenuService from "../menus/image_context_menu.js";
import { t } from "../services/i18n.js";
import { type MediaEnvironment, showsFileActions } from "../widgets/type_widgets/file/media_environment.js";
import type { LlmChatContent, StoredMessage } from "../widgets/type_widgets/llm_chat/llm_chat_types.js";
import type { BoxSize } from "../widgets/type_widgets/text/CKEditorWithWatchdog.js";
import renderText, {
    postProcessRichContent, renderChildrenList, renderTextContent
} from "./content_renderer_text.js";
import renderDoc from "./doc_renderer.js";
import { getAttachmentImageUrl, getNoteImageUrl } from "./image_urls.js";
import { getMermaidConfig, postprocessMermaidSvg } from "./mermaid.js";
import { renderOfficeToHtml } from "./office_renderer.js";
import openService from "./open.js";
import { waitForPendingRenders } from "./pending_renders.js";
import protectedSessionService from "./protected_session.js";
import protectedSessionHolder from "./protected_session_holder.js";
import server from "./server.js";
import { applySingleBlockSyntaxHighlight } from "./syntax_highlight.js";
import { getErrorMessage } from "./utils.js";

let idCounter = 1;

export interface RenderOptions {
    tooltip?: boolean;
    trim?: boolean;
    /** If enabled, it will prevent the default behavior in which an empty note would display a list of children. */
    noChildrenList?: boolean;
    /** If enabled, it will prevent rendering of embedded notes. */
    noContentEmbeds?: boolean;
    /**
     * Keep expanding embeds recursively at every depth. Used for printing/export,
     * which preserves full nesting. When false (the default for on-screen display), only the first
     * level of embedding is rendered and deeper embeds are replaced with a reference
     * link (see {@link embedsAsReferenceLinks}).
     */
    expandNestedEmbeds?: boolean;
    /**
     * Internal: render this note's own embeds as reference links instead of expanding
     * them. Set when rendering a note that is itself already an embedded note in display mode, so that
     * embedding stops after the first level.
     */
    embedsAsReferenceLinks?: boolean;
    /** If enabled, it will include archived notes when rendering children list. */
    includeArchivedNotes?: boolean;
    /** Set of note IDs that have already been seen during rendering to prevent infinite recursion. */
    seenNoteIds?: Set<string>;
    /**
     * The blocks of a text note to render, a `block` link parameter. The rest of the note is left
     * out, and a missing block renders as a broken reference.
     */
    block?: string;
    /** Points the embed of `block` at the blocks that its editor holds, once they change. */
    onBlockChange?: (block: string) => void;
    /** The blocks of a text note to highlight, a `block` link parameter. Embeds are left out. */
    highlightBlock?: string;
    showTextRepresentation?: boolean;
    /**
     * If enabled, note types that have a richer live representation (currently only web views) are
     * mounted as their interactive type widget instead of a static preview/placeholder. Off by
     * default and intentionally left off for lightweight previews such as tooltips and the note list.
     */
    interactive?: boolean;
    /**
     * How audio/video renders. `preview` (the default) shows a click-to-load placeholder, so that a screen
     * full of media notes doesn't have every one of them streaming from the server at once; `embedded`
     * mounts the compact player straight away. `native` emits a plain `<audio>`/`<video>` element instead of
     * the player, for the callers that serialize the rendered content into an HTML string or into a separate
     * document (presentation, printing) — a mounted player would be dead markup there.
     *
     * For images, `embedded` mounts the zoom/pan image viewer and the others a plain `<img>`.
     *
     * A full-size player has no entry here: it needs the tab it lives in (for sibling navigation and the OS
     * media session), which the renderer has no access to, so its hosts mount {@link MediaPreview} themselves.
     */
    mediaEnvironment?: "preview" | "embedded" | "native";
    /**
     * If enabled, PDFs render with the pdf.js toolbar (zoom, page navigation, print, download).
     * Off by default so that lightweight previews (attachment list, tooltips, embeds) stay bare;
     * the attachment full-detail view opts in. The viewer remains read-only either way.
     */
    pdfToolbar?: boolean;
    /**
     * Saves the changes that interactive content makes to an attachment, such as a canvas drawing.
     * Without it, that content is read-only.
     */
    attachmentEditor?: AttachmentEditor;
    /**
     * Saves the changes that interactive content makes to the note it shows, such as a code note.
     * Without it, that content is read-only.
     */
    noteEditor?: NoteEditor;
    /** The component a JSX render note mounts under, by default the one of the closest `.component` element. */
    parentComponent?: Component;
}

/** Saves the changes that rendered content makes to attachments of the note that shows it. */
export interface AttachmentEditor {
    /** Whether the rendered content can change `attachment`. */
    canEdit(attachment: FAttachment): boolean;
    /** The content of the attachment that is not saved yet, or `undefined`. */
    getUnsavedContent(attachmentId: string): string | undefined;
    /** Schedules a save of `attachment`. The save reads the content from `getContent`. */
    scheduleSave(attachment: FAttachment, getContent: () => string): void;
    /** Reads the unsaved content of the attachment now, before its editor unmounts. */
    release(attachmentId: string): void;
}

/** Saves the changes that rendered content makes to the notes it shows. */
export interface NoteEditor {
    /** Whether the rendered content can change `note`. */
    canEdit(note: FNote): boolean;
    /** The content of the note that is not saved yet, or `undefined`. */
    getUnsavedContent(noteId: string): string | undefined;
    /** Schedules a save of `note`. The save reads the content from `getContent`. */
    scheduleSave(note: FNote, getContent: () => string): void;
    /** Reads the unsaved content of the note now, before its editor unmounts. */
    release(noteId: string): void;
    /** How the saving of the note goes, or `undefined` before its first change. */
    getSaveState(noteId: string): SaveState | undefined;
    /** Calls `listener` when the save state of a note changes, until the returned call. */
    subscribeSaveState(listener: () => void): () => void;
}

const CODE_MIME_TYPES = new Set(["application/json"]);

/** The size of an attached text or code file above which it shows as a file: highlighting is slow. */
const MAX_ATTACHED_CODE_SIZE = 256 * 1024;

/** The types of the notes that an embed can edit in place. */
const EDITABLE_NOTE_TYPES = new Set<string>([ "code", "text" ]);

/** The media types of attached files, besides `text/*` and JSON, that show as code. */
const ATTACHED_CODE_MIME_TYPES = new Set([
    "application/javascript", "application/x-javascript", "application/x-sql"
]);

/**
 * The content types that an interactive `getRenderedContent()` previews; it shows any other as an
 * icon, or as the actions of a file. Keep in step with the branches there.
 */
const PREVIEWED_TYPES = new Set([
    "book", "search", "text", "markdown", "code", "iconPack", "image", "canvas", "canvasDrawing",
    "mindMap", "spreadsheet", "office", "pdf", "audio", "video", "mermaid", "render", "doc",
    "llmChat"
]);

/** The box size a new embed of blocks of a note, an excerpt, starts with. */
export const EXCERPT_BOX_SIZE: BoxSize = "full";

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

    if ((type === "book" || type === "search") && options.interactive && !options.tooltip
        && entity instanceof FNote && entity.getLabelValue("viewType") !== "dashboard") {
        // Render the live collection view (grid/table/board/calendar/map/presentation). The dashboard
        // view type is excluded: it's the only view that re-propagates `interactive` to its tiles, so
        // skipping it here is what keeps an embedded collection from recursing into itself.
        await renderCollection(entity, $renderedContent);
    } else if (type === "text" && options.interactive && options.noteEditor
        && entity instanceof FNote) {
        await renderEditableText(entity, $renderedContent, options);
    } else if (type === "text" || type === "book") {
        await renderText(entity, $renderedContent, options);
    } else if (type === "markdown") {
        await renderMarkdown(entity, $renderedContent, options);
    } else if (type === "code") {
        await renderCode(entity, $renderedContent, options);
    } else if (type === "iconPack" && !options.tooltip && entity instanceof FNote) {
        await renderIconPack(entity, $renderedContent, options);
    } else if (type === "canvasDrawing") {
        await renderCanvasDrawing(entity, $renderedContent, options);
    } else if (type === "image" && options.mediaEnvironment === "embedded") {
        await renderImageViewer(entity, $renderedContent);
    } else if (["image", "canvas", "mindMap", "spreadsheet"].includes(type)) {
        await renderImage(entity, $renderedContent, options);
    } else if (!options.tooltip && type === "office") {
        await renderOffice(entity, $renderedContent, options);
    } else if (!options.tooltip && ["file", "pdf", "audio", "video"].includes(type)) {
        await renderFile(entity, type, $renderedContent, options);
    } else if (type === "mermaid") {
        await renderMermaid(entity, $renderedContent);
    } else if (type === "render" && entity instanceof FNote) {
        const $content = $("<div>");

        const { default: renderService } = await CONTENT_RENDERERS.render();
        await renderService.render(entity, $content, (e, noteId) => {
            showRenderError($content, e, noteId).catch((cardError) => console.error("Failed to render the script error card:", cardError));
        }, options.parentComponent);

        $renderedContent.append($content);
    } else if (type === "doc" && "noteId" in entity) {
        const $content = await renderDoc(entity);
        $renderedContent.html($content.html());
    } else if (!options.tooltip && type === "protectedSession") {
        const $button = $(`<button class="btn btn-sm"><span class="tn-icon bx bx-log-in"></span> Enter protected session</button>`).on("click", protectedSessionService.enterProtectedSession);

        $renderedContent.append($("<div>").append("<div>This note is protected and to access it you need to enter password.</div>").append("<br/>").append($button));
    } else if (type === "webView" && options.interactive && !options.tooltip && entity instanceof FNote && entity.hasLabel("webViewSrc")) {
        await renderWebView(entity, $renderedContent);
    } else if (type === "llmChat" && entity instanceof FNote) {
        await renderLlmChat(entity, $renderedContent, options);
    } else if (entity instanceof FNote || entity instanceof FAttachment) {
        const icon = entity instanceof FNote
            ? entity.getIcon()
            : attachmentIcon(entity.role, entity.mime);
        $renderedContent.addClass("no-preview");
        $renderedContent.append(
            $("<div>").append($("<span>").addClass(icon))
        );

        if (entity instanceof FNote && entity.type === "webView" && entity.hasLabel("webViewSrc")) {
            const $footer = $("<footer>")
                .addClass("webview-footer");
            const $openButton = $(`
                <button class="file-open btn btn-primary" type="button">
                    <span class="tn-icon bx bx-link-external"></span>
                    ${t("content_renderer.open_externally")}
                </button>
            `)
                .appendTo($footer)
                .on("click", () => {
                    const webViewSrc = entity.getLabelValue("webViewSrc");
                    if (webViewSrc) {
                        if (window.electronApi) {
                            window.electronApi.shell.openExternal(webViewSrc);
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
        $renderedContent.toggleClass("full-content-width", entity.isLabelTruthy("fullContentWidth"));
    }

    return {
        $renderedContent,
        type
    };
}

/**
 * The modules that render the content of a note type, which load only when a note of the type is
 * rendered. The app build reads the `import()` expressions of each entry to give the note type a
 * group of files in the share theme's manifest, `content:<key>`; the editors of an embed are kept
 * under keys of their own, which a read-only page never loads.
 */
const CONTENT_RENDERERS = {
    markdown: () => import("@triliumnext/commons/src/lib/markdown_renderer"),
    iconPack: () => import("../widgets/type_widgets/icon_pack/IconPackPreview"),
    image: () => import("../widgets/react/ImageViewer"),
    file: {
        canvasDrawing: () => import("../widgets/type_widgets/canvas/CanvasDrawing"),
        pdf: () => import("../widgets/type_widgets/file/PdfViewer"),
        media: () => import("../widgets/type_widgets/file/MediaPreview")
    },
    mermaid: () => import("mermaid"),
    render: () => import("./render.js"),
    webView: () => import("../widgets/type_widgets/WebView"),
    llmChat: () => import("../widgets/type_widgets/llm_chat/ChatPreview"),
    editableText: () => import("../widgets/type_widgets/text/TextEmbed"),
    editableCode: () => import("../widgets/type_widgets/code/CodeEmbed")
};

/**
 * Renders a text note, or the blocks of it that `options.block` points at, which `TextEmbed`
 * edits in place while the Editable toggle of its embed is on. Blocks that cannot be edited apart
 * from the rest of the note stay read-only.
 */
async function renderEditableText(
    note: FNote,
    $renderedContent: JQuery<HTMLElement>,
    options: RenderOptions
) {
    const renderPreview = async (content: string, block = options.block) => {
        const $preview = $("<div>");
        await renderTextContent(note, content, $preview, { ...options, block });
        return $preview[0];
    };
    const [ blob, { default: TextEmbed } ] = await Promise.all([
        note.getBlob(),
        CONTENT_RENDERERS.editableText()
    ]);
    const content = blob?.content ?? "";
    const preview = await renderPreview(content);
    const canEditBlocks = !options.block || isEditableBlockRange(content, options.block);

    const $container = $('<div class="text-embed">');
    const container = $container.get(0);
    if (container) {
        await mountInteractiveWidget(h(TextEmbed, {
            note,
            editor: canEditBlocks ? getContentEditor(note, options) : undefined,
            content,
            block: options.block,
            preview,
            renderPreview,
            onBlockChange: options.onBlockChange
        }), container);
    }
    $renderedContent.append($container);
}

function isEditableBlockRange(content: string, block: string) {
    const root = new DOMParser().parseFromString(content, "text/html").body;
    return !!getEditableBlockRun(root, block);
}

/**
 * Renders a markdown note by converting its source to CKEditor-compatible HTML,
 * then running the same post-render pipeline as text notes (embedded notes,
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

    const { renderToHtml } = await CONTENT_RENDERERS.markdown();
    const html = renderToHtml(source, note.title, {
        sanitize: (dirty) => DOMPurify.sanitize(dirty),
        wikiLink: { formatHref: (id) => `#root/${id}` }
    });
    $renderedContent.append($('<div class="ck-content">').html(html));
    await postProcessRichContent(note, $renderedContent, options);
}

/**
 * Renders an icon pack as its glyph grid (the same isolated-frame preview used by the editor),
 * mounted like the PDF viewer. Its own module keeps the editor stack (SplitEditor/CodeMirror) out
 * of this path. Falls back to the children list for an empty manifest.
 */
async function renderIconPack(note: FNote, $renderedContent: JQuery<HTMLElement>, options: RenderOptions) {
    const blob = await note.getBlob();
    const content = blob?.content ?? "";

    if (!content.trim()) {
        if (!options.noChildrenList) {
            await renderChildrenList($renderedContent, note, options.includeArchivedNotes ?? false);
        }
        return;
    }

    const { IconPackPreview } = await CONTENT_RENDERERS.iconPack();
    const $container = $('<div class="icon-pack-rendered">');
    const container = $container.get(0);
    if (container) {
        render(h(IconPackPreview, { note, content, interactive: false }), container);
        // Mark the standalone Preact root so disposeInteractiveContent() can unmount the frame/effects.
        container.setAttribute(INTERACTIVE_MOUNT_ATTR, "");
    }
    $renderedContent.append($container);
}

/**
 * Renders a code note or file, by displaying its content and applying syntax highlighting based on
 * the selected MIME type. Interactive content that an editor can save mounts `CodeEmbed`, which
 * edits the content with CodeMirror while the Editable toggle of its embed is on.
 */
async function renderCode(
    entity: FNote | FAttachment,
    $renderedContent: JQuery<HTMLElement>,
    options: RenderOptions
) {
    const editor = options.interactive ? getContentEditor(entity, options) : undefined;
    const content = editor?.getUnsavedContent() ?? (await entity.getBlob())?.content ?? "";
    const mime = getCodeMime(entity);
    const preview = await renderCodePreview(content, mime);

    if (!editor) {
        $renderedContent.append(preview);
        return;
    }

    const { default: CodeEmbed } = await CONTENT_RENDERERS.editableCode();
    const $container = $('<div class="code-embed">');
    const container = $container.get(0);
    if (container) {
        await mountInteractiveWidget(
            h(CodeEmbed, { entity, editor, content, mime, preview }),
            container
        );
    }
    $renderedContent.append($container);
}

/** The highlighted content of a code note or file, with JSON indented. */
export async function renderCodePreview(content: string, mime: string) {
    if (mime === "application/json") {
        try {
            content = JSON.stringify(JSON.parse(content), null, 4);
        } catch (e) {
            // Ignore JSON parsing errors.
        }
    }

    const $codeBlock = $("<code>");
    $codeBlock.text(content);
    const $pre = $("<pre>").append($codeBlock);
    await applySingleBlockSyntaxHighlight($codeBlock, normalizeMimeTypeForCKEditor(mime));
    return $pre[0];
}

/**
 * The MIME type that highlights the code of `entity`. An attachment keeps the type the browser
 * uploaded it with, often a generic one such as `text/plain`, so its file name decides first.
 */
function getCodeMime(entity: FNote | FAttachment) {
    return entity instanceof FAttachment
        ? getMimeTypeFromFileName(entity.title) ?? entity.mime
        : entity.mime;
}

/** Saves the changes that rendered content makes to one note or attachment. */
export interface ContentEditor {
    /** Whether the rendered content can change the note or attachment. */
    canEdit(): boolean;
    getUnsavedContent(): string | undefined;
    scheduleSave(getContent: () => string): void;
    release(): void;
    /**
     * How the saving goes, for content that saves on its own rather than with the note that shows
     * it, or `undefined`.
     */
    getSaveState?(): SaveState | undefined;
    /** Calls `listener` when `getSaveState()` changes, until the returned call. */
    subscribeSaveState?(listener: () => void): () => void;
}

/** `editor`, saving the changes to `attachment`. */
export function bindAttachmentEditor(
    editor: AttachmentEditor,
    attachment: FAttachment
): ContentEditor {
    return {
        canEdit: () => editor.canEdit(attachment),
        getUnsavedContent: () => editor.getUnsavedContent(attachment.attachmentId),
        scheduleSave: (getContent) => editor.scheduleSave(attachment, getContent),
        release: () => editor.release(attachment.attachmentId)
    };
}

/** The editor of `options` that saves the changes to `entity`, or `undefined`. */
function getContentEditor(
    entity: FNote | FAttachment,
    options: RenderOptions
): ContentEditor | undefined {
    if (entity instanceof FAttachment) {
        return options.attachmentEditor && bindAttachmentEditor(options.attachmentEditor, entity);
    }

    const editor = options.noteEditor;
    return editor && EDITABLE_NOTE_TYPES.has(entity.type) ? {
        canEdit: () => editor.canEdit(entity),
        getUnsavedContent: () => editor.getUnsavedContent(entity.noteId),
        scheduleSave: (getContent) => editor.scheduleSave(entity, getContent),
        release: () => editor.release(entity.noteId),
        getSaveState: () => editor.getSaveState(entity.noteId),
        subscribeSaveState: (listener) => editor.subscribeSaveState(listener)
    } : undefined;
}

async function renderImage(entity: FNote | FAttachment, $renderedContent: JQuery<HTMLElement>, options: RenderOptions = {}) {
    $renderedContent // styles needed for the zoom to work well
        .css("display", "flex")
        .css("align-items", "center")
        .css("justify-content", "center")
        .css("flex-direction", "column");   // OCR text is displayed below the image.

    const $img = $("<img>")
        .attr("src", getImageUrl(entity))
        .attr("id", `attachment-image-${idCounter++}`)
        .css("max-width", "100%");

    $renderedContent.append($img);

    imageContextMenuService.setupContextMenu($img);

    if (entity instanceof FNote && options.showTextRepresentation) {
        await addOCRTextIfAvailable(entity, $renderedContent);
    }
}

/**
 * Mounts the zoom/pan {@link ImageViewer} for an image note or attachment. As with the media
 * player, the embedding caller must tear it down via {@link disposeInteractiveContent}.
 */
async function renderImageViewer(
    entity: FNote | FAttachment,
    $renderedContent: JQuery<HTMLElement>
) {
    const ImageViewer = (await CONTENT_RENDERERS.image()).default;
    const $container = $('<div class="rendered-image-viewer">');
    const container = $container.get(0);
    if (container) {
        await mountInteractiveWidget(h(ImageViewer, {
            src: getImageUrl(entity),
            alt: entity.title,
            environment: "embedded"
        }), container);
        // The viewer's <img> takes no pointer events, so the menu goes on its container.
        imageContextMenuService.setupContextMenu($container);
    }
    $renderedContent.append($container);
}

/**
 * Renders a canvas drawing kept in a file or an attachment. Interactive content of an attachment
 * mounts the Excalidraw editor; anything else shows a picture of the drawing.
 */
async function renderCanvasDrawing(
    entity: FNote | FAttachment,
    $renderedContent: JQuery<HTMLElement>,
    options: RenderOptions
) {
    const { default: CanvasDrawing, renderCanvasDrawingPicture } =
        await CONTENT_RENDERERS.file.canvasDrawing();

    if (options.interactive && entity instanceof FAttachment) {
        const $container = $('<div class="canvas-drawing">');
        const container = $container.get(0);
        if (container) {
            await mountInteractiveWidget(h(CanvasDrawing, {
                attachment: entity,
                editor: getContentEditor(entity, options)
            }), container);
        }
        $renderedContent.append($container);
        return;
    }

    const picture = await renderCanvasDrawingPicture(entity);
    if (picture) {
        $renderedContent.append(picture);
    } else {
        $renderedContent.addClass("no-preview");
        const $icon = $("<span>").addClass(attachmentIcon("file", entity.mime));
        $renderedContent.append($("<div>").append($icon));
    }
}

function getImageUrl(entity: FNote | FAttachment) {
    if (entity instanceof FNote) {
        return getNoteImageUrl(entity.noteId, entity.title, String(Math.random()));
    } else if (entity instanceof FAttachment) {
        const { attachmentId, title, utcDateModified } = entity;
        return getAttachmentImageUrl(attachmentId, title, utcDateModified);
    }
    return "";
}

async function addOCRTextIfAvailable(note: FNote, $content: JQuery<HTMLElement>) {
    try {
        const data = await server.get<TextRepresentationResponse>(`ocr/notes/${note.noteId}/text`);
        if (data.success && data.hasOcr && data.text) {
            const $ocrSection = $(`
                <div class="ocr-text-section">
                    <div class="ocr-header">
                        <span class="tn-icon bx bx-text"></span> ${t("ocr.extracted_text")}
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
    const { entityType, entityId } = getEntityTypeAndId(entity);

    const $content = $('<div style="display: flex; flex-direction: column; height: 100%; justify-content: end;">');
    // An embedded player has no room for a footer below it, so it carries Download / Open in its own controls
    // instead (see showsFileActions) — and this footer stands down.
    let mediaOwnsFileActions = false;

    if (type === "pdf") {
        const $viewer = $(`<div style="height: 100%">`);
        const { default: PdfViewer, getPdfUrl } = await CONTENT_RENDERERS.file.pdf();
        const url = getPdfUrl(`${entityType}/${entityId}/open`);
        render(h(PdfViewer, {pdfUrl: url, editable: false, toolbar: options.pdfToolbar ?? false}), $viewer.get(0)!);

        $content.append($viewer);


    } else if (type === "audio" || type === "video") {
        const environment = options.mediaEnvironment ?? "preview";

        if (environment === "native") {
            const $nativePreview = $(type === "audio" ? "<audio controls></audio>" : "<video controls></video>")
                .attr("src", openService.getUrlForDownload(`api/${entityType}/${entityId}/open-partial`))
                .attr("type", entity.mime)
                .css("width", "100%");

            $content.append($nativePreview);
        } else {
            mediaOwnsFileActions = showsFileActions(environment);
            await renderMedia(entity, environment, $content);
        }
    }

    if (entity instanceof FNote && options.showTextRepresentation) {
        await addOCRTextIfAvailable(entity, $content);
    }

    if (!mediaOwnsFileActions) {
        appendNoteFileActions($content, entity);
    }

    $renderedContent.append($content);
}

/**
 * Renders an inline preview of an office document (DOCX/XLSX/PPTX, ODT/ODS/ODP, RTF and
 * EPUB) by fetching the server-rendered HTML preview and sanitizing it. On failure it
 * falls back to a notice plus the usual download/open actions, so the file is never left
 * unreachable. `options.trim` asks for the corner of a workbook rather than all of it.
 */
async function renderOffice(entity: FNote | FAttachment, $renderedContent: JQuery<HTMLElement>, options: RenderOptions) {
    const { entityType, entityId } = getEntityTypeAndId(entity);

    // The scroll host is a separate, unpadded element (like the note view's .scrolling-container)
    // so the body's padding scrolls with the document instead of sitting on the scroller itself.
    const $content = $('<div class="office-preview">');
    const $scroll = $('<div class="office-preview-scroll">');
    const $body = $('<div class="ck-content office-preview-body">');
    $body.append($('<div class="office-preview-loading">').append($('<span class="bx bx-loader bx-spin">')).append(document.createTextNode(t("content_renderer.office_rendering"))));
    $scroll.append($body);
    $content.append($scroll);
    $renderedContent.append($content);

    try {
        // A note list asks for a trimmed render: a card shows a few rows, and a workbook that
        // fills one runs to megabytes the browser would parse and lay out to display none of.
        const { css, html } = await renderOfficeToHtml(entityType, entityId, { trim: options.trim });
        $body.html(html);
        if (css) {
            // Built as an element with its text set, never parsed as markup, so a cell's styling
            // cannot escape the rule it belongs to. It sits inside the preview body, so the
            // browser drops it along with the rest when this note is closed.
            $body.prepend($("<style>").text(css));
        }
    } catch (e) {
        console.warn("Failed to render office document preview:", getErrorMessage(e));
        $scroll.remove();
        $content.prepend($("<div>").addClass("admonition caution").text(t("content_renderer.office_render_error")));
    }

    appendNoteFileActions($content, entity);
}

/**
 * Appends the download / open-externally action buttons for a file note. These are
 * note-only for now — attachment "open externally" support isn't wired up (see the TODO
 * that used to live inline in renderFile).
 */
function appendNoteFileActions($content: JQuery<HTMLElement>, entity: FNote | FAttachment) {
    if (!(entity instanceof FNote)) {
        return;
    }

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

function getEntityTypeAndId(entity: FNote | FAttachment): { entityType: "notes" | "attachments"; entityId: string } {
    if (entity instanceof FNote) {
        return { entityType: "notes", entityId: entity.noteId };
    } else if (entity instanceof FAttachment) {
        return { entityType: "attachments", entityId: entity.attachmentId };
    } else {
        throw new Error(`Can't recognize entity type of '${entity}'`);
    }
}

/**
 * Mounts the Trilium media player for an audio/video note or attachment. In a `preview` it starts as a
 * placeholder and only loads the media once the user presses play (see {@link MediaPreview}); an `embedded`
 * one loads straight away. Like every other mounted widget here, the embedding caller must tear it down via
 * {@link disposeInteractiveContent} — otherwise the Preact root leaks and its media keeps playing.
 */
async function renderMedia(entity: FNote | FAttachment, environment: MediaEnvironment, $content: JQuery<HTMLElement>) {
    const MediaPreview = (await CONTENT_RENDERERS.file.media()).default;
    const $container = $('<div class="rendered-media">');
    const container = $container.get(0);
    if (container) {
        await mountInteractiveWidget(h(MediaPreview, { entity, environment }), container);
    }
    $content.append($container);
}

async function renderMermaid(note: FNote | FAttachment, $renderedContent: JQuery<HTMLElement>) {
    const mermaid = (await CONTENT_RENDERERS.mermaid()).default;

    const blob = await note.getBlob();
    const content = blob?.content || "";

    $renderedContent.css("display", "flex").css("justify-content", "space-around");

    mermaid.mermaidAPI.initialize({ ...getMermaidConfig(), startOnLoad: false });

    try {
        const { svg } = await mermaid.mermaidAPI.render(`in-mermaid-graph-${idCounter++}`, content);

        $renderedContent.append($(postprocessMermaidSvg(svg)));
    } catch (e) {
        const $error = $("<p>The diagram could not displayed.</p>");

        $renderedContent.append($error);
    }
}

/**
 * Mounts the live {@link WebView} type widget — an Electron `<webview>` or a sandboxed `<iframe>` —
 * into the rendered content. Used by interactive contexts (e.g. the dashboard) that opt in via
 * {@link RenderOptions.interactive}; every other context keeps the static "open externally" fallback.
 * Loaded lazily so the widget (and its dependencies) are only pulled in when a web view is embedded.
 */
async function renderWebView(note: FNote, $renderedContent: JQuery<HTMLElement>) {
    const WebView = (await CONTENT_RENDERERS.webView()).default;
    const $container = $('<div class="note-detail-web-view">');
    const container = $container.get(0);
    if (container) {
        await mountInteractiveWidget(h(WebView, {
            note,
            ntxId: undefined,
            viewScope: undefined,
            parentComponent: undefined,
            noteContext: undefined
        }), container);
    }
    $renderedContent.append($container);
}

/**
 * How many messages a tooltip previews. A hover shows a ~300px-tall scroll box, so rendering the
 * whole of a long conversation would parse hundreds of markdown bodies nobody will ever scroll to.
 */
const TOOLTIP_MAX_MESSAGES = 10;

/**
 * Renders a saved AI chat conversation as a read-only preview: the stored messages painted with the
 * same {@link ChatMessage} components as the live timeline, but with no input bar, context menu, or
 * read-only notice — just the conversation. Mounted as a disposable Preact root (ChatMessage carries
 * effects), so the embedding caller must tear it down via {@link disposeInteractiveContent} — the
 * collection tiles that show these previews already do. Loaded lazily so the chat widget code is only
 * pulled in when a chat note is previewed.
 *
 * A tooltip keeps only the serialized HTML of the content and never disposes it, so it would leak a
 * root per hover. It gets the same preview, snapshotted: mount it, let its async passes settle, take
 * the markup, unmount. The tooltip has no use for the interactivity it drops.
 */
async function renderLlmChat(note: FNote, $renderedContent: JQuery<HTMLElement>, options: RenderOptions) {
    const blob = await note.getBlob();
    const source = blob?.content ?? "";

    let messages: StoredMessage[] = [];
    if (source.trim()) {
        try {
            const parsed = JSON.parse(source);
            // JSON.parse("null") (or any non-object) must not throw on `.messages`.
            if (parsed && typeof parsed === "object") {
                messages = (parsed as LlmChatContent).messages ?? [];
            }
        } catch {
            // Malformed content → empty preview rather than throwing.
        }
    }
    if (messages.length === 0) return;

    const ChatPreview = (await CONTENT_RENDERERS.llmChat()).default;
    const $container = $('<div class="note-detail-llm-chat-preview">');
    const container = $container.get(0);
    if (!container) return;

    if (options.tooltip) {
        messages = messages.slice(0, TOOLTIP_MAX_MESSAGES);
    }

    await mountInteractiveWidget(h(ChatPreview, { messages }), container);

    if (options.tooltip) {
        // The chat's markdown renders through the read-only text pipeline, whose passes (mermaid,
        // math, syntax highlighting) land after the mount — snapshotting before they settle would
        // freeze half-rendered content into the tooltip. Scoped to this preview, so a hover never
        // waits on a note rendering in another pane.
        await waitForPendingRenders(container);

        const html = container.innerHTML;
        render(null, container);
        container.removeAttribute(INTERACTIVE_MOUNT_ATTR);
        container.innerHTML = html;
    }

    $renderedContent.append($container);
}

/** Marks a standalone Preact root mounted by {@link mountInteractiveWidget} so it can be unmounted. */
const INTERACTIVE_MOUNT_ATTR = "data-interactive-mount";

/**
 * Mounts an interactive embedded widget (web view, collection) through the Trilium event bridge.
 * Wrapping it in a {@link ParentComponent} provider connected to {@link appContext} is what lets its
 * `useTriliumEvent` subscriptions actually receive events — a bare standalone Preact root has no
 * parent component in context, so otherwise e.g. an embedded collection never reacts to new notes.
 */
export async function mountInteractiveWidget(vnode: JSX.Element, container: HTMLElement) {
    const [ { renderReactWidgetAtElement }, { default: appContext } ] = await Promise.all([
        import("../widgets/react/react_utils"),
        import("../components/app_context")
    ]);
    renderReactWidgetAtElement(appContext, vnode, container);
    // Mark the standalone Preact root so disposeInteractiveContent() can later unmount it.
    container.setAttribute(INTERACTIVE_MOUNT_ATTR, "");

    // The global [data-trigger-command] click delegate resolves its handler via
    // closest(".component").prop("component"). A standalone mount has no legacy widget setting that
    // prop (ReactWrappedWidget does it in the note detail), so point the rendered ".component"
    // element(s) at appContext — an unhandled command there is converted into an event, reaching the
    // widget's own useTriliumEvent subscription. Without it an embedded command button (e.g. the geo
    // map "Add marker") throws "component is undefined".
    for (const el of container.querySelectorAll<HTMLElement>(".component")) {
        if (!$(el).prop("component")) {
            $(el).prop("component", appContext);
        }
    }
}

/**
 * Unmounts any interactive widgets (web views, collections) that {@link getRenderedContent} mounted
 * into the given content, running their cleanup — `useTriliumEvent` unsubscribe, Bootstrap dropdown
 * disposal, map teardown. A caller embedding interactive content must call this when it replaces or
 * discards that content, otherwise the standalone Preact roots leak. Safe (no-op) for content with no
 * interactive widgets.
 */
export function disposeInteractiveContent($renderedContent: JQuery<HTMLElement>) {
    for (const el of $renderedContent.find(`[${INTERACTIVE_MOUNT_ATTR}]`).toArray()) {
        render(null, el);
    }
}

/**
 * Mounts a collection — a book or a saved search — as the live {@link EmbeddedNoteList}, the same
 * results widget used in the note detail (grid/list/table/board/calendar/map/presentation). Used by
 * interactive contexts (e.g. the dashboard and embedded notes) that opt in via
 * {@link RenderOptions.interactive}; every other context keeps the static fallback. Loaded lazily so
 * the collection views (and their dependencies) are only pulled in when a collection is embedded.
 */
async function renderCollection(note: FNote, $renderedContent: JQuery<HTMLElement>) {
    const [ { EmbeddedNoteList }, { default: froca } ] = await Promise.all([
        import("../widgets/collections/NoteList"),
        import("./froca.js")
    ]);

    // A saved search must run server-side before its (virtual) result children exist; a book already
    // has real children, so it skips execution.
    if (note.type === "search") {
        await froca.loadSearchNote(note.noteId);
    }

    const $container = $('<div class="rendered-collection">');
    const container = $container.get(0);
    if (container) {
        await mountInteractiveWidget(h(EmbeddedNoteList, {
            note,
            notePath: note.getBestNotePathString(),
            ntxId: undefined,
            media: "screen",
            highlightedTokens: note.highlightedTokenInfos ?? note.highlightedTokens,
            // Search results get text-representation (highlighted snippets); books don't.
            showTextRepresentation: note.type === "search"
        }), container);
    }
    $renderedContent.append($container);
}

/**
 * Replaces the failed render note's content with the shared error card. The card is imported
 * lazily: this module is loaded early (via the app-context graph), and an eager import of
 * `RenderErrorCard` drags in the react widget tree (`Admonition` → `Collapsible` → `hooks`),
 * which circles back into `basic_widget` before it finishes initializing.
 */
async function showRenderError($content: JQuery<HTMLElement>, error: unknown, noteId?: string) {
    const { default: RenderErrorCard } = await import("../widgets/react/RenderErrorCard.js");
    const container = $content.empty().get(0);
    if (container) {
        render(h(RenderErrorCard, { error, noteId }), container);
    }
}

/**
 * The box size a new embed of `entity` starts with: `tiny` when the embed shows no preview of
 * it, `small` for audio, `full` for code and `medium` for the rest.
 */
export function getEmbedBoxSize(entity: FNote | FAttachment): BoxSize {
    return getBoxSize(getContentType(entity), hasRenderedPreview(entity));
}

/**
 * Whether an interactive `getRenderedContent()` shows a preview of `entity`, rather than an icon
 * or the actions of a file.
 */
export function hasRenderedPreview(entity: FNote | FAttachment) {
    const type = getContentType(entity);
    return type === "webView"
        ? entity instanceof FNote && entity.hasLabel("webViewSrc")
        : PREVIEWED_TYPES.has(type);
}

/** The box size of a new embed of a file being uploaded, from the attachment it becomes. */
export function getUploadBoxSize(mime: string, size?: number): BoxSize {
    const type = isAcceptedImageMime(mime) ? "image" : getAttachedFileContentType(mime, size);
    return getBoxSize(type, PREVIEWED_TYPES.has(type));
}

function getBoxSize(type: string, hasPreview: boolean): BoxSize {
    if (!hasPreview) return "tiny";
    if (type === "audio") return "small";
    if (type === "code") return "full";
    return "medium";
}

function getRenderingType(entity: FNote | FAttachment) {
    const type = getContentType(entity);
    if (!entity.isProtected) {
        return type;
    }

    if (protectedSessionHolder.isProtectedSessionAvailable()) {
        protectedSessionHolder.touchProtectedSession();
        return type;
    }
    return "protectedSession";
}

/** The kind of content `entity` holds, from its note type or attachment role and its media type. */
function getContentType(entity: FNote | FAttachment) {
    if (entity instanceof FNote && entity.isIconPack()) {
        // Icon packs (JSON `code`/`file` notes with #iconPack) render as their glyph grid, not as raw JSON.
        return "iconPack";
    }
    if (entity instanceof FNote && entity.isMarkdown()) {
        return "markdown";
    }
    if ("type" in entity) {
        return getFileContentType(entity.type, entity.mime);
    }
    if (!("role" in entity)) {
        return "";
    }

    // "importSource" attachments (e.g. the OneNote debug source HTML/InkML) are plain files kept
    // for reference; render them exactly like a "file" role.
    if (entity.role === "importSource") {
        return getAttachedFileContentType(entity.mime, entity.contentLength);
    }
    // A link preview's "favicon" is a picture like any other as far as showing it goes; the
    // role only says where it came from. Without this it would fall through to the unknown
    // type and list as a file with no preview.
    if (isImageAttachmentRole(entity.role)) {
        return "image";
    }
    return entity.role === "file"
        ? getAttachedFileContentType(entity.mime, entity.contentLength)
        : getFileContentType(entity.role, entity.mime);
}

/**
 * The kind of file an attachment holds, which is code for text and the code media types up to
 * `MAX_ATTACHED_CODE_SIZE`.
 */
function getAttachedFileContentType(mime: string, size = 0) {
    const type = getFileContentType("file", mime);
    const isCode = type === "code"
        || (type === "file" && (mime.startsWith("text/") || ATTACHED_CODE_MIME_TYPES.has(mime)));
    if (!isCode) return type;
    return size <= MAX_ATTACHED_CODE_SIZE ? "code" : "file";
}

/** Narrows a file, or a `viewConfig` attachment, to the kind of file its media type names. */
function getFileContentType(type: string, mime: string) {
    if (type === "file" && mime === "application/pdf") return "pdf";
    if (type === "file" && mime === CANVAS_ATTACHMENT_MIME) return "canvasDrawing";
    if ((type === "file" || type === "viewConfig") && CODE_MIME_TYPES.has(mime)) return "code";
    if (type === "file" && mime.startsWith("audio/")) return "audio";
    if (type === "file" && mime.startsWith("video/")) return "video";
    if (type === "file" && isOfficeMimeType(mime)) return "office";
    return type;
}

export default {
    getRenderedContent,
    disposeInteractiveContent,
    mountInteractiveWidget
};
