import { attachmentIcon, CONTENT_RENDERER_GROUPS } from "@triliumnext/commons";
import { h, render, VNode } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock heavy / side-effecting collaborators BEFORE importing the SUT. ---
// content_renderer_text: renderText / postProcessRichContent / renderChildrenList
const renderText = vi.fn(async (...args: any[]) => {
    args[1].append($('<div class="from-render-text">'));
});
const renderTextContent = vi.fn(async (...args: any[]) => {
    args[2].append($('<div class="from-render-text-content">').attr("data-content", args[1]));
});
const postProcessRichContent = vi.fn(async (..._args: any[]) => {});
const renderChildrenList = vi.fn(async (..._args: any[]) => {});
vi.mock("./content_renderer_text.js", () => ({
    default: (...args: any[]) => renderText(...args),
    renderTextContent: (...args: any[]) => renderTextContent(...args),
    postProcessRichContent: (...args: any[]) => postProcessRichContent(...args),
    renderChildrenList: (...args: any[]) => renderChildrenList(...args)
}));

const renderDoc = vi.fn(async (..._args: any[]) => $('<div class="doc-html"><span>doc</span></div>'));
vi.mock("./doc_renderer.js", () => ({ default: (...args: any[]) => renderDoc(...args) }));

const renderServiceRender = vi.fn(async (...args: any[]) => {
    args[1].append($('<div class="render-ok">'));
});
vi.mock("./render.js", () => ({ default: { render: (...args: any[]) => renderServiceRender(...args) } }));

const renderCodeNotePreview = vi.fn(
    async (content: string, _mime: string, _note?: unknown, _lines?: unknown) => (
        $("<pre>").append($("<code>").text(content))[0]
    )
);
vi.mock("./code_note_preview.js", () => ({
    renderCodeNotePreview: (...args: [ string, string, unknown, unknown ]) =>
        renderCodeNotePreview(...args)
}));

const setupContextMenu = vi.fn((..._args: any[]) => {});
vi.mock("../menus/image_context_menu.js", () => ({ default: { setupContextMenu: (...a: any[]) => setupContextMenu(...a) } }));

const enterProtectedSession = vi.fn((..._args: any[]) => {});
vi.mock("./protected_session.js", () => ({ default: { enterProtectedSession: (...a: any[]) => enterProtectedSession(...a) } }));

const isProtectedSessionAvailable = vi.fn(() => false);
const touchProtectedSession = vi.fn((..._args: any[]) => {});
vi.mock("./protected_session_holder.js", () => ({
    default: {
        isProtectedSessionAvailable: () => isProtectedSessionAvailable(),
        touchProtectedSession: () => touchProtectedSession()
    }
}));

const getUrlForDownload = vi.fn((...args: any[]) => `DL:${args[0]}`);
const downloadFileNote = vi.fn((..._args: any[]) => {});
const openNoteExternally = vi.fn(async (..._args: any[]) => {});
vi.mock("./open.js", () => ({
    default: {
        getUrlForDownload: (...a: any[]) => getUrlForDownload(...a),
        downloadFileNote: (...a: any[]) => downloadFileNote(...a),
        openNoteExternally: (...a: any[]) => openNoteExternally(...a)
    }
}));

// isOfficeMimeType comes (unmocked) from @triliumnext/commons; only the server
// round-trip is stubbed out.
const renderOfficeToHtml = vi.fn(async (..._args: any[]) => ({ css: "", html: `<div class="office-doc">converted</div>` }));
vi.mock("./office_renderer.js", () => ({
    renderOfficeToHtml: (...a: any[]) => renderOfficeToHtml(...a)
}));

const mermaidRender = vi.fn(async (..._args: any[]) => ({ svg: "<g/>" }));
vi.mock("mermaid", () => ({
    default: {
        render: (...a: any[]) => mermaidRender(...a),
        mermaidAPI: { render: (...a: any[]) => mermaidRender(...a) }
    }
}));

const pdfViewerComponent = vi.fn((_props: any) => null);
// Only the component is stubbed: the URL the viewer is handed is the assertion below (#8877).
vi.mock("../widgets/type_widgets/file/PdfViewer", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../widgets/type_widgets/file/PdfViewer")>()),
    default: pdfViewerComponent
}));

const webViewComponent = vi.fn((_props: any): VNode<any> => h("span", { class: "mock-webview-marker" }));
vi.mock("../widgets/type_widgets/WebView", () => ({ default: webViewComponent }));

const mediaPreviewComponent = vi.fn((_props: any): VNode<any> => h("span", { class: "mock-media-marker" }));
vi.mock("../widgets/type_widgets/file/MediaPreview", () => ({ default: mediaPreviewComponent }));

const imageViewerComponent = vi.fn((_props: any): VNode<any> =>
    h("span", { class: "mock-image-viewer-marker" }));
vi.mock("../widgets/react/ImageViewer", () => ({ default: imageViewerComponent }));

const embeddedNoteListComponent = vi.fn((_props: any) => null);
vi.mock("../widgets/collections/NoteList", () => ({ EmbeddedNoteList: embeddedNoteListComponent }));

const iconPackPreviewComponent = vi.fn((_props: any) => null);
vi.mock("../widgets/type_widgets/icon_pack/IconPackPreview", () => ({ IconPackPreview: iconPackPreviewComponent }));

const canvasDrawingComponent = vi.fn((_props: any): VNode<any> =>
    h("span", { class: "mock-canvas-drawing-marker" }));
const renderCanvasDrawingPicture = vi.fn(async (_entity: unknown): Promise<Element | null> => null);
vi.mock("../widgets/type_widgets/canvas/CanvasDrawing", () => ({
    default: canvasDrawingComponent,
    renderCanvasDrawingPicture: (entity: unknown) => renderCanvasDrawingPicture(entity)
}));

const mermaidDiagramComponent = vi.fn((_props: any): VNode<any> =>
    h("span", { class: "mock-mermaid-diagram-marker" }));
vi.mock("../widgets/type_widgets/mermaid/MermaidDiagram", () => ({ default: mermaidDiagramComponent }));
const renderMermaidSvg = vi.fn(async (_source: string) => "<svg class=\"mock-mermaid-svg\"></svg>");
vi.mock("./mermaid", async (importOriginal) => ({
    ...await importOriginal<object>(),
    renderMermaidSvg: (source: string) => renderMermaidSvg(source)
}));

const chatPreviewComponent = vi.fn((props: any): VNode<any> =>
    h("span", { class: "mock-chat-marker" }, `messages:${props.messages.length}`));
vi.mock("../widgets/type_widgets/llm_chat/ChatPreview", () => ({ default: chatPreviewComponent }));

const codeEmbedComponent = vi.fn((_props: any): VNode<any> =>
    h("span", { class: "mock-code-embed-marker" }));
vi.mock("../widgets/type_widgets/code/CodeEmbed", () => ({
    default: codeEmbedComponent,
    useSavedContent: () => {}
}));

const textEmbedComponent = vi.fn((_props: any): VNode<any> =>
    h("span", { class: "mock-text-embed-marker" }));
vi.mock("../widgets/type_widgets/text/TextEmbed", () => ({ default: textEmbedComponent }));

const markdownEmbedComponent = vi.fn((_props: any): VNode<any> =>
    h("span", { class: "mock-markdown-embed-marker" }));
const renderMarkdownHtml = vi.fn((source: string) => (source ? `<p>${source}</p>` : ""));
vi.mock("../widgets/type_widgets/markdown/MarkdownEmbed", () => ({
    default: markdownEmbedComponent,
    renderMarkdownHtml: (source: string) => renderMarkdownHtml(source)
}));

// `addHook` is a no-op here: sanitize_content.ts registers a DOMPurify hook at
// module load (pulled in transitively), which would otherwise throw against this mock.
vi.mock("dompurify", () => ({ default: { sanitize: (s: string) => s, addHook: () => {} } }));

const renderToHtml = vi.fn((...args: any[]) => `<p>${args[0]}</p>`);
vi.mock("@triliumnext/commons/src/lib/markdown_renderer", async (orig) => ({
    ...(await (orig() as Promise<object>)),
    renderToHtml: (...a: any[]) => renderToHtml(...a)
}));

// --- Imports AFTER the mocks. ---
import appContext from "../components/app_context.js";
import Component from "../components/component.js";
import type { SaveState } from "../components/note_context.js";
import FAttachment from "../entities/fattachment.js";
import { buildNote } from "../test/easy-froca.js";
import { useLegacyImperativeHandlers } from "../widgets/react/hooks.js";
import EmbedHistories from "../widgets/type_widgets/text/embed_history.js";
import {
    addContentDisposer,
    CONTENT_RENDERERS,
    disposeInteractiveContent,
    getEmbedBoxSize,
    getRenderedContent as rawGetRenderedContent,
    getUploadBoxSize,
    hasRenderedPreview,
    snapshotAndDispose
} from "./content_renderer.js";
import froca from "./froca.js";
import server from "./server.js";

// getRenderedContent declares an explicit `this` parameter; bind it so callers don't need to.
const getRenderedContent = (...args: Parameters<typeof rawGetRenderedContent>) => rawGetRenderedContent.call({}, ...args);

function buildAttachment(row: Partial<ConstructorParameters<typeof FAttachment>[1]> = {}) {
    const att = new FAttachment(froca as any, {
        attachmentId: Math.random().toString(36).slice(2),
        ownerId: "owner",
        role: "image",
        mime: "image/png",
        title: "att",
        dateModified: new Date().toISOString(),
        utcDateModified: new Date().toISOString(),
        utcDateScheduledForErasureSince: "",
        contentLength: 0,
        ...row
    } as any);
    return att;
}

/** An AI chat note whose stored conversation is one user message per given text. */
function buildChatNote(texts: string[]) {
    const messages = texts.map((content, i) => ({
        id: `m${i}`,
        role: "user",
        content,
        createdAt: "2026-01-01T00:00:00.000Z"
    }));
    return buildNote({ title: "Chat", type: "llmChat", content: JSON.stringify({ version: 1, messages }) });
}

beforeEach(() => {
    vi.clearAllMocks();
    isProtectedSessionAvailable.mockReturnValue(false);
    (window as any).electronApi = undefined;
});

describe("CONTENT_RENDERERS", () => {
    /** The static export reads the groups from the table in commons, the build from this one. */
    it("has an entry for every group the static export names a renderer by", () => {
        const groups = new Set(Object.values(CONTENT_RENDERER_GROUPS));
        expect([ ...groups ].filter((group) => !Object.hasOwn(CONTENT_RENDERERS, group))).toEqual([]);
    });
});

describe("getEmbedBoxSize", () => {
    it("sizes an embed by what it previews: none, audio, code or anything else", () => {
        const protectedCode = buildNote({ title: "Secret", type: "code", mime: "text/javascript" });
        protectedCode.isProtected = true;

        expect([
            buildNote({ title: "Map", type: "relationMap" }),
            buildNote({ title: "Launcher", type: "launcher" }),
            buildNote({ title: "Blank page", type: "webView" }),
            buildNote({ title: "Archive", type: "file", mime: "application/zip" }),
            buildAttachment({ role: "file", mime: "application/zip" }),
            buildAttachment({ role: "canvasLibraryItem", mime: "application/json" })
        ].map(getEmbedBoxSize)).toEqual(Array(6).fill("tiny"));

        expect([
            buildNote({ title: "Song", type: "file", mime: "audio/mpeg" }),
            buildAttachment({ role: "file", mime: "audio/ogg" })
        ].map(getEmbedBoxSize)).toEqual([ "small", "small" ]);

        expect([
            buildNote({ title: "Script", type: "code", mime: "text/javascript" }),
            protectedCode,
            buildAttachment({ role: "file", mime: "application/json" }),
            buildAttachment({ role: "file", mime: "text/x-python" }),
            buildAttachment({ role: "file", mime: "application/javascript" })
        ].map(getEmbedBoxSize)).toEqual(Array(5).fill("full"));
        expect(touchProtectedSession).not.toHaveBeenCalled();

        expect([
            buildNote({ title: "Text", type: "text" }),
            buildNote({ title: "Readme", type: "code", mime: "text/x-markdown" }),
            buildNote({ title: "Books", type: "book" }),
            buildNote({ title: "Diagram", type: "mermaid" }),
            buildNote({ title: "Site", type: "webView", "#webViewSrc": "https://example.com" }),
            buildNote({ title: "Clip", type: "file", mime: "video/mp4" }),
            buildAttachment({ role: "file", mime: "application/pdf" }),
            buildAttachment({ role: "image", mime: "image/png" }),
            buildAttachment({ role: "file", mime: "application/vnd.excalidraw+json" }),
            buildAttachment({ role: "file", mime: "text/markdown" }),
            buildAttachment({ role: "file", mime: "text/plain", title: "readme.md" })
        ].map(getEmbedBoxSize)).toEqual(Array(11).fill("medium"));
    });

    it("shows an upload too large to highlight as a file", () => {
        expect(getUploadBoxSize("text/plain", 256 * 1024)).toBe("full");
        expect(getUploadBoxSize("text/plain", 256 * 1024 + 1)).toBe("tiny");
        expect(getUploadBoxSize("application/json", 10_000_000)).toBe("tiny");
    });

    it("sizes an upload by its media type, as the attachment it becomes", () => {
        expect([
            "application/zip", "", "audio/mpeg", "application/json", "application/pdf",
            "image/png", "video/mp4", "application/vnd.excalidraw+json", "text/plain",
            "application/x-sql", "text/rtf", "text/markdown"
        ].map(getUploadBoxSize)).toEqual([
            "tiny", "tiny", "small", "full", "medium", "medium", "medium", "medium", "full",
            "full", "medium", "medium"
        ]);
    });
});

describe("hasRenderedPreview", () => {
    it("tells a file it draws, such as a canvas drawing, from one it shows as an icon", () => {
        expect([
            buildAttachment({ role: "file", mime: "application/vnd.excalidraw+json" }),
            buildAttachment({ role: "importSource", mime: "application/json" }),
            buildAttachment({ role: "file", mime: "application/pdf" }),
            buildAttachment({ role: "file", mime: "text/plain" }),
            buildAttachment({ role: "importSource", mime: "text/html" }),
            buildNote({ title: "Site", type: "webView", "#webViewSrc": "https://example.com" })
        ].map(hasRenderedPreview)).toEqual(Array(6).fill(true));

        expect([
            buildAttachment({ role: "file", mime: "application/zip" }),
            buildNote({ title: "Notes", type: "file", mime: "text/plain" }),
            buildNote({ title: "Blank page", type: "webView" })
        ].map(hasRenderedPreview)).toEqual([ false, false, false ]);
    });
});

describe("getRenderedContent dispatch", () => {
    it("marks a note that asks for the full content width", async () => {
        const wide = buildNote({ title: "Wide", type: "text", "#fullContentWidth": "" });
        const narrow = buildNote({ title: "Narrow", type: "text" });

        expect((await getRenderedContent(wide)).$renderedContent.hasClass("full-content-width"))
            .toBe(true);
        expect((await getRenderedContent(narrow)).$renderedContent.hasClass("full-content-width"))
            .toBe(false);
    });

    it("renders text/book via renderText and applies css class", async () => {
        const note = buildNote({ title: "T", type: "text", "#cssClass": "my-class" });
        const { $renderedContent, type } = await getRenderedContent(note);
        expect(type).toBe("text");
        expect(renderText).toHaveBeenCalledOnce();
        expect($renderedContent.hasClass("rendered-content")).toBe(true);
        expect($renderedContent.hasClass("my-class")).toBe(true);
        expect($renderedContent.find(".from-render-text").length).toBe(1);

        const book = buildNote({ title: "B", type: "book" });
        expect((await getRenderedContent(book)).type).toBe("book");
        expect(renderText).toHaveBeenCalledTimes(2);
    });

    it("renders markdown with content through renderToHtml + postProcess", async () => {
        const note = buildNote({ title: "Doc", type: "code", content: "# Hi" });
        note.mime = "text/markdown";
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("markdown");
        expect(renderToHtml).toHaveBeenCalledWith("# Hi", "Doc", expect.anything());
        expect($renderedContent.find(".ck-content").html()).toContain("<p># Hi</p>");
        expect(postProcessRichContent).toHaveBeenCalledOnce();
        // exercise the formatHref + sanitize callbacks passed to renderToHtml
        const opts = renderToHtml.mock.calls[0][2] as any;
        expect(opts.wikiLink.formatHref("abc")).toBe("#root/abc");
        expect(opts.sanitize("<b>x</b>")).toBe("<b>x</b>");
    });

    it("treats a markdown note with a null blob as empty", async () => {
        const note = buildNote({ title: "NullBlob", type: "code" });
        note.mime = "text/markdown";
        note.getBlob = (async () => null) as any;
        await getRenderedContent(note);
        expect(renderToHtml).not.toHaveBeenCalled();
        expect(renderChildrenList).toHaveBeenCalledOnce();
    });

    it("renders empty markdown as a children list (FNote, not noChildrenList)", async () => {
        const note = buildNote({ title: "Empty", type: "code", content: "   " });
        note.mime = "text/markdown";
        await getRenderedContent(note);
        expect(renderToHtml).not.toHaveBeenCalled();
        expect(renderChildrenList).toHaveBeenCalledOnce();
        expect(renderChildrenList).toHaveBeenCalledWith(expect.anything(), note, false);
    });

    it("empty markdown with noChildrenList skips the children list", async () => {
        const note = buildNote({ title: "Empty2", type: "code", content: "" });
        note.mime = "text/markdown";
        await getRenderedContent(note, { noChildrenList: true });
        expect(renderChildrenList).not.toHaveBeenCalled();
    });

    it("empty markdown honors includeArchivedNotes flag", async () => {
        const note = buildNote({ title: "Empty3", type: "code", content: "" });
        note.mime = "text/markdown";
        await getRenderedContent(note, { includeArchivedNotes: true });
        expect(renderChildrenList).toHaveBeenCalledWith(expect.anything(), note, true);
    });
});

describe("getRenderedContent code rendering", () => {
    it("pretty-prints valid JSON code notes", async () => {
        const note = buildNote({ title: "J", type: "code", content: '{"a":1}' });
        note.mime = "application/json";
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("code");
        expect($renderedContent.find("pre > code").text()).toBe('{\n    "a": 1\n}');
        expect(renderCodeNotePreview.mock.calls)
            .toEqual([ [ '{\n    "a": 1\n}', "application/json", note, {} ] ]);
    });

    it("leaves invalid JSON untouched", async () => {
        const note = buildNote({ title: "JBad", type: "code", content: "{not json" });
        note.mime = "application/json";
        const { $renderedContent } = await getRenderedContent(note);
        expect($renderedContent.find("code").text()).toBe("{not json");
    });

    it("renders non-JSON code with empty content fallback", async () => {
        const note = buildNote({ title: "C", type: "code", content: "" });
        note.mime = "text/x-csrc";
        const { $renderedContent } = await getRenderedContent(note);
        expect($renderedContent.find("code").text()).toBe("");
    });
});

describe("getRenderedContent editable code", () => {
    function buildEditor() {
        return {
            canEdit: vi.fn(() => true),
            getUnsavedContent: vi.fn((): string | undefined => undefined),
            scheduleSave: vi.fn(),
            release: vi.fn(),
            getSaveState: vi.fn((): SaveState | undefined => "saving"),
            subscribeSaveState: vi.fn(() => () => {})
        };
    }

    it("renders an attached code file too large to highlight as a file", async () => {
        const large = buildAttachment({ role: "file", mime: "text/plain", contentLength: 256 * 1024 + 1 });
        large.getBlob = vi.fn(async () => ({ content: "x" })) as any;

        const { type } = await getRenderedContent(large, { interactive: true });
        expect(type).toBe("file");
        const largeSource = buildAttachment({
            role: "importSource", mime: "text/html", contentLength: 256 * 1024 + 1
        });
        expect((await getRenderedContent(largeSource)).type).toBe("file");
        expect(large.getBlob).not.toHaveBeenCalled();
        expect(renderCodeNotePreview).not.toHaveBeenCalled();
    });

    it("renders an attached code file as code, highlighted by the language of its name", async () => {
        const att = buildAttachment({ role: "file", mime: "text/x-python", title: "a.py" });
        att.getBlob = (async () => ({ content: "print(1)" })) as any;

        const { type, $renderedContent } = await getRenderedContent(att);
        expect(type).toBe("code");
        expect($renderedContent.find("pre > code").text()).toBe("print(1)");

        const generic = [
            buildAttachment({ role: "file", mime: "application/x-javascript", title: "app.js" }),
            buildAttachment({ role: "file", mime: "text/plain", title: "types.ts" }),
            buildAttachment({ role: "file", mime: "text/plain", title: "notes.txt" })
        ];
        for (const attachment of generic) {
            attachment.getBlob = (async () => ({ content: "" })) as any;
            await getRenderedContent(attachment);
        }
        expect(renderCodeNotePreview.mock.calls.map(([ , mime ]) => mime)).toEqual([
            "text/x-python", "text/javascript", "application/typescript", "text/plain"
        ]);
    });

    it("mounts CodeEmbed for an interactive code note, saved by `noteEditor`", async () => {
        const note = buildNote({
            title: "Script", type: "code", mime: "text/javascript", content: "saved"
        });
        const noteEditor = buildEditor();
        noteEditor.getUnsavedContent.mockReturnValue("unsaved");

        const { type, $renderedContent } = await getRenderedContent(note, {
            interactive: true,
            noteEditor
        });

        expect(type).toBe("code");
        const $mount = $renderedContent.find(".code-embed[data-interactive-mount]");
        expect($mount.find(".mock-code-embed-marker").length).toBe(1);
        const props = codeEmbedComponent.mock.calls[0][0];
        expect(props.entity).toBe(note);
        expect(props.content).toBe("unsaved");
        expect(props.mime).toBe("text/javascript");
        expect(renderCodeNotePreview).not.toHaveBeenCalled();

        const getContent = () => "edited";
        const onSaved = () => {};
        props.editor.scheduleSave(getContent, onSaved);
        props.editor.release();
        expect(props.editor.canEdit()).toBe(true);
        expect(noteEditor.canEdit).toHaveBeenCalledWith(note);
        expect(noteEditor.getUnsavedContent).toHaveBeenCalledWith(note.noteId);
        expect(noteEditor.scheduleSave).toHaveBeenCalledWith(note, getContent, onSaved);
        expect(noteEditor.release).toHaveBeenCalledWith(note.noteId);
        const listener = () => {};
        expect(props.editor.getSaveState()).toBe("saving");
        props.editor.subscribeSaveState(listener);
        expect(noteEditor.getSaveState).toHaveBeenCalledWith(note.noteId);
        expect(noteEditor.subscribeSaveState).toHaveBeenCalledWith(listener);
    });

    it("mounts MarkdownEmbed for a Markdown note in an embed, saved by `noteEditor`", async () => {
        const note = buildNote({
            title: "Readme", type: "code", mime: "text/x-markdown", content: "saved"
        });
        const noteEditor = buildEditor();
        noteEditor.getUnsavedContent.mockReturnValue("unsaved");

        const { type, $renderedContent } = await getRenderedContent(note, {
            interactive: true, hasDisplayModes: true, noteEditor
        });

        expect(type).toBe("markdown");
        expect($renderedContent.find(".markdown-embed[data-interactive-mount]")
            .find(".mock-markdown-embed-marker").length).toBe(1);
        const props = markdownEmbedComponent.mock.calls[0][0];
        expect([ props.entity, props.content ]).toEqual([ note, "unsaved" ]);
        expect(props.preview.outerHTML)
            .toBe("<div class=\"ck-content markdown-preview\"><p>unsaved</p></div>");
        expect(postProcessRichContent).toHaveBeenCalledWith(note, expect.anything(),
            expect.objectContaining({ hasDisplayModes: true }));
        expect(renderToHtml).not.toHaveBeenCalled();
        const getContent = () => "edited";
        props.editor.scheduleSave(getContent);
        expect(noteEditor.scheduleSave).toHaveBeenCalledWith(note, getContent, undefined);

        // Other Markdown renders the same way, and none shows the children of the note.
        expect((await props.renderPreview("edited")).innerHTML).toBe("<p>edited</p>");
        expect(renderChildrenList).not.toHaveBeenCalled();
        await props.renderPreview("");
        expect(renderChildrenList).toHaveBeenCalledWith(expect.anything(), note, false);
    });

    it("mounts MarkdownEmbed read-only for a Markdown file in an embed that cannot save", async () => {
        const att = buildAttachment({ role: "file", mime: "text/plain", title: "readme.md" });
        att.getBlob = (async () => ({ content: "# A" })) as any;

        const { type } = await getRenderedContent(att, { interactive: true, hasDisplayModes: true });
        expect(type).toBe("markdown");
        const props = markdownEmbedComponent.mock.calls[0][0];
        expect([ props.entity, props.editor, props.content ]).toEqual([ att, undefined, "# A" ]);
        await props.renderPreview("");
        expect(renderChildrenList).not.toHaveBeenCalled();

        // Elsewhere, the rendering shows alone.
        await getRenderedContent(att, { interactive: true });
        expect(renderToHtml).toHaveBeenCalledWith("# A", "readme.md", expect.anything());
        expect(markdownEmbedComponent).toHaveBeenCalledOnce();
    });

    it("mounts CodeEmbed for an interactive code file, saved by `attachmentEditor`", async () => {
        const att = buildAttachment({ role: "file", mime: "application/json" });
        att.getBlob = (async () => ({ content: "{}" })) as any;
        const attachmentEditor = buildEditor();

        await getRenderedContent(att, { interactive: true, attachmentEditor });

        const props = codeEmbedComponent.mock.calls[0][0];
        expect(props.entity).toBe(att);
        expect(props.content).toBe("{}");
        expect(props.mime).toBe("application/json");
        const onSaved = () => {};
        props.editor.scheduleSave(() => "[]", onSaved);
        props.editor.release();
        expect(attachmentEditor.getUnsavedContent).toHaveBeenCalledWith(att.attachmentId);
        expect(attachmentEditor.scheduleSave)
            .toHaveBeenCalledWith(att, expect.any(Function), onSaved);
        expect(attachmentEditor.release).toHaveBeenCalledWith(att.attachmentId);
    });

    it("gives the editor of a note or a file its undo history in the text note", async () => {
        const note = buildNote({
            title: "Script", type: "code", mime: "text/javascript", content: ""
        });
        const att = buildAttachment({ role: "file", mime: "application/json" });
        att.getBlob = (async () => ({ content: "{}" })) as any;
        const noteEditor = buildEditor();
        const attachmentEditor = buildEditor();
        const histories = new EmbedHistories(() => null);

        await getRenderedContent(note, { interactive: true, noteEditor, histories });
        await getRenderedContent(att, { interactive: true, attachmentEditor, histories });
        const [ noteHistory, fileHistory ] = codeEmbedComponent.mock.calls
            .map(([ props ]) => props.editor.history);
        expect(noteHistory).toBe(histories.get(note.noteId, vi.fn()));
        expect(fileHistory).toBe(histories.get(att.attachmentId, vi.fn()));

        // Content that no editor shows saves through the editor of the embed.
        noteHistory.write("a");
        fileHistory.write("b");
        expect(noteEditor.scheduleSave.mock.lastCall?.[0]).toBe(note);
        expect(noteEditor.scheduleSave.mock.lastCall?.[1]()).toBe("a");
        expect(attachmentEditor.scheduleSave.mock.lastCall?.[0]).toBe(att);
        expect(attachmentEditor.scheduleSave.mock.lastCall?.[1]()).toBe("b");
    });

    it("highlights a code file in the language that its embed sets, for CodeEmbed too", async () => {
        const att = buildAttachment({ role: "file", mime: "text/plain", title: "a.py" });
        att.getBlob = (async () => ({ content: "echo 1" })) as any;

        await getRenderedContent(att, { codeLanguage: "text/x-sh" });
        expect(renderCodeNotePreview.mock.lastCall?.[1]).toBe("text/x-sh");

        await getRenderedContent(att, {
            codeLanguage: "text/x-sh", interactive: true, attachmentEditor: buildEditor()
        });
        const props = codeEmbedComponent.mock.lastCall?.[0];
        expect([ props.mime, props.codeLanguage ]).toEqual([ "text/x-python", "text/x-sh" ]);
        expect(renderCodeNotePreview).toHaveBeenCalledOnce();
    });

    it("wraps and numbers the lines of code as its embed sets, for CodeEmbed too", async () => {
        const att = buildAttachment({ role: "file", mime: "text/plain", title: "a.py" });
        att.getBlob = (async () => ({ content: "echo 1" })) as any;
        const lines = { isCodeWrapped: false, hasCodeLineNumbers: false };

        await getRenderedContent(att, lines);
        expect(renderCodeNotePreview.mock.lastCall?.[3])
            .toEqual({ isWrapped: false, hasLineNumbers: false });

        await getRenderedContent(att, {
            ...lines, interactive: true, attachmentEditor: buildEditor()
        });
        expect(codeEmbedComponent.mock.lastCall?.[0]).toMatchObject(lines);
    });

    it("mounts TextEmbed for an interactive text note, with a preview to render again", async () => {
        const note = buildNote({ title: "Doc", type: "text", content: "<p>Hi</p>" });
        const noteEditor = buildEditor();

        const { type, $renderedContent } = await getRenderedContent(note, {
            interactive: true,
            embedsAsReferenceLinks: true,
            noteEditor
        });

        expect(type).toBe("text");
        expect($renderedContent.find(".text-embed[data-interactive-mount]").length).toBe(1);
        const props = textEmbedComponent.mock.calls[0][0];
        expect(props.note).toBe(note);
        expect(props.content).toBe("<p>Hi</p>");
        const rendered = (preview: HTMLElement) =>
            preview.querySelector(".from-render-text-content")?.getAttribute("data-content");
        expect(rendered(props.preview)).toBe("<p>Hi</p>");
        expect(renderTextContent).toHaveBeenLastCalledWith(
            note, "<p>Hi</p>", expect.anything(),
            expect.objectContaining({ embedsAsReferenceLinks: true }));
        expect(props.editor.canEdit()).toBe(true);
        expect(noteEditor.canEdit).toHaveBeenCalledWith(note);

        const again = await props.renderPreview("<p>Edited</p>");
        expect(again).not.toBe(props.preview);
        expect(rendered(again)).toBe("<p>Edited</p>");
    });

    it("mounts TextEmbed for blocks, with an editor where they can be edited apart", async () => {
        const content = "<ul><li><p>Intro</p><p data-trilium-block-id=\"a\">A</p></li></ul>"
            + "<p data-trilium-block-id=\"b\">B</p>";
        const note = buildNote({ title: "Doc", type: "text", content });
        const onBlockChange = vi.fn();
        const renderBlocks = (block: string) => getRenderedContent(note, {
            interactive: true,
            noteEditor: buildEditor(),
            block,
            onBlockChange
        });

        await renderBlocks("b");
        const props = textEmbedComponent.mock.lastCall?.[0];
        expect(props).toMatchObject({ content, block: "b", onBlockChange });
        expect(props.editor.canEdit()).toBe(true);
        expect(renderTextContent).toHaveBeenLastCalledWith(
            note, content, expect.anything(), expect.objectContaining({ block: "b" }));

        await props.renderPreview("<p>New</p>", "b:n");
        expect(renderTextContent).toHaveBeenLastCalledWith(
            note, "<p>New</p>", expect.anything(), expect.objectContaining({ block: "b:n" }));

        await renderBlocks("a:b");
        expect(textEmbedComponent.mock.lastCall?.[0].editor).toBeUndefined();
    });

    it("edits only code and text notes", async () => {
        const json = buildNote({
            title: "Data", type: "file", mime: "application/json", content: "{}"
        });
        await getRenderedContent(json, {
            interactive: true,
            noteEditor: buildEditor()
        });

        const props = codeEmbedComponent.mock.lastCall?.[0];
        expect([ props.entity, props.editor, props.content ]).toEqual([ json, undefined, "{}" ]);
    });

    it("shows code read-only without an editor, and as a static preview outside an embed", async () => {
        const note = buildNote({
            title: "Script", type: "code", mime: "text/javascript", content: "x"
        });
        const att = buildAttachment({ role: "file", mime: "text/plain" });
        att.getBlob = (async () => ({ content: "y" })) as any;

        await getRenderedContent(note, { interactive: true, attachmentEditor: buildEditor() });
        await getRenderedContent(att, { interactive: true, noteEditor: buildEditor() });
        expect(codeEmbedComponent.mock.calls.map(([ props ]) => [
            props.entity, props.editor, props.content
        ])).toEqual([ [ note, undefined, "x" ], [ att, undefined, "y" ] ]);
        expect(renderCodeNotePreview).not.toHaveBeenCalled();

        const { $renderedContent: $static } = await getRenderedContent(note, {
            noteEditor: buildEditor()
        });
        expect($static.find("pre > code").text()).toBe("x");
        expect(codeEmbedComponent).toHaveBeenCalledTimes(2);

        const text = buildNote({ title: "Doc", type: "text", content: "<p>Hi</p>" });
        const { $renderedContent } = await getRenderedContent(text, { noteEditor: buildEditor() });
        expect($renderedContent.find(".from-render-text").length).toBe(1);
        expect(textEmbedComponent).not.toHaveBeenCalled();
    });
});

describe("getRenderedContent image rendering", () => {
    it("renders an FNote image with an api/images url", async () => {
        const note = buildNote({ title: "Pic", type: "image" });
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("image");
        const $img = $renderedContent.find("img");
        expect($img.attr("src")).toContain(`api/images/${note.noteId}/`);
        expect($img.attr("id")).toMatch(/^attachment-image-\d+$/);
        expect(setupContextMenu).toHaveBeenCalledOnce();
    });

    it("renders an FAttachment image with an api/attachments url", async () => {
        const att = buildAttachment({ role: "image" });
        const { type, $renderedContent } = await getRenderedContent(att);
        expect(type).toBe("image");
        expect($renderedContent.find("img").attr("src")).toContain(`api/attachments/${att.attachmentId}/image/`);
    });

    it("mounts the image viewer when the caller embeds an image note or attachment", async () => {
        const note = buildNote({ title: "Pic", type: "image" });
        const { type, $renderedContent } = await getRenderedContent(note, {
            mediaEnvironment: "embedded"
        });
        expect(type).toBe("image");
        const $viewer = $renderedContent.find(".rendered-image-viewer");
        expect($viewer.find(".mock-image-viewer-marker").length).toBe(1);
        expect($renderedContent.find("img").length).toBe(0);
        expect(imageViewerComponent).toHaveBeenCalledWith(expect.objectContaining({
            src: expect.stringContaining(`api/images/${note.noteId}/`),
            alt: "Pic",
            environment: "embedded"
        }), expect.anything());
        // The viewer's <img> takes no pointer events, so the menu listens on the container.
        expect(setupContextMenu).toHaveBeenCalledOnce();
        expect(setupContextMenu.mock.calls[0][0].get(0)).toBe($viewer.get(0));

        const att = buildAttachment({ role: "image" });
        await getRenderedContent(att, { mediaEnvironment: "embedded" });
        expect(imageViewerComponent).toHaveBeenLastCalledWith(expect.objectContaining({
            src: expect.stringContaining(`api/attachments/${att.attachmentId}/image/`)
        }), expect.anything());
    });

    it("keeps a plain image for an embedded canvas and outside an embed", async () => {
        const canvas = buildNote({ title: "C", type: "canvas" });
        const embedded = await getRenderedContent(canvas, { mediaEnvironment: "embedded" });
        expect(embedded.$renderedContent.find("img").length).toBe(1);

        const note = buildNote({ title: "Pic", type: "image" });
        const native = await getRenderedContent(note, { mediaEnvironment: "native" });
        expect(native.$renderedContent.find("img").length).toBe(1);
        expect(imageViewerComponent).not.toHaveBeenCalled();
    });

    it("appends OCR text for FNote images when showTextRepresentation and OCR succeeds", async () => {
        const note = buildNote({ title: "OcrPic", type: "spreadsheet" });
        server.get = vi.fn(async () => ({ success: true, hasOcr: true, text: "hello-ocr" })) as typeof server.get;
        const { $renderedContent } = await getRenderedContent(note, { showTextRepresentation: true });
        expect(server.get).toHaveBeenCalledWith(`ocr/notes/${note.noteId}/text`);
        expect($renderedContent.find(".ocr-content").text()).toBe("hello-ocr");
    });

    it("omits OCR section when the OCR response is unsuccessful", async () => {
        const note = buildNote({ title: "OcrNo", type: "image" });
        server.get = vi.fn(async () => ({ success: false, hasOcr: false, text: "" })) as typeof server.get;
        const { $renderedContent } = await getRenderedContent(note, { showTextRepresentation: true });
        expect($renderedContent.find(".ocr-content").length).toBe(0);
    });

    it("swallows OCR fetch errors", async () => {
        const note = buildNote({ title: "OcrErr", type: "image" });
        const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
        server.get = vi.fn(async () => { throw new Error("boom"); }) as typeof server.get;
        const { $renderedContent } = await getRenderedContent(note, { showTextRepresentation: true });
        expect($renderedContent.find(".ocr-content").length).toBe(0);
        expect(debugSpy).toHaveBeenCalled();
        debugSpy.mockRestore();
    });

    it("does not fetch OCR for attachments even with showTextRepresentation", async () => {
        const att = buildAttachment({ role: "image" });
        server.get = vi.fn(async () => ({ success: true, hasOcr: true, text: "x" })) as typeof server.get;
        await getRenderedContent(att, { showTextRepresentation: true });
        expect(server.get).not.toHaveBeenCalledWith(expect.stringContaining("ocr/"));
    });
});

describe("getRenderedContent file rendering", () => {
    it("renders a pdf note with a viewer, download and open buttons", async () => {
        const note = buildNote({ title: "P", type: "file" });
        note.mime = "application/pdf";
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("pdf");
        expect(pdfViewerComponent).toHaveBeenCalled();
        // Root-relative, never `../../api/...`: a path climbing out of /pdfjs/web is rejected by
        // proxies that filter traversal, before the request reaches Trilium (#8877).
        expect(pdfViewerComponent.mock.calls.at(-1)?.[0].pdfUrl).toBe(`/api/notes/${note.noteId}/open`);

        const att = buildAttachment({ role: "file", mime: "application/pdf" });
        await getRenderedContent(att);
        expect(pdfViewerComponent.mock.calls.at(-1)?.[0].pdfUrl).toBe(`/api/attachments/${att.attachmentId}/open`);

        expect($renderedContent.find(".file-download").length).toBe(1);
        const $open = $renderedContent.find(".file-open");
        expect($open.length).toBe(1);

        // exercise the click handlers
        $renderedContent.find(".file-download").trigger("click");
        expect(downloadFileNote).toHaveBeenCalledWith(note, null, null);
        await $open.trigger("click");
        expect(openNoteExternally).toHaveBeenCalledWith(note.noteId, note.mime);
    });

    it("does not render file when tooltip option is set", async () => {
        const note = buildNote({ title: "PT", type: "file" });
        note.mime = "application/pdf";
        const { $renderedContent } = await getRenderedContent(note, { tooltip: true });
        expect($renderedContent.find(".file-download").length).toBe(0);
        // falls through to the generic FNote no-preview branch
        expect($renderedContent.hasClass("no-preview")).toBe(true);
    });

    it("mounts a lazy media player for an audio or video note, streaming nothing until it is played", async () => {
        const note = buildNote({ title: "A", type: "file" });
        note.mime = "audio/mpeg";
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("audio");
        expect($renderedContent.find(".rendered-media").length).toBe(1);
        expect(mediaPreviewComponent).toHaveBeenCalledWith(
            expect.objectContaining({ entity: note, environment: "preview" }), expect.anything());
        // No media element is emitted here at all — the placeholder creates one only once it is clicked.
        expect($renderedContent.find("audio, video").length).toBe(0);
    });

    it("mounts the full media player when the caller embeds the note, and drops the footer it carries itself", async () => {
        const note = buildNote({ title: "V", type: "file" });
        note.mime = "video/mp4";
        const { type, $renderedContent } = await getRenderedContent(note, { mediaEnvironment: "embedded" });
        expect(type).toBe("video");
        expect(mediaPreviewComponent).toHaveBeenCalledWith(
            expect.objectContaining({ entity: note, environment: "embedded" }), expect.anything());
        // An embed has no room for a footer: the player takes Download / Open into its own controls.
        expect($renderedContent.find(".file-footer").length).toBe(0);
    });

    it("keeps the footer for a media preview, and for the file types that have no player", async () => {
        const video = buildNote({ title: "V", type: "file" });
        video.mime = "video/mp4";
        expect((await getRenderedContent(video)).$renderedContent.find(".file-footer").length).toBe(1);

        const pdf = buildNote({ title: "P", type: "file" });
        pdf.mime = "application/pdf";
        expect((await getRenderedContent(pdf, { mediaEnvironment: "embedded" })).$renderedContent.find(".file-footer").length).toBe(1);
    });

    it("renders the plain media element for callers that serialize to HTML (presentation, printing)", async () => {
        const note = buildNote({ title: "V", type: "file" });
        note.mime = "video/mp4";
        const { $renderedContent } = await getRenderedContent(note, { mediaEnvironment: "native" });
        expect(mediaPreviewComponent).not.toHaveBeenCalled();

        const $video = $renderedContent.find("video");
        expect($video.attr("src")).toBe(getUrlForDownload(`api/notes/${note.noteId}/open-partial`));
        expect($video.attr("controls")).toBeDefined();

        const audio = buildNote({ title: "A", type: "file" });
        audio.mime = "audio/mpeg";
        const rendered = await getRenderedContent(audio, { mediaEnvironment: "native" });
        expect(rendered.$renderedContent.find("audio").attr("src")).toBe(getUrlForDownload(`api/notes/${audio.noteId}/open-partial`));
    });

    it("hides the open button for protected file notes", async () => {
        const note = buildNote({ title: "Prot", type: "file" });
        note.mime = "video/mp4";
        note.isProtected = true;
        isProtectedSessionAvailable.mockReturnValue(true); // keep type === file (not protectedSession)
        const { $renderedContent } = await getRenderedContent(note);
        expect(touchProtectedSession).toHaveBeenCalled();
        expect($renderedContent.find(".file-open").css("display")).toBe("none");
    });

    it("renders a file attachment without note-only footer buttons", async () => {
        const att = buildAttachment({ role: "file", mime: "video/mp4" });
        const { type, $renderedContent } = await getRenderedContent(att);
        expect(type).toBe("video");
        expect($renderedContent.find(".file-footer").length).toBe(0);
    });

    it("appends OCR text inside the file content when requested", async () => {
        const note = buildNote({ title: "FileOcr", type: "file" });
        note.mime = "audio/mpeg";
        server.get = vi.fn(async () => ({ success: true, hasOcr: true, text: "ocr-file" })) as typeof server.get;
        const { $renderedContent } = await getRenderedContent(note, { showTextRepresentation: true });
        expect($renderedContent.find(".ocr-content").text()).toBe("ocr-file");
    });
});

describe("getRenderedContent office rendering", () => {
    const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    it("renders a docx file note as a converted, sanitized preview plus file actions", async () => {
        const note = buildNote({ title: "Doc", type: "file" });
        note.mime = DOCX;
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("office");
        expect(renderOfficeToHtml).toHaveBeenCalledWith("notes", note.noteId, { trim: undefined });
        // the padded body sits inside a dedicated, unpadded scroll host
        expect($renderedContent.find(".office-preview-scroll > .office-preview-body").html()).toContain("converted");
        // the file remains downloadable / openable
        expect($renderedContent.find(".file-download").length).toBe(1);
        expect($renderedContent.find(".file-open").length).toBe(1);
    });

    it("attaches a spreadsheet's stylesheet inside the preview body, as an element", async () => {
        renderOfficeToHtml.mockResolvedValueOnce({
            css: ".spreadsheet-table .sst-1{font-weight:bold}",
            html: '<table class="spreadsheet-table"><td class="sst-1">x</td></table>'
        });
        const note = buildNote({ title: "Book", type: "file" });
        note.mime = DOCX;

        const { $renderedContent } = await getRenderedContent(note);

        const $style = $renderedContent.find(".office-preview-body > style");
        expect($style.length).toBe(1);
        // Set as text, so the rules are never parsed as markup on the way in.
        expect($style.text()).toBe(".spreadsheet-table .sst-1{font-weight:bold}");
    });

    it("shows an admonition (and drops the preview body) when conversion fails", async () => {
        renderOfficeToHtml.mockRejectedValueOnce(new Error("bad zip"));
        const note = buildNote({ title: "DocBad", type: "file" });
        note.mime = "application/vnd.oasis.opendocument.text";
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("office");
        expect($renderedContent.find(".admonition.caution").length).toBe(1);
        expect($renderedContent.find(".office-preview-scroll, .office-preview-body").length).toBe(0);
    });

    it("does not run the heavy conversion in tooltip mode", async () => {
        const note = buildNote({ title: "DocT", type: "file" });
        note.mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        const { $renderedContent } = await getRenderedContent(note, { tooltip: true });
        expect(renderOfficeToHtml).not.toHaveBeenCalled();
        expect($renderedContent.hasClass("no-preview")).toBe(true);
    });

    it("renders an office attachment preview without the note-only footer", async () => {
        const att = buildAttachment({ role: "file", mime: "application/vnd.oasis.opendocument.spreadsheet" });
        const { type, $renderedContent } = await getRenderedContent(att);
        expect(type).toBe("office");
        expect(renderOfficeToHtml).toHaveBeenCalledWith("attachments", att.attachmentId, { trim: undefined });
        expect($renderedContent.find(".file-footer").length).toBe(0);
    });
});

describe("getRenderedContent render / doc / protectedSession / mermaid", () => {
    it("renders a render-type note and surfaces render-service output", async () => {
        const note = buildNote({ title: "R", type: "render" });
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("render");
        expect(renderServiceRender).toHaveBeenCalledOnce();
        expect($renderedContent.find(".render-ok").length).toBe(1);
    });

    it("mounts a JSX render note under the given parent component", async () => {
        const parentComponent = new Component();
        await getRenderedContent(buildNote({ title: "R", type: "render" }), { parentComponent });
        expect(renderServiceRender.mock.lastCall?.[3]).toEqual(expect.objectContaining({ parentComponent }));
    });

    it("aborts the render and unmounts its JSX when the content is disposed", async () => {
        const unmounted = vi.fn();
        function Probe() {
            useLayoutEffect(() => unmounted, []);
            return null;
        }
        renderServiceRender.mockImplementationOnce(async (_n: unknown, $content: JQuery<HTMLElement>) => {
            render(h(Probe, {}), $content[0]);
        });

        const { $renderedContent } = await getRenderedContent(buildNote({ title: "R", type: "render" }));
        const { signal } = renderServiceRender.mock.lastCall?.[3] as { signal: AbortSignal };
        expect(signal.aborted).toBe(false);
        expect(unmounted).not.toHaveBeenCalled();

        disposeInteractiveContent($renderedContent);
        expect(signal.aborted).toBe(true);
        expect(unmounted).toHaveBeenCalledOnce();
    });

    it("render error callback shows an admonition with the error message", async () => {
        renderServiceRender.mockImplementationOnce(async (_n: any, $content: any, onError: any) => {
            onError(new Error("kaput"));
        });
        const note = buildNote({ title: "RErr", type: "render" });
        const { $renderedContent } = await getRenderedContent(note);
        // The error card component itself is imported (and mounted) asynchronously.
        await vi.dynamicImportSettled();
        const $err = $renderedContent.find(".admonition.caution.render-error-card");
        expect($err.length).toBe(1);
        expect($err.find(".render-error-message").text()).toContain("kaput");
    });

    it("render error callback accepts a string error directly", async () => {
        renderServiceRender.mockImplementationOnce(async (_n: any, $content: any, onError: any) => {
            onError("plain-string-error");
        });
        const note = buildNote({ title: "RErrStr", type: "render" });
        const { $renderedContent } = await getRenderedContent(note);
        await vi.dynamicImportSettled();
        expect($renderedContent.find(".render-error-card .render-error-message").text()).toBe("plain-string-error");
    });

    it("renders a doc note via the doc renderer", async () => {
        const note = buildNote({ title: "D", type: "doc" });
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("doc");
        expect(renderDoc).toHaveBeenCalledOnce();
        expect($renderedContent.html()).toContain("doc");
    });

    it("renders the protected-session prompt with a working enter button", async () => {
        const note = buildNote({ title: "S", type: "text" });
        note.isProtected = true;
        isProtectedSessionAvailable.mockReturnValue(false);
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("protectedSession");
        const $btn = $renderedContent.find("button");
        expect($btn.length).toBe(1);
        $btn.trigger("click");
        expect(enterProtectedSession).toHaveBeenCalledOnce();
    });

    it("shows a mermaid note's saved SVG instead of rendering its source", async () => {
        const note = buildNote({ title: "M", type: "mermaid", content: "graph TD; A-->B" });
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("mermaid");
        const $img = $renderedContent.find("img");
        expect($img.length).toBe(1);
        expect($img.attr("src")).toContain(`api/images/${note.noteId}/`);
        expect($renderedContent.find("svg").length).toBe(0);
        expect(mermaidRender).not.toHaveBeenCalled();
    });
});

describe("generic FNote fallback / webView", () => {
    it("renders the no-preview icon block for unknown types", async () => {
        const note = buildNote({ title: "Map", type: "noteMap" });
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("noteMap");
        expect($renderedContent.hasClass("no-preview")).toBe(true);
        expect($renderedContent.find("span").length).toBeGreaterThan(0);
    });

    it("gives an attachment without a preview its own icon, as a note gets", async () => {
        const pdf = buildAttachment({ role: "file", mime: "application/pdf" });
        const library = buildAttachment({ role: "canvasLibraryItem", mime: "application/json" });

        const cases = [ [ pdf, { tooltip: true } ], [ library, {} ] ] as const;

        for (const [ attachment, options ] of cases) {
            const { $renderedContent } = await getRenderedContent(attachment, options);

            expect($renderedContent.hasClass("no-preview")).toBe(true);
            expect($renderedContent.find("span").attr("class"))
                .toBe(attachmentIcon(attachment.role, attachment.mime));
        }
    });

    it("renders a webView footer that opens in a new window when not in electron", async () => {
        const note = buildNote({ title: "W", type: "webView", "#webViewSrc": "https://example.com" });
        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
        const { $renderedContent } = await getRenderedContent(note);
        const $btn = $renderedContent.find(".webview-footer .file-open");
        expect($btn.length).toBe(1);
        $btn.trigger("click");
        expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
        openSpy.mockRestore();
    });

    it("uses the electron shell when electronApi is present", async () => {
        const note = buildNote({ title: "WE", type: "webView", "#webViewSrc": "https://el.example" });
        const openExternal = vi.fn();
        (window as any).electronApi = { shell: { openExternal } };
        const { $renderedContent } = await getRenderedContent(note);
        $renderedContent.find(".webview-footer .file-open").trigger("click");
        expect(openExternal).toHaveBeenCalledWith("https://el.example");
    });

    it("does nothing on click when webViewSrc label value is missing", async () => {
        const note = buildNote({ title: "WNull", type: "webView", "#webViewSrc": "" });
        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
        const { $renderedContent } = await getRenderedContent(note);
        $renderedContent.find(".webview-footer .file-open").trigger("click");
        expect(openSpy).not.toHaveBeenCalled();
        openSpy.mockRestore();
    });

    it("renders a plain webView (no webViewSrc label) without a footer", async () => {
        const note = buildNote({ title: "WPlain", type: "webView" });
        const { $renderedContent } = await getRenderedContent(note);
        expect($renderedContent.find(".webview-footer").length).toBe(0);
        expect($renderedContent.hasClass("no-preview")).toBe(true);
    });

    it("mounts the live WebView widget when interactive (outside a tooltip)", async () => {
        const note = buildNote({ title: "WI", type: "webView", "#webViewSrc": "https://example.com" });
        const { type, $renderedContent } = await getRenderedContent(note, { interactive: true });
        expect(type).toBe("webView");
        expect(webViewComponent).toHaveBeenCalledOnce();
        expect(webViewComponent.mock.calls[0]?.[0]).toMatchObject({ note });
        expect($renderedContent.find(".note-detail-web-view").length).toBe(1);
        // The live embed replaces the static fallback.
        expect($renderedContent.find(".webview-footer").length).toBe(0);
        expect($renderedContent.hasClass("no-preview")).toBe(false);
    });

    it("points a freshly mounted .component element at a component of its own under appContext", async () => {
        // The real renderReactWidgetAtElement runs here; make the mounted widget emit a bare
        // ".component" element (as a real widget root would) with no component prop yet.
        webViewComponent.mockImplementationOnce(() => h("div", { class: "component" }));
        const note = buildNote({ title: "WICmp", type: "webView", "#webViewSrc": "https://example.com" });

        const { $renderedContent } = await getRenderedContent(note, { interactive: true });

        const $component = $renderedContent.find(".note-detail-web-view .component");
        expect($component.length).toBe(1);
        const component = $component.prop("component");
        expect(component).toBeInstanceOf(Component);
        expect(component).not.toBe(appContext);
        expect(component.parent).toBe(appContext);
        expect(appContext.children).toContain(component);

        disposeInteractiveContent($renderedContent);
        expect(appContext.children).not.toContain(component);
    });

    it("lets an embedded widget's buttons reach the command handlers it registers", async () => {
        // As a table's "New row" does: the handler is written onto the widget's parent component.
        const addNewRowCommand = vi.fn();
        function Widget() {
            useLegacyImperativeHandlers({ addNewRowCommand });
            return h("div", { class: "component" });
        }
        webViewComponent.mockImplementationOnce(() => h(Widget, {}));
        const note = buildNote({ title: "WICmd", type: "webView", "#webViewSrc": "https://example.com" });

        let $renderedContent!: JQuery<HTMLElement>;
        await act(async () => {
            ({ $renderedContent } = await getRenderedContent(note, { interactive: true }));
        });

        $renderedContent.find(".note-detail-web-view .component").prop("component").triggerCommand("addNewRow", {});
        expect(addNewRowCommand).toHaveBeenCalledOnce();
        disposeInteractiveContent($renderedContent);
    });

    it("leaves a .component element that already carries a component prop untouched", async () => {
        const preexisting = { marker: "already-wired" };
        webViewComponent.mockImplementationOnce(() => h("div", {
            class: "component",
            ref: (el: HTMLElement | null) => {
                if (el) {
                    $(el).prop("component", preexisting);
                }
            }
        }));
        const note = buildNote({ title: "WICmp2", type: "webView", "#webViewSrc": "https://example.com" });

        const { $renderedContent } = await getRenderedContent(note, { interactive: true });

        const $component = $renderedContent.find(".note-detail-web-view .component");
        expect($component.prop("component")).toBe(preexisting);
    });

    it("executes the search and mounts the live collection list for an interactive search note", async () => {
        const note = buildNote({ title: "Saved", type: "search" });
        vi.spyOn(note, "getBestNotePathString").mockReturnValue("root/saved");
        const loadSpy = vi.spyOn(froca, "loadSearchNote").mockResolvedValue(undefined);

        const { type, $renderedContent } = await getRenderedContent(note, { interactive: true });

        expect(type).toBe("search");
        expect(loadSpy).toHaveBeenCalledWith(note.noteId);
        expect(embeddedNoteListComponent).toHaveBeenCalledOnce();
        expect(embeddedNoteListComponent.mock.calls[0]?.[0]).toMatchObject({ note, media: "screen", showTextRepresentation: true });
        expect($renderedContent.find(".rendered-collection").length).toBe(1);

        loadSpy.mockRestore();
    });

    it("mounts the collection view for an interactive book note without executing a search", async () => {
        const note = buildNote({ title: "Coll", type: "book" });
        vi.spyOn(note, "getBestNotePathString").mockReturnValue("root/coll");
        const loadSpy = vi.spyOn(froca, "loadSearchNote").mockResolvedValue(undefined);

        const { type, $renderedContent } = await getRenderedContent(note, { interactive: true });

        expect(type).toBe("book");
        expect(loadSpy).not.toHaveBeenCalled();
        expect(embeddedNoteListComponent).toHaveBeenCalledOnce();
        expect(embeddedNoteListComponent.mock.calls[0]?.[0]).toMatchObject({ note, media: "screen", showTextRepresentation: false });
        expect($renderedContent.find(".rendered-collection").length).toBe(1);

        loadSpy.mockRestore();
    });

    it("does not embed a dashboard-view collection, to avoid recursion", async () => {
        const note = buildNote({ title: "Dash", type: "book", "#viewType": "dashboard" });
        const { $renderedContent } = await getRenderedContent(note, { interactive: true });
        // Falls back to renderText (the basic children list) instead of the live collection.
        expect(embeddedNoteListComponent).not.toHaveBeenCalled();
        expect($renderedContent.find(".rendered-collection").length).toBe(0);
        expect($renderedContent.find(".from-render-text").length).toBe(1);
    });

    it("keeps the static fallback for book/search notes when interactive is off", async () => {
        const loadSpy = vi.spyOn(froca, "loadSearchNote").mockResolvedValue(undefined);

        // Book falls back to renderText (basic children list).
        const book = await getRenderedContent(buildNote({ title: "Coll2", type: "book" }));
        // Search has no static renderer, so it lands in the no-preview block.
        const search = await getRenderedContent(buildNote({ title: "Saved2", type: "search" }));

        expect(loadSpy).not.toHaveBeenCalled();
        expect(embeddedNoteListComponent).not.toHaveBeenCalled();
        expect(book.$renderedContent.find(".from-render-text").length).toBe(1);
        expect(search.$renderedContent.hasClass("no-preview")).toBe(true);
        expect(search.$renderedContent.find(".rendered-collection").length).toBe(0);

        loadSpy.mockRestore();
    });

    it("keeps the static fallback in a tooltip or without a src, even when interactive", async () => {
        // Tooltips never embed the live widget, even with interactive set.
        const tip = await getRenderedContent(
            buildNote({ title: "WT", type: "webView", "#webViewSrc": "https://example.com" }),
            { interactive: true, tooltip: true }
        );
        // Interactive set, but the note has no configured src.
        const noSrc = await getRenderedContent(
            buildNote({ title: "WN", type: "webView" }),
            { interactive: true }
        );

        expect(webViewComponent).not.toHaveBeenCalled();
        expect(tip.$renderedContent.find(".note-detail-web-view").length).toBe(0);
        expect(tip.$renderedContent.find(".webview-footer").length).toBe(1);
        expect(noSrc.$renderedContent.find(".note-detail-web-view").length).toBe(0);
        expect(noSrc.$renderedContent.hasClass("no-preview")).toBe(true);
    });

    it("mounts the chat preview for an AI chat note", async () => {
        const { $renderedContent } = await getRenderedContent(buildChatNote(["Ping?"]));

        expect(chatPreviewComponent).toHaveBeenCalledOnce();
        const mount = $renderedContent.find("[data-interactive-mount]");
        expect(mount.length).toBe(1);
        expect(mount.find(".mock-chat-marker").text()).toBe("messages:1");
    });

    it("snapshots the chat preview for a tooltip, leaving no live root behind", async () => {
        const { $renderedContent } = await getRenderedContent(buildChatNote(["Ping?"]), { tooltip: true });

        // Rendered by the same preview component as the note detail...
        expect(chatPreviewComponent).toHaveBeenCalledOnce();
        expect($renderedContent.find(".mock-chat-marker").text()).toBe("messages:1");
        // ...but unmounted afterwards: the markup survives with nothing left to dispose.
        expect($renderedContent.find("[data-interactive-mount]").length).toBe(0);
        disposeInteractiveContent($renderedContent);
        expect($renderedContent.find(".mock-chat-marker").length).toBe(1);
    });

    it("caps how many messages a tooltip previews, but not the note detail", async () => {
        const messages = Array.from({ length: 25 }, (_, i) => `msg-${i}`);

        await getRenderedContent(buildChatNote(messages), { tooltip: true });
        expect(chatPreviewComponent.mock.calls[0][0].messages).toHaveLength(10);

        await getRenderedContent(buildChatNote(messages));
        expect(chatPreviewComponent.mock.calls[1][0].messages).toHaveLength(25);
    });

    it("keeps a title-only tooltip for a chat with no messages", async () => {
        const { $renderedContent } = await getRenderedContent(buildChatNote([]), { tooltip: true });

        expect(chatPreviewComponent).not.toHaveBeenCalled();
        expect($renderedContent.html()).toBe("");
    });
});

describe("getRenderedContent canvas drawing rendering", () => {
    const canvasMime = "application/vnd.excalidraw+json";

    it("mounts the editor for an interactive attachment, with its saving editor", async () => {
        const att = buildAttachment({ role: "file", mime: canvasMime });
        const attachmentEditor = { canEdit: vi.fn(() => true), release: vi.fn() } as any;

        const { type, $renderedContent } = await getRenderedContent(att, {
            interactive: true,
            attachmentEditor
        });

        expect(type).toBe("canvasDrawing");
        const $drawing = $renderedContent.find(".canvas-drawing[data-interactive-mount]");
        expect($drawing.find(".mock-canvas-drawing-marker").length).toBe(1);
        const { attachment, editor } = canvasDrawingComponent.mock.calls[0][0];
        expect(attachment).toBe(att);
        expect(editor.canEdit()).toBe(true);
        editor.release();
        expect(attachmentEditor.canEdit).toHaveBeenCalledWith(att);
        expect(attachmentEditor.release).toHaveBeenCalledWith(att.attachmentId);
        expect(renderCanvasDrawingPicture).not.toHaveBeenCalled();
    });

    it("shows a picture of the drawing elsewhere, and an icon for an empty drawing", async () => {
        const att = buildAttachment({ role: "file", mime: canvasMime });
        const picture = document.createElement("svg");
        renderCanvasDrawingPicture.mockResolvedValueOnce(picture);

        const { type, $renderedContent } = await getRenderedContent(att);
        expect(type).toBe("canvasDrawing");
        expect($renderedContent.children().get(0)).toBe(picture);
        expect(canvasDrawingComponent).not.toHaveBeenCalled();

        const note = buildNote({ title: "Drawing", type: "file", mime: canvasMime });
        const { $renderedContent: $empty } = await getRenderedContent(note, { interactive: true });
        expect(renderCanvasDrawingPicture).toHaveBeenLastCalledWith(note);
        expect($empty.hasClass("no-preview")).toBe(true);
        expect($empty.find(".bx-pen").length).toBe(1);
    });
});

describe("Mermaid diagram attachments", () => {
    it("draws the diagram before returning where it is not interactive, and mounts it where it is", async () => {
        const att = buildAttachment({ role: "file", mime: "text/vnd.mermaid" });
        att.getBlob = async () => ({ content: "graph TD;" }) as never;

        const { type, $renderedContent } = await getRenderedContent(att);
        expect(type).toBe("mermaidDiagram");
        expect(renderMermaidSvg).toHaveBeenCalledWith("graph TD;");
        expect($renderedContent.find("svg.mock-mermaid-svg").length).toBe(1);
        expect(mermaidDiagramComponent).not.toHaveBeenCalled();

        const { $renderedContent: $live } = await getRenderedContent(att, { interactive: true });
        expect($live.find(".mock-mermaid-diagram-marker").length).toBe(1);
        expect(mermaidDiagramComponent.mock.calls[0][0].content).toBe("graph TD;");
        disposeInteractiveContent($live);
    });
});

describe("interactive content disposal", () => {
    it("tags an interactive mount and disposes it, unmounting the widget", async () => {
        const note = buildNote({ title: "WI", type: "webView", "#webViewSrc": "https://example.com" });
        const { $renderedContent } = await getRenderedContent(note, { interactive: true });

        const mount = $renderedContent.find("[data-interactive-mount]");
        expect(mount.length).toBe(1);
        expect(mount.find(".mock-webview-marker").length).toBe(1);

        disposeInteractiveContent($renderedContent);
        // render(null, ...) unmounted the widget, clearing the mount's rendered tree.
        expect(mount.find(".mock-webview-marker").length).toBe(0);
    });

    it("is a no-op for content with no interactive mounts", async () => {
        const note = buildNote({ title: "T", type: "text" });
        const { $renderedContent } = await getRenderedContent(note);
        expect($renderedContent.find("[data-interactive-mount]").length).toBe(0);
        expect(() => disposeInteractiveContent($renderedContent)).not.toThrow();
    });

    it("runs every registered disposer once, the root's own included", () => {
        const $root = $("<div>");
        const child = $("<div>").appendTo($root)[0];
        const disposers = [ vi.fn(), vi.fn(), vi.fn() ];
        addContentDisposer($root[0], disposers[0]);
        addContentDisposer(child, disposers[1]);
        addContentDisposer(child, disposers[2]);

        disposeInteractiveContent($root);
        disposeInteractiveContent($root);
        for (const dispose of disposers) {
            expect(dispose).toHaveBeenCalledTimes(1);
        }
    });

    it("snapshots the markup without the markers before disposing of the content", async () => {
        const { $renderedContent } = await getRenderedContent(buildChatNote([ "Hi" ]));
        const dispose = vi.fn();
        addContentDisposer($renderedContent[0], dispose);

        const chat = "<span class=\"mock-chat-marker\">messages:1</span>";
        expect(snapshotAndDispose($renderedContent))
            .toBe(`<div class="note-detail-llm-chat-preview">${chat}</div>`);
        expect(dispose).toHaveBeenCalledTimes(1);
        expect($renderedContent.find(".mock-chat-marker").length).toBe(0);
    });
});

describe("defensive guards for entities that are neither FNote nor FAttachment", () => {
    // These exercise branches that production never hits (the static type is FNote | FAttachment),
    // but the runtime code keeps defensive `instanceof` fallbacks. We feed crafted duck-typed objects.

    it("image rendering falls back to an empty src url and skips the FNote-only fallback block", async () => {
        const fake = { role: "image", title: "Fake", isProtected: false, mime: "image/png" } as any;
        const { type, $renderedContent } = await getRenderedContent(fake);
        expect(type).toBe("image");
        expect($renderedContent.find("img").attr("src")).toBe("");
        // final `entity instanceof FNote` is false -> no no-preview / css class added
        expect($renderedContent.hasClass("no-preview")).toBe(false);
    });

    it("file rendering throws for an unrecognized entity type", async () => {
        const fake = { role: "file", title: "Fake", isProtected: false, mime: "audio/mpeg" } as any;
        await expect(getRenderedContent(fake)).rejects.toThrow(/Can't recognize entity type/);
    });

    it("rendering type defaults to empty when the entity has neither type nor role", async () => {
        const fake = { title: "Fake", isProtected: false } as any;
        const { type } = await getRenderedContent(fake);
        expect(type).toBe("");
    });
});

describe("getRenderingType detection", () => {
    it("classifies an attachment by its role", async () => {
        const att = buildAttachment({ role: "image" });
        expect((await getRenderedContent(att)).type).toBe("image");
    });

    it("renders an importSource attachment like a file", async () => {
        const html = buildAttachment({ role: "importSource", mime: "text/html" });
        html.getBlob = (async () => ({ content: "<p></p>" })) as any;
        const zip = buildAttachment({ role: "importSource", mime: "application/zip" });
        expect((await getRenderedContent(html)).type).toBe("code");
        expect((await getRenderedContent(zip)).type).toBe("file");
    });

    it("returns the raw role of an attachment with no branch, drawn as an icon", async () => {
        const att = buildAttachment({ role: "unknownRole" });
        const { type, $renderedContent } = await getRenderedContent(att);
        expect(type).toBe("unknownRole");
        expect($renderedContent.hasClass("no-preview")).toBe(true);
        expect($renderedContent.find("span").attr("class"))
            .toBe(attachmentIcon(att.role, att.mime));
    });

    it("maps json file notes to code unless tagged as an icon pack", async () => {
        const jsonFile = buildNote({ title: "cfg", type: "file" });
        jsonFile.mime = "application/json";
        expect((await getRenderedContent(jsonFile)).type).toBe("code");

        const viewConfig = buildNote({ title: "vc" });
        viewConfig.type = "viewConfig" as any;
        viewConfig.mime = "application/json";
        expect((await getRenderedContent(viewConfig)).type).toBe("code");

        const iconPack = buildNote({ title: "icons", type: "file", "#iconPack": "" });
        iconPack.mime = "application/json";
        iconPack.getBlob = (async () => ({ content: "{}" })) as any;
        // Tagged as an icon pack -> renders the glyph-grid preview, not raw file/code content.
        expect((await getRenderedContent(iconPack)).type).toBe("iconPack");
    });
});
