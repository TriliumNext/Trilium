import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteMeta, NoteMetaFile } from "../../../meta.js";
import type { ZipArchive } from "../../zip_provider.js";
import HtmlExportProvider, { HtmlExportProviderOptions } from "./html.js";
import type { AdvancedExportOptions, ZipExportProviderData } from "./abstract_provider.js";

interface AppendCall {
    content: string | Uint8Array;
    name: string;
}

function buildArchive(calls: AppendCall[]): ZipArchive {
    return {
        append: (content, options) => calls.push({ content, name: options.name }),
        pipe: vi.fn(),
        finalize: vi.fn()
    };
}

function buildProvider(
    overrides: {
        zipExportOptions?: AdvancedExportOptions;
        getNoteTargetUrl?: ZipExportProviderData["getNoteTargetUrl"];
        rewriteFn?: ZipExportProviderData["rewriteFn"];
        options?: HtmlExportProviderOptions;
    } = {}
) {
    const appendCalls: AppendCall[] = [];
    const data: ZipExportProviderData = {
        // The provider never touches the branch in this module.
        branch: {} as ZipExportProviderData["branch"],
        getNoteTargetUrl: overrides.getNoteTargetUrl ?? ((targetNoteId) => `${targetNoteId}.html`),
        archive: buildArchive(appendCalls),
        zipExportOptions: overrides.zipExportOptions,
        rewriteFn: overrides.rewriteFn ?? ((content) => content)
    };
    const provider = new HtmlExportProvider(data, overrides.options);
    return { provider, appendCalls };
}

function buildMetaFile(): NoteMetaFile {
    return { formatVersion: 1, appVersion: "1.0.0", files: [] };
}

describe("HtmlExportProvider", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe("prepareMeta", () => {
        it("registers navigation, index and style files in the meta", () => {
            const { provider } = buildProvider();
            const metaFile = buildMetaFile();

            provider.prepareMeta(metaFile);

            const dataFileNames = metaFile.files.map((f) => f.dataFileName);
            expect(dataFileNames).toEqual(["navigation.html", "index.html", "style.css"]);
            expect(metaFile.files.every((f) => f.noImport)).toBe(true);
        });

        it("skips extra files when skipExtraFiles is set", () => {
            const { provider } = buildProvider({ zipExportOptions: { skipExtraFiles: true } });
            const metaFile = buildMetaFile();

            provider.prepareMeta(metaFile);

            expect(metaFile.files).toHaveLength(0);
        });
    });

    describe("prepareContent", () => {
        it("wraps bare HTML content in a full template with escaped title and css path", () => {
            const rewriteFn = vi.fn((content: string, _noteMeta: NoteMeta) => content);
            const { provider } = buildProvider({ rewriteFn });
            const noteMeta: NoteMeta = {
                format: "html",
                notePath: ["root", "child", "leaf"]
            };

            const result = provider.prepareContent("A <b> & \"Title\"", "<p>Body</p>", noteMeta) as string;

            // notePath length 3 -> two "../" segments before style.css.
            expect(result).toContain('<link rel="stylesheet" href="../../style.css">');
            // Title is HTML-escaped in both the <title> and <h1>.
            expect(result).toContain("A &lt;b&gt; &amp; &quot;Title&quot;");
            expect(result).not.toContain("<b> &");
            expect(result).toContain('<base target="_parent">');
            // Content is pretty-printed, so the body markup is preserved (line layout may differ).
            expect(result).toContain('<div class="ck-content">');
            expect(result).toContain("<p>Body</p>");
            expect(result).toContain('<h1 data-trilium-h1>');
            // rewriteFn is applied to the final content.
            expect(rewriteFn).toHaveBeenCalledTimes(1);
            expect(rewriteFn.mock.calls[0][1]).toBe(noteMeta);
        });

        it("uses a bare style.css path for a top-level note (notePath length 1)", () => {
            const { provider } = buildProvider();
            const result = provider.prepareContent("T", "<p>x</p>", {
                format: "html",
                notePath: ["root"]
            }) as string;

            expect(result).toContain('<link rel="stylesheet" href="style.css">');
            expect(result).not.toContain("../style.css");
        });

        it("throws when notePath is missing for a templated HTML note", () => {
            const { provider } = buildProvider();

            expect(() => provider.prepareContent("T", "<p>x</p>", { format: "html" }))
                .toThrow("Missing note path.");
            expect(() => provider.prepareContent("T", "<p>x</p>", { format: "html", notePath: [] }))
                .toThrow("Missing note path.");
        });

        it("does not wrap content that already contains an <html> tag", () => {
            const rewriteFn = vi.fn((content: string) => content);
            const { provider } = buildProvider({ rewriteFn });
            const original = "<html><body>already wrapped</body></html>";

            const result = provider.prepareContent("T", original, {
                format: "html",
                notePath: ["root"]
            }) as string;

            // No injected template title/base element.
            expect(result).not.toContain('<base target="_parent">');
            expect(result).toContain("already wrapped");
            expect(rewriteFn).toHaveBeenCalledTimes(1);
        });

        it("does not wrap content when skipHtmlTemplate is set, but still rewrites", () => {
            const rewriteFn = vi.fn((content: string) => `${content}<!--rw-->`);
            const { provider } = buildProvider({
                zipExportOptions: { skipHtmlTemplate: true },
                rewriteFn
            });

            const result = provider.prepareContent("T", "<p>plain</p>", {
                format: "html",
                // notePath is not required when skipping the template.
            }) as string;

            expect(result).not.toContain('<base target="_parent">');
            expect(result).toContain("<p>plain</p>");
            expect(result).toContain("<!--rw-->");
        });

        it("returns non-HTML content unchanged without invoking rewriteFn", () => {
            const rewriteFn = vi.fn((content: string) => content);
            const { provider } = buildProvider({ rewriteFn });

            const markdown = "# Heading";
            expect(provider.prepareContent("T", markdown, { format: "markdown" })).toBe(markdown);

            const binary = new Uint8Array([1, 2, 3]);
            expect(provider.prepareContent("T", binary, { format: "html" })).toBe(binary);

            expect(rewriteFn).not.toHaveBeenCalled();
        });

        it("does not pretty-print very large content but still wraps and rewrites it", () => {
            const rewriteFn = vi.fn((content: string) => content);
            const { provider } = buildProvider({ rewriteFn });
            const big = "<p>x</p>".repeat(20000); // well over the 100k pretty-print threshold

            const result = provider.prepareContent("T", big, {
                format: "html",
                notePath: ["root"]
            }) as string;

            expect(result).toContain('<base target="_parent">');
            expect(result.length).toBeGreaterThan(100_000);
            expect(rewriteFn).toHaveBeenCalledTimes(1);
        });
    });

    describe("afterDone", () => {
        function buildRootMeta(): NoteMeta {
            return {
                noteId: "root",
                title: "Root",
                dataFileName: "Root.html",
                children: [
                    {
                        noteId: "child1",
                        title: "Child <One>",
                        prefix: "P",
                        dataFileName: "Child.html",
                        children: []
                    },
                    {
                        // No dataFileName/noteId -> rendered as plain (escaped) text.
                        title: "Folder",
                        children: []
                    }
                ]
            };
        }

        it("appends navigation, index and css with rendered content", () => {
            const { provider, appendCalls } = buildProvider({
                getNoteTargetUrl: (noteId) => `notes/${noteId}.html`,
                options: { contentCss: "body { color: red; }" }
            });
            provider.prepareMeta(buildMetaFile());

            provider.afterDone(buildRootMeta());

            const byName = Object.fromEntries(
                appendCalls.map((c) => [c.name, c.content as string])
            );
            expect(Object.keys(byName).sort()).toEqual(["index.html", "navigation.html", "style.css"]);

            // Navigation links every note with a dataFileName + noteId, escapes titles & prefixes.
            expect(byName["navigation.html"]).toContain('href="notes/root.html"');
            expect(byName["navigation.html"]).toContain('href="notes/child1.html"');
            expect(byName["navigation.html"]).toContain("P - Child &lt;One&gt;");
            expect(byName["navigation.html"]).toContain("Folder");

            // Index frameset points at the first non-empty note's target URL.
            expect(byName["index.html"]).toContain("<frameset");
            expect(byName["index.html"]).toContain('src="notes/root.html"');

            // CSS is taken verbatim from options.contentCss.
            expect(byName["style.css"]).toBe("body { color: red; }");
        });

        it("omits the css file when no contentCss is provided", () => {
            const { provider, appendCalls } = buildProvider();
            provider.prepareMeta(buildMetaFile());

            provider.afterDone(buildRootMeta());

            expect(appendCalls.map((c) => c.name).sort()).toEqual(["index.html", "navigation.html"]);
        });

        it("throws when meta was never prepared", () => {
            const { provider } = buildProvider();

            expect(() => provider.afterDone(buildRootMeta())).toThrow("Missing meta.");
        });

        it("does nothing when skipExtraFiles is set", () => {
            const { provider, appendCalls } = buildProvider({
                zipExportOptions: { skipExtraFiles: true }
            });
            provider.prepareMeta(buildMetaFile());

            provider.afterDone(buildRootMeta());

            expect(appendCalls).toHaveLength(0);
        });
    });
});
