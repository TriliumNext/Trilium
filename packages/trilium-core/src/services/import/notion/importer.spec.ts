import { describe, expect, it } from "vitest";

import { rewriteCollectionIncludes, rewriteLinks } from "./importer.js";
import type { LinkTarget } from "./model.js";

describe("rewriteLinks", () => {
    const resolveSubpage = (notionId: string): LinkTarget | null =>
        notionId === "386c5eca1b8b802a90d8d891c7e62cd5" ? { noteId: "noteABC", title: "Subpage" } : null;

    it("turns an internal page link whose text is the page title into a reference link", () => {
        const input = `<p><a href="Formatting%20test/Subpage%20386c5eca1b8b802a90d8d891c7e62cd5.html">Subpage</a></p>`;
        expect(rewriteLinks(input, resolveSubpage)).toBe(
            `<p><a href="#root/noteABC" class="reference-link">Subpage</a></p>`
        );
    });

    it("keeps a plain internal link (preserving custom text) when the text isn't the title", () => {
        const input = `<p>See <a href="Subpage%20386c5eca1b8b802a90d8d891c7e62cd5.html">this page</a>.</p>`;
        expect(rewriteLinks(input, resolveSubpage)).toBe(
            `<p>See <a href="#root/noteABC">this page</a>.</p>`
        );
    });

    it("leaves external links and unresolved internal links untouched", () => {
        const external = `<p><a href="https://triliumnotes.org/">Trilium</a></p>`;
        expect(rewriteLinks(external, resolveSubpage)).toBe(external);

        const unknown = `<p><a href="Other%20ffffffffffffffffffffffffffffffff.html">Other</a></p>`;
        expect(rewriteLinks(unknown, resolveSubpage)).toBe(unknown);
    });

    it("ignores a 32-hex id that appears only in the query/hash, not the page path", () => {
        // The path ('Page.html') carries no id; the id only appears in a query parameter.
        const input = `<p><a href="Page.html?ref=386c5eca1b8b802a90d8d891c7e62cd5">x</a></p>`;
        expect(rewriteLinks(input, resolveSubpage)).toBe(input);
    });

    it("leaves an anchor without an href untouched", () => {
        const input = `<p><a>plain</a></p>`;
        expect(rewriteLinks(input, resolveSubpage)).toBe(input);
    });

    it("does not throw on a malformed percent-encoded href", () => {
        const input = `<p><a href="%E0%A4%A.html">broken</a></p>`;
        expect(() => rewriteLinks(input, resolveSubpage)).not.toThrow();
        // Malformed encoding can't carry a resolvable id, so the link is left as-is.
        expect(rewriteLinks(input, resolveSubpage)).toBe(input);
    });
});

describe("rewriteCollectionIncludes", () => {
    const dbId = "38ac5eca1b8b808babeaf10c0980fa5b";
    const resolveDatabase = (notionId: string): LinkTarget | null =>
        notionId === dbId ? { noteId: "dbNote123", title: "Database title" } : null;

    it("resolves an inline-database placeholder to the imported collection note's id", () => {
        const input = `<p>Before</p><section class="include-note" data-notion-id="${dbId}" data-box-size="medium">&nbsp;</section><p>After</p>`;
        const output = rewriteCollectionIncludes(input, resolveDatabase);
        expect(output).toContain(`data-note-id="dbNote123"`);
        expect(output).toContain(`data-box-size="medium"`);
        expect(output).not.toContain("data-notion-id");
    });

    it("drops a placeholder whose database wasn't imported", () => {
        const input = `<p>x</p><section class="include-note" data-notion-id="ffffffffffffffffffffffffffffffff">&nbsp;</section>`;
        expect(rewriteCollectionIncludes(input, resolveDatabase)).toBe(`<p>x</p>`);
    });

    it("leaves an ordinary include-note (no placeholder id) untouched", () => {
        const input = `<section class="include-note" data-note-id="abc">&nbsp;</section>`;
        expect(rewriteCollectionIncludes(input, resolveDatabase)).toBe(input);
    });
});
