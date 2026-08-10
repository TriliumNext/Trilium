import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const applySingleBlockSyntaxHighlight = vi.fn(async (_codeBlock: unknown, _normalizedMimeType: string) => {});
const isSyntaxHighlightEnabled = vi.fn(() => true);

vi.mock("../../services/syntax_highlight", () => ({
    applySingleBlockSyntaxHighlight,
    isSyntaxHighlightEnabled
}));

vi.mock("../../services/clipboard_ext", () => ({ copyTextWithToast: vi.fn() }));

// ActionButton drags in tooltips and command wiring that are irrelevant here.
vi.mock("../react/ActionButton", () => ({ default: () => <button class="code-block-copy" /> }));

// Stub the sibling previews (and the blob hook they feed on) so their service imports stay out of
// the module graph; the markers let FileTypeWidget's mime routing be asserted without rendering them.
vi.mock("../react/hooks", () => ({ useNoteBlob: vi.fn(() => null) }));
vi.mock("./file/MediaPreview", () => ({ default: () => <div class="media-preview-stub" /> }));
vi.mock("./file/Office", () => ({ default: () => <div class="office-preview-stub" /> }));
vi.mock("./file/Pdf", () => ({ default: () => <div class="pdf-preview-stub" /> }));

const { useNoteBlob } = await import("../react/hooks");
const { default: FileTypeWidget, TextPreview } = await import("./File");

let container: HTMLDivElement;

beforeEach(() => {
    // TextPreview's CodeBlock hands the <code> element to jQuery before delegating to the
    // highlighter; the identity wrapper is enough since the helper itself is mocked.
    (globalThis as unknown as { $: (el: unknown) => unknown }).$ = (el) => el;
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.clearAllMocks();
});

describe("FileTypeWidget", () => {
    const mount = (mime: string, noteContext?: unknown) => {
        const props = { note: { mime }, noteContext } as unknown as Parameters<typeof FileTypeWidget>[0];
        render(<FileTypeWidget {...props} />, container);
    };

    it("previews text content through TextPreview, forwarding the note's mime to the highlighter", async () => {
        vi.mocked(useNoteBlob).mockReturnValue({ content: "<ink/>" } as ReturnType<typeof useNoteBlob>);
        mount("application/inkml+xml");

        expect(container.querySelector("pre.file-preview-content > code")?.textContent).toBe("<ink/>");
        // The mime reached TextPreview: the +xml suffix resolves to the base XML syntax.
        await vi.waitFor(() => expect(applySingleBlockSyntaxHighlight).toHaveBeenCalledTimes(1));
        expect(applySingleBlockSyntaxHighlight.mock.calls[0][1]).toBe("text-xml");
    });

    it("routes non-text blobs by mime: PDF, media, and a no-preview fallback", () => {
        // mockReturnValue outlives clearAllMocks, so drop the previous test's text blob explicitly.
        vi.mocked(useNoteBlob).mockReturnValue(null);

        // PDF renders only when a note context is available to hand down.
        mount("application/pdf", {});
        expect(container.querySelector(".pdf-preview-stub")).not.toBeNull();

        mount("video/mp4");
        expect(container.querySelector(".media-preview-stub")).not.toBeNull();
        mount("audio/mpeg");
        expect(container.querySelector(".media-preview-stub")).not.toBeNull();

        mount("application/octet-stream");
        expect(container.querySelector(".media-preview-stub")).toBeNull();
        expect(container.querySelector(".alert")).not.toBeNull();
    });

    it("routes office documents to OfficePreview without fetching the blob", () => {
        vi.mocked(useNoteBlob).mockReturnValue(null);

        mount("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        expect(container.querySelector(".office-preview-stub")).not.toBeNull();
        // The preview is server-rendered — fetching the blob would download the file twice.
        expect(vi.mocked(useNoteBlob).mock.calls[0][0]).toBeNull();
    });

    it("prefers OfficePreview over the text branch for RTF, whose blob content is a string", () => {
        // text/rtf arrives as string content; without the office check running first it
        // would fall into the blob.content branch and render as raw markup.
        vi.mocked(useNoteBlob).mockReturnValue({ content: "{\\rtf1 raw}" } as ReturnType<typeof useNoteBlob>);

        mount("text/rtf");
        expect(container.querySelector(".office-preview-stub")).not.toBeNull();
        expect(container.querySelector("pre.file-preview-content")).toBeNull();
    });
});

describe("TextPreview", () => {
    it("renders the content as text in a code block and highlights it with the normalized MIME type", async () => {
        render(<TextPreview content={"<p>hello</p>"} mime="text/html" />, container);

        const code = container.querySelector("pre.file-preview-content > code");
        expect(code?.textContent).toBe("<p>hello</p>");
        // Rendered verbatim rather than parsed — no element was created from it.
        expect(container.querySelector("p")).toBeNull();

        await vi.waitFor(() => expect(applySingleBlockSyntaxHighlight).toHaveBeenCalledTimes(1));
        expect(applySingleBlockSyntaxHighlight.mock.calls[0][1]).toBe("text-html");
    });

    it("highlights structured-syntax suffixes (+xml, +json) as their base syntax", async () => {
        render(<TextPreview content={"<ink/>"} mime="application/inkml+xml" />, container);
        await vi.waitFor(() => expect(applySingleBlockSyntaxHighlight).toHaveBeenCalledTimes(1));
        expect(applySingleBlockSyntaxHighlight.mock.calls[0][1]).toBe("text-xml");

        render(null, container);
        render(<TextPreview content={"{}"} mime="application/fhir+json" />, container);
        await vi.waitFor(() => expect(applySingleBlockSyntaxHighlight).toHaveBeenCalledTimes(2));
        expect(applySingleBlockSyntaxHighlight.mock.calls[1][1]).toBe("application-json");
    });

    it("does not highlight without a MIME type, but still renders the content", () => {
        render(<TextPreview content={"plain"} />, container);

        expect(container.querySelector("pre.file-preview-content > code")?.textContent).toBe("plain");
        expect(applySingleBlockSyntaxHighlight).not.toHaveBeenCalled();
    });

    it("truncates oversized content, shows the size warning and drops the copy button", () => {
        render(<TextPreview content={"x".repeat(6000)} mime="text/plain" />, container);

        expect(container.querySelector("pre.file-preview-content > code")?.textContent).toHaveLength(5000);
        expect(container.querySelector(".alert")).not.toBeNull();
        // Copying only the visible half of the file would read as copying all of it.
        expect(container.querySelector(".code-block-copy")).toBeNull();
    });

    it("shows the copy button when the content fits the preview", () => {
        render(<TextPreview content={"short"} mime="text/plain" />, container);

        expect(container.querySelector(".alert")).toBeNull();
        expect(container.querySelector(".code-block-copy")).not.toBeNull();
    });
});
