import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteMeta, NoteMetaFile } from "../../../meta.js";
import type { ZipArchive } from "../../zip_provider.js";
import type { ZipExportProviderData } from "./abstract_provider.js";
import MarkdownExportProvider from "./markdown.js";

function buildArchive(): ZipArchive {
    return {
        append: vi.fn(),
        pipe: vi.fn(),
        finalize: vi.fn()
    };
}

function buildProvider(
    overrides: {
        rewriteFn?: ZipExportProviderData["rewriteFn"];
    } = {}
) {
    const data: ZipExportProviderData = {
        // The provider never touches the branch in this module.
        branch: {} as ZipExportProviderData["branch"],
        getNoteTargetUrl: (targetNoteId) => `${targetNoteId}.md`,
        archive: buildArchive(),
        zipExportOptions: undefined,
        rewriteFn: overrides.rewriteFn ?? ((content) => content)
    };
    return new MarkdownExportProvider(data);
}

describe("MarkdownExportProvider", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe("prepareContent", () => {
        it("rewrites, converts HTML to markdown and prepends a title heading", async () => {
            const rewriteFn = vi.fn((content: string, _noteMeta: NoteMeta) => content);
            const provider = buildProvider({ rewriteFn });
            const noteMeta: NoteMeta = { format: "markdown" };

            const result = await provider.prepareContent("My Note", "<p>Hello <b>world</b></p>", noteMeta) as string;

            // rewriteFn is applied once with the original note meta.
            expect(rewriteFn).toHaveBeenCalledTimes(1);
            expect(rewriteFn.mock.calls[0][1]).toBe(noteMeta);
            // HTML was turned into markdown (bold becomes **world**) and the title heading prepended.
            expect(result.startsWith("# My Note\r\n")).toBe(true);
            expect(result).toContain("Hello **world**");
            expect(result).not.toContain("<p>");
        });

        it("does not prepend a title when the converted content already starts with a heading", async () => {
            const provider = buildProvider();

            const result = await provider.prepareContent("Ignored", "<h1>Existing Heading</h1>", {
                format: "markdown"
            }) as string;

            // toMarkdown renders the h1 as "# Existing Heading"; no extra "# Ignored" prefix.
            expect(result).toBe("# Existing Heading");
            expect(result.startsWith("# Ignored")).toBe(false);
        });

        it("does not prepend a title when the converted content is blank", async () => {
            const provider = buildProvider();

            // Empty / whitespace-only HTML converts to an empty (trimmed) string.
            const result = await provider.prepareContent("Empty", "   ", { format: "markdown" }) as string;

            expect(result.includes("# Empty")).toBe(false);
            expect(result.trim().length).toBe(0);
        });

        it("returns non-markdown string content unchanged without rewriting or converting", async () => {
            const rewriteFn = vi.fn((content: string) => content);
            const provider = buildProvider({ rewriteFn });

            const html = "<p>untouched</p>";
            expect(await provider.prepareContent("T", html, { format: "html" })).toBe(html);
            expect(await provider.prepareContent("T", html, {})).toBe(html);

            expect(rewriteFn).not.toHaveBeenCalled();
        });

        it("returns binary content unchanged even when the format is markdown", async () => {
            const rewriteFn = vi.fn((content: string) => content);
            const provider = buildProvider({ rewriteFn });
            const binary = new Uint8Array([1, 2, 3]);

            expect(await provider.prepareContent("T", binary, { format: "markdown" })).toBe(binary);
            expect(rewriteFn).not.toHaveBeenCalled();
        });

        it("applies the link rewrite before the markdown conversion", async () => {
            // rewriteFn receives the raw HTML, so it can inject markup that toMarkdown then converts.
            const rewriteFn = vi.fn((_content: string) => "<p><em>rewritten</em></p>");
            const provider = buildProvider({ rewriteFn });

            const result = await provider.prepareContent("Title", "<p>original</p>", {
                format: "markdown"
            }) as string;

            expect(result).toContain("_rewritten_");
            expect(result).not.toContain("original");
            expect(result.startsWith("# Title")).toBe(true);
        });
    });

    describe("prepareMeta / afterDone", () => {
        it("are inert and never touch the archive or meta", () => {
            const provider = buildProvider();
            const metaFile: NoteMetaFile = { formatVersion: 1, appVersion: "1.0.0", files: [] };
            const rootMeta: NoteMeta = { noteId: "root", title: "Root", children: [] };

            expect(() => provider.prepareMeta()).not.toThrow();
            expect(() => provider.afterDone()).not.toThrow();

            expect(metaFile.files).toHaveLength(0);
            expect(rootMeta.children).toHaveLength(0);
            expect(provider.archive.append).not.toHaveBeenCalled();
        });
    });
});
