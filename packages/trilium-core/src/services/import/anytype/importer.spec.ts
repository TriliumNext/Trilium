import { describe, expect, it } from "vitest";

import { anytypeDate, collectionTitleFromFileName, isPage, isSingleCollectionExport, parseObject } from "./importer.js";
import type { AnytypeBlock, AnytypeMark, AnytypeSnapshot } from "./model.js";

/** Wraps blocks + details into the export's snapshot shape. Details accepts arbitrary relation-key entries
 * (property values are keyed by the relation's hex `relationKey`). */
function snapshot(
    blocks: AnytypeBlock[],
    details: { id?: string; name?: string; layout?: number; resolvedLayout?: number; createdDate?: number; lastModifiedDate?: number; links?: string[]; [key: string]: unknown },
    sbType = "Page"
): AnytypeSnapshot {
    return { sbType, snapshot: { data: { blocks, details } } };
}

/** A text block with the given style (defaults to Paragraph), optional children and optional marks. */
function textBlock(id: string, text: string, style = "Paragraph", childrenIds: string[] = [], marks: AnytypeMark[] = []): AnytypeBlock {
    return { id, text: { text, style, marks: { marks } }, childrenIds };
}

/** A typical page: a root block pointing at the header chrome plus the given content block ids. */
function page(name: string, contentBlocks: AnytypeBlock[], layout = 0): AnytypeSnapshot {
    return snapshot(
        [
            { id: "obj", childrenIds: ["header", ...contentBlocks.map((b) => b.id)] },
            { id: "header", childrenIds: ["title"] },
            textBlock("title", "", "Title"),
            ...contentBlocks
        ],
        { id: "obj", name, layout }
    );
}

/** An inline mark over a `[from, to)` range. */
function mark(from: number, to: number, type: string, param?: string): AnytypeMark {
    return { range: { from, to }, type, param };
}

describe("isPage", () => {
    it("accepts a basic-layout Page and rejects sets and system objects", () => {
        expect(isPage(page("A page", []))).toBe(true);
        // A set/collection is also sbType Page but layout 3.
        expect(isPage(page("A set", [], 3))).toBe(false);
        // Non-page smartblocks (participant, workspace, …) are excluded regardless of layout.
        expect(isPage(snapshot([], { id: "p", name: "Someone", layout: 19 }, "Participant"))).toBe(false);
        expect(isPage(snapshot([], { id: "w", layout: 10 }, "Workspace"))).toBe(false);
    });

    it("accepts a basic page that omits `layout` (single-object exports), falling back to resolvedLayout", () => {
        // Anytype drops `layout` when it's the default, carrying the value in resolvedLayout instead.
        expect(isPage(snapshot([], { id: "p", name: "Solo page", resolvedLayout: 0 }))).toBe(true);
        // With neither field present, a Page still defaults to basic.
        expect(isPage(snapshot([], { id: "p", name: "Bare page" }))).toBe(true);
        // resolvedLayout still excludes a set whose `layout` is likewise omitted.
        expect(isPage(snapshot([], { id: "s", name: "Solo set", resolvedLayout: 3 }))).toBe(false);
    });
});

describe("parseObject", () => {
    it("takes the title from details.name and falls back to a paragraph for an unrecognised style", () => {
        // Paragraph and any style we don't specially handle render as a plain <p>.
        const result = parseObject(page("My Page", [textBlock("b1", "First"), textBlock("b2", "Second", "FutureStyle")]));
        expect(result.id).toBe("obj");
        expect(result.title).toBe("My Page");
        expect(result.content).toBe("<p>First</p><p>Second</p>");
    });

    it("maps Anytype's three heading styles to Trilium's top heading levels (h2/h3/h4)", () => {
        // Labels and order taken from the "Formatting test" page: Header1/2/3 are Title/Heading/Subheading.
        const result = parseObject(
            page("Headings", [
                textBlock("b1", "Regular text", "Paragraph"),
                textBlock("b2", "Title", "Header1"),
                textBlock("b3", "Heading", "Header2"),
                textBlock("b4", "Subheading", "Header3")
            ])
        );
        expect(result.content).toBe("<p>Regular text</p><h2>Title</h2><h3>Heading</h3><h4>Subheading</h4>");
    });

    it("applies inline marks inside the block's tag", () => {
        const result = parseObject(page("Marks", [textBlock("b1", "Bold text", "Paragraph", [], [mark(0, 4, "Bold")])]));
        expect(result.content).toBe("<p><strong>Bold</strong> text</p>");
    });

    it("renders a Code-style block as a code block, preserving the language from fields.lang", () => {
        const codeBlock: AnytypeBlock = { id: "b1", text: { text: "int x;", style: "Code" }, fields: { lang: "clike" }, childrenIds: [] };
        const result = parseObject(page("Code", [codeBlock]));
        expect(result.content).toBe('<pre><code class="language-text-x-csrc">int x;</code></pre>');
    });

    it("walks nested blocks in document order (parent text before its children)", () => {
        const result = parseObject(page("Nested", [textBlock("b1", "Parent", "Paragraph", ["c1"]), textBlock("c1", "Child")]));
        expect(result.content).toBe("<p>Parent</p><p>Child</p>");
    });

    it("skips the header subtree and empty / non-text blocks", () => {
        const result = parseObject(
            page("Mixed", [
                textBlock("b1", "   "), // whitespace only
                { id: "b2", childrenIds: [] }, // a non-text block (e.g. a link/divider) carries no text
                textBlock("b3", "Real content")
            ])
        );
        expect(result.content).toBe("<p>Real content</p>");
    });

    it("falls back to 'Untitled' when the page has no name", () => {
        expect(parseObject(page("", [textBlock("b1", "body")])).title).toBe("Untitled");
        expect(parseObject(page("   ", [])).title).toBe("Untitled");
    });
});

describe("dates", () => {
    it("converts an Anytype detail timestamp (Unix seconds) to a Trilium UTC datetime string", () => {
        // Verbatim createdDate from the "Article 6 Electronic Contracts" page.
        expect(anytypeDate(1735632037)).toBe("2024-12-31 08:00:37.000Z");
    });

    it("treats a missing or non-positive timestamp as absent (system objects export 0)", () => {
        expect(anytypeDate(undefined)).toBeUndefined();
        expect(anytypeDate(0)).toBeUndefined();
        expect(anytypeDate(-5)).toBeUndefined();
        expect(anytypeDate(Number.NaN)).toBeUndefined();
    });

    it("carries a page's created and modified dates through parseObject", () => {
        const doc = snapshot([{ id: "obj", childrenIds: [] }], { id: "obj", name: "Dated", createdDate: 1735632037, lastModifiedDate: 1735632353 });
        const result = parseObject(doc);
        expect(result.dateCreated).toBe("2024-12-31 08:00:37.000Z");
        expect(result.dateModified).toBe("2024-12-31 08:05:53.000Z");
    });

    it("leaves both dates undefined when the page carries none", () => {
        const result = parseObject(page("Undated", [textBlock("b1", "body")]));
        expect(result.dateCreated).toBeUndefined();
        expect(result.dateModified).toBeUndefined();
    });
});

describe("single-collection export", () => {
    /** A page created inside `ctx` (the collection's id). */
    const member = (id: string, ctx?: string) => snapshot([{ id, childrenIds: [] }], { id, name: "", createdInContext: ctx });

    it("detects an export whose pages all share one createdInContext that is itself absent", () => {
        // A collection-scoped export ships only the members; the collection wrapper (their shared context) is gone.
        const pages = [member("m1", "coll"), member("m2", "coll"), member("m3", "coll")];
        expect(isSingleCollectionExport(pages, new Set(["m1", "m2", "m3"]))).toBe(true);
    });

    it("rejects when the shared context is present (a full export keeps the collection wrapper)", () => {
        const pages = [member("m1", "coll"), member("m2", "coll")];
        expect(isSingleCollectionExport(pages, new Set(["m1", "m2", "coll"]))).toBe(false);
    });

    it("rejects when the pages don't all share one context, when a page has none, and when there are no pages", () => {
        expect(isSingleCollectionExport([member("m1", "coll"), member("m2", "other")], new Set(["m1", "m2"]))).toBe(false);
        expect(isSingleCollectionExport([member("m1", "coll"), member("m2")], new Set(["m1", "m2"]))).toBe(false);
        expect(isSingleCollectionExport([], new Set())).toBe(false);
    });

    it("derives the root title from the export file name, dropping the extension", () => {
        expect(collectionTitleFromFileName("My custom collection.zip")).toBe("My custom collection");
        expect(collectionTitleFromFileName("noext")).toBe("noext");
    });
});
