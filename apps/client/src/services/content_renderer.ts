import "./content_renderer.css";

import { normalizeMimeTypeForCKEditor, type TextRepresentationResponse } from "@triliumnext/commons";
import DOMPurify from "dompurify";
import { h, type JSX, render } from "preact";

import FAttachment from "../entities/fattachment.js";
import FNote from "../entities/fnote.js";
import imageContextMenuService from "../menus/image_context_menu.js";
import { t } from "../services/i18n.js";
import { type MediaEnvironment, showsFileActions } from "../widgets/type_widgets/file/media_environment.js";
import type { LlmChatContent, StoredMessage } from "../widgets/type_widgets/llm_chat/llm_chat_types.js";
import renderText, { postProcessRichContent, renderChildrenList } from "./content_renderer_text.js";
import renderDoc from "./doc_renderer.js";
import { loadElkIfNeeded, postprocessMermaidSvg } from "./mermaid.js";
import openService from "./open.js";
import { waitForPendingRenders } from "./pending_renders.js";
import protectedSessionService from "./protected_session.js";
import protectedSessionHolder from "./protected_session_holder.js";
import renderService from "./render.js";
import server from "./server.js";
import { applySingleBlockSyntaxHighlight } from "./syntax_highlight.js";
import { getErrorMessage } from "./utils.js";

let idCounter = 1;

export interface RenderOptions {
    tooltip?: boolean;
    trim?: boolean;
    /** If enabled, it will prevent the default behavior in which an empty note would display a list of children. */
    noChildrenList?: boolean;
    /** If enabled, it will prevent rendering of included notes. */
    noIncludedNotes?: boolean;
    /**
     * Keep expanding include-note sections recursively at every depth. Used for printing/export,
     * which preserves full nesting. When false (the default for on-screen display), only the first
     * level of inclusion is rendered and deeper include-note sections are replaced with a reference
     * link (see {@link includesAsReferenceLinks}).
     */
    expandNestedIncludes?: boolean;
    /**
     * Internal: render this note's own include-note sections as reference links instead of expanding
     * them. Set when rendering a note that is itself already an included note in display mode, so that
     * inclusion stops after the first level.
     */
    includesAsReferenceLinks?: boolean;
    /** If enabled, it will include archived notes when rendering children list. */
    includeArchivedNotes?: boolean;
    /** Set of note IDs that have already been seen during rendering to prevent infinite recursion. */
    seenNoteIds?: Set<string>;
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
     * mounts the full player straight away. `native` emits a plain `<audio>`/`<video>` element instead of
     * the player, for the callers that serialize the rendered content into an HTML string or into a separate
     * document (presentation, printing) — a mounted player would be dead markup there.
     */
    mediaEnvironment?: "preview" | "embedded" | "native";
    /**
     * If enabled, PDFs render with the pdf.js toolbar (zoom, page navigation, print, download).
     * Off by default so that lightweight previews (attachment list, tooltips, embeds) stay bare;
     * the attachment full-detail view opts in. The viewer remains read-only either way.
     */
    pdfToolbar?: boolean;
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

    if ((type === "book" || type === "search") && options.interactive && !options.tooltip
        && entity instanceof FNote && entity.getLabelValue("viewType") !== "dashboard") {
        // Render the live collection view (grid/table/board/calendar/map/presentation). The dashboard
        // view type is excluded: it's the only view that re-propagates `interactive` to its tiles, so
        // skipping it here is what keeps an embedded collection from recursing into itself.
        await renderCollection(entity, $renderedContent);
    } else if (type === "text" || type === "book") {
        await renderText(entity, $renderedContent, options);
    } else if (type === "markdown") {
        await renderMarkdown(entity, $renderedContent, options);
    } else if (type === "code") {
        await renderCode(entity, $renderedContent);
    } else if (type === "iconPack" && !options.tooltip && entity instanceof FNote) {
        await renderIconPack(entity, $renderedContent, options);
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
        const $button = $(`<button class="btn btn-sm"><span class="tn-icon bx bx-log-in"></span> Enter protected session</button>`).on("click", protectedSessionService.enterProtectedSession);

        $renderedContent.append($("<div>").append("<div>This note is protected and to access it you need to enter password.</div>").append("<br/>").append($button));
    } else if (type === "webView" && options.interactive && !options.tooltip && entity instanceof FNote && entity.hasLabel("webViewSrc")) {
        await renderWebView(entity, $renderedContent);
    } else if (type === "llmChat" && entity instanceof FNote) {
        await renderLlmChat(entity, $renderedContent, options);
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

    // The markdown renderer pulls in marked, so it is only loaded when a markdown note is rendered.
    const { renderToHtml } = await import("@triliumnext/commons/src/lib/markdown_renderer");
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

    const { IconPackPreview } = await import("../widgets/type_widgets/icon_pack/IconPackPreview");
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
    // An embedded player has no room for a footer below it, so it carries Download / Open in its own controls
    // instead (see showsFileActions) — and this footer stands down.
    let mediaOwnsFileActions = false;

    if (type === "pdf") {
        const url = `../../api/${entityType}/${entityId}/open`;
        const $viewer = $(`<div style="height: 100%">`);
        const PdfViewer = (await import("../widgets/type_widgets/file/PdfViewer")).default;
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

    if (entityType === "notes" && "noteId" in entity && !mediaOwnsFileActions) {
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

/**
 * Mounts the Trilium media player for an audio/video note or attachment. In a `preview` it starts as a
 * placeholder and only loads the media once the user presses play (see {@link MediaPreview}); an `embedded`
 * one loads straight away. Like every other mounted widget here, the embedding caller must tear it down via
 * {@link disposeInteractiveContent} — otherwise the Preact root leaks and its media keeps playing.
 */
async function renderMedia(entity: FNote | FAttachment, environment: MediaEnvironment, $content: JQuery<HTMLElement>) {
    const MediaPreview = (await import("../widgets/type_widgets/file/MediaPreview")).default;
    const $container = $('<div class="rendered-media">');
    const container = $container.get(0);
    if (container) {
        await mountInteractiveWidget(h(MediaPreview, { entity, environment }), container);
    }
    $content.append($container);
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

/**
 * Mounts the live {@link WebView} type widget — an Electron `<webview>` or a sandboxed `<iframe>` —
 * into the rendered content. Used by interactive contexts (e.g. the dashboard) that opt in via
 * {@link RenderOptions.interactive}; every other context keeps the static "open externally" fallback.
 * Loaded lazily so the widget (and its dependencies) are only pulled in when a web view is embedded.
 */
async function renderWebView(note: FNote, $renderedContent: JQuery<HTMLElement>) {
    const WebView = (await import("../widgets/type_widgets/WebView")).default;
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

    const ChatPreview = (await import("../widgets/type_widgets/llm_chat/ChatPreview")).default;
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
async function mountInteractiveWidget(vnode: JSX.Element, container: HTMLElement) {
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
 * interactive contexts (e.g. the dashboard and included notes) that opt in via
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
            highlightedTokens: note.highlightedTokens,
            // Search results get text-representation (highlighted snippets); books don't.
            showTextRepresentation: note.type === "search"
        }), container);
    }
    $renderedContent.append($container);
}

function getRenderingType(entity: FNote | FAttachment) {
    let type: string = "";
    if ("type" in entity) {
        type = entity.type;
    } else if ("role" in entity) {
        type = entity.role;
        // "importSource" attachments (e.g. the OneNote debug source HTML/InkML) are plain files kept
        // for reference; render them exactly like a "file" role.
        if (type === "importSource") {
            type = "file";
        }
    }

    const mime = "mime" in entity && entity.mime;
    const isIconPack = entity instanceof FNote && entity.isIconPack();

    if (isIconPack) {
        // Icon packs (JSON `code`/`file` notes with #iconPack) render as their glyph grid, not as raw JSON.
        type = "iconPack";
    } else if (type === "file" && mime === "application/pdf") {
        type = "pdf";
    } else if (type === "code" && entity instanceof FNote && entity.isMarkdown()) {
        type = "markdown";
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
    getRenderedContent,
    disposeInteractiveContent
};
