import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock heavy / side-effecting collaborators BEFORE importing the SUT. ---
// content_renderer_text: renderText / postProcessRichContent / renderChildrenList
const renderText = vi.fn(async (...args: any[]) => {
    args[1].append($('<div class="from-render-text">'));
});
const postProcessRichContent = vi.fn(async (..._args: any[]) => {});
const renderChildrenList = vi.fn(async (..._args: any[]) => {});
vi.mock("./content_renderer_text.js", () => ({
    default: (...args: any[]) => renderText(...args),
    postProcessRichContent: (...args: any[]) => postProcessRichContent(...args),
    renderChildrenList: (...args: any[]) => renderChildrenList(...args)
}));

const renderDoc = vi.fn(async (..._args: any[]) => $('<div class="doc-html"><span>doc</span></div>'));
vi.mock("./doc_renderer.js", () => ({ default: (...args: any[]) => renderDoc(...args) }));

const renderServiceRender = vi.fn(async (...args: any[]) => {
    args[1].append($('<div class="render-ok">'));
});
vi.mock("./render.js", () => ({ default: { render: (...args: any[]) => renderServiceRender(...args) } }));

const applySingleBlockSyntaxHighlight = vi.fn(async (..._args: any[]) => {});
vi.mock("./syntax_highlight.js", () => ({
    applySingleBlockSyntaxHighlight: (...args: any[]) => applySingleBlockSyntaxHighlight(...args)
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

const loadElkIfNeeded = vi.fn(async (..._args: any[]) => {});
const postprocessMermaidSvg = vi.fn((...args: any[]) => `<svg class="mm">${args[0]}</svg>`);
vi.mock("./mermaid.js", () => ({
    loadElkIfNeeded: (...a: any[]) => loadElkIfNeeded(...a),
    postprocessMermaidSvg: (...a: any[]) => postprocessMermaidSvg(...a)
}));

// isOfficeMimeType comes (unmocked) from @triliumnext/commons; only the server
// round-trip is stubbed out.
const renderOfficeToHtml = vi.fn(async (..._args: any[]) => `<div class="office-doc">converted</div>`);
vi.mock("./office_renderer.js", () => ({
    renderOfficeToHtml: (...a: any[]) => renderOfficeToHtml(...a)
}));

const mermaidRender = vi.fn(async (..._args: any[]) => ({ svg: "<g/>" }));
const mermaidInitialize = vi.fn((..._args: any[]) => {});
vi.mock("mermaid", () => ({
    default: { mermaidAPI: { initialize: (...a: any[]) => mermaidInitialize(...a), render: (...a: any[]) => mermaidRender(...a) } }
}));

const pdfViewerComponent = vi.fn(() => null);
vi.mock("../widgets/type_widgets/file/PdfViewer", () => ({ default: pdfViewerComponent }));

// `addHook` is a no-op here: sanitize_content.ts registers a DOMPurify hook at
// module load (pulled in transitively), which would otherwise throw against this mock.
vi.mock("dompurify", () => ({ default: { sanitize: (s: string) => s, addHook: () => {} } }));

const renderToHtml = vi.fn((...args: any[]) => `<p>${args[0]}</p>`);
vi.mock("@triliumnext/commons", async (orig) => ({
    ...(await (orig() as Promise<object>)),
    renderToHtml: (...a: any[]) => renderToHtml(...a)
}));

// --- Imports AFTER the mocks. ---
import FAttachment from "../entities/fattachment.js";
import { buildNote } from "../test/easy-froca.js";
import froca from "./froca.js";
import { getRenderedContent as rawGetRenderedContent } from "./content_renderer.js";
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

beforeEach(() => {
    vi.clearAllMocks();
    isProtectedSessionAvailable.mockReturnValue(false);
    (window as any).electronApi = undefined;
});

describe("getRenderedContent dispatch", () => {
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
        expect(applySingleBlockSyntaxHighlight).toHaveBeenCalledOnce();
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

    it("renders an audio file note", async () => {
        const note = buildNote({ title: "A", type: "file" });
        note.mime = "audio/mpeg";
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("audio");
        expect($renderedContent.find("audio").attr("src")).toBe(getUrlForDownload(`api/notes/${note.noteId}/open-partial`));
    });

    it("renders a video file note", async () => {
        const note = buildNote({ title: "V", type: "file" });
        note.mime = "video/mp4";
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("video");
        expect($renderedContent.find("video").length).toBe(1);
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
        expect(renderOfficeToHtml).toHaveBeenCalledWith("notes", note.noteId);
        expect($renderedContent.find(".office-preview-body").html()).toContain("converted");
        // the file remains downloadable / openable
        expect($renderedContent.find(".file-download").length).toBe(1);
        expect($renderedContent.find(".file-open").length).toBe(1);
    });

    it("shows an admonition (and drops the preview body) when conversion fails", async () => {
        renderOfficeToHtml.mockRejectedValueOnce(new Error("bad zip"));
        const note = buildNote({ title: "DocBad", type: "file" });
        note.mime = "application/vnd.oasis.opendocument.text";
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("office");
        expect($renderedContent.find(".admonition.caution").length).toBe(1);
        expect($renderedContent.find(".office-preview-body").length).toBe(0);
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
        expect(renderOfficeToHtml).toHaveBeenCalledWith("attachments", att.attachmentId);
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

    it("render error callback shows an admonition with the error message", async () => {
        renderServiceRender.mockImplementationOnce(async (_n: any, $content: any, onError: any) => {
            onError(new Error("kaput"));
        });
        const note = buildNote({ title: "RErr", type: "render" });
        const { $renderedContent } = await getRenderedContent(note);
        const $err = $renderedContent.find(".admonition.caution");
        expect($err.length).toBe(1);
        expect($err.text()).toContain("kaput");
    });

    it("render error callback accepts a string error directly", async () => {
        renderServiceRender.mockImplementationOnce(async (_n: any, $content: any, onError: any) => {
            onError("plain-string-error");
        });
        const note = buildNote({ title: "RErrStr", type: "render" });
        const { $renderedContent } = await getRenderedContent(note);
        expect($renderedContent.find(".admonition.caution").text()).toBe("plain-string-error");
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

    it("renders a mermaid diagram and post-processes the svg", async () => {
        const note = buildNote({ title: "M", type: "mermaid", content: "graph TD; A-->B" });
        const { type, $renderedContent } = await getRenderedContent(note);
        expect(type).toBe("mermaid");
        expect(mermaidInitialize).toHaveBeenCalledOnce();
        expect(loadElkIfNeeded).toHaveBeenCalledOnce();
        expect(postprocessMermaidSvg).toHaveBeenCalledWith("<g/>");
        expect($renderedContent.find("svg.mm").length).toBe(1);
    });

    it("renders a mermaid error message when rendering throws", async () => {
        mermaidRender.mockRejectedValueOnce(new Error("bad diagram"));
        const note = buildNote({ title: "MErr", type: "mermaid", content: "bogus" });
        const { $renderedContent } = await getRenderedContent(note);
        expect($renderedContent.find("p").length).toBe(1);
        expect(postprocessMermaidSvg).not.toHaveBeenCalled();
    });

    it("handles a mermaid note with no blob content", async () => {
        const note = buildNote({ title: "MEmpty", type: "mermaid" });
        note.getBlob = (async () => null) as any;
        const { type } = await getRenderedContent(note);
        expect(type).toBe("mermaid");
        expect(mermaidRender).toHaveBeenCalled();
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

    it("returns the raw role for an attachment with an unhandled role (no rendering branch)", async () => {
        const att = buildAttachment({ role: "unknownRole" });
        const { type, $renderedContent } = await getRenderedContent(att);
        expect(type).toBe("unknownRole");
        // attachment falls through to the final `entity instanceof FNote` check (false) -> empty content
        expect($renderedContent.hasClass("no-preview")).toBe(false);
        expect($renderedContent.children().length).toBe(0);
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
        // iconPack stays a file -> renders as a generic file (not tooltip), so type === file
        expect((await getRenderedContent(iconPack)).type).toBe("file");
    });
});
