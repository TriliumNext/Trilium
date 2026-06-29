import { describe, expect, it } from "vitest";

import { buildNoteIndex, resolveLinks } from "./links.js";

/** Builds a note index from `path -> noteId` pairs, mirroring how the importer feeds created notes in. */
function indexOf(entries: Record<string, string>) {
    return buildNoteIndex(Object.entries(entries).map(([path, noteId]) => ({ note: { noteId }, path })));
}

describe("buildNoteIndex", () => {
    it("indexes by lower-cased path (sans .md) and by unique base name", () => {
        const index = indexOf({ "Folder/Target.md": "id1", "Other.md": "id2" });
        expect(index.byPath.get("folder/target")).toBe("id1");
        expect(index.byPath.get("other")).toBe("id2");
        expect(index.byName.get("target")).toBe("id1");
    });

    it("marks a base name shared by two notes as ambiguous (null)", () => {
        const index = indexOf({ "A/Note.md": "id1", "B/Note.md": "id2" });
        expect(index.byName.get("note")).toBeNull();
        // The fully-qualified paths still resolve unambiguously.
        expect(index.byPath.get("a/note")).toBe("id1");
        expect(index.byPath.get("b/note")).toBe("id2");
    });
});

describe("resolveLinks", () => {
    const index = indexOf({ "Folder/Target.md": "id1", "Other.md": "id2", "A/Note.md": "id3", "B/Note.md": "id4" });

    it("returns the html untouched when there is no vault-relative link or embed", () => {
        const html = `<p>plain <a class="reference-link" href="#root/x">existing</a></p>`;
        const result = resolveLinks(html, index);
        expect(result).toEqual({ html, internalLinks: [], includeLinks: [] });
    });

    it("rewrites a bare wikilink to a #root reference link and records the backlink", () => {
        const { html, internalLinks } = resolveLinks(`<p><a class="reference-link" href="/Other">Other</a></p>`, index);
        expect(html).toBe(`<p><a class="reference-link" href="#root/id2">Other</a></p>`);
        expect(internalLinks).toEqual(["id2"]);
    });

    it("resolves a path-qualified target and a #heading suffix to the same note", () => {
        expect(resolveLinks(`<a class="reference-link" href="/Folder/Target">x</a>`, index).internalLinks).toEqual(["id1"]);
        expect(resolveLinks(`<a class="reference-link" href="/Folder/Target#section">x</a>`, index).internalLinks).toEqual(["id1"]);
    });

    it("turns an aliased wikilink into a plain link carrying the alias text", () => {
        const { html, internalLinks } = resolveLinks(`<a class="reference-link" href="/Other|Display Name">x</a>`, index);
        expect(html).toBe(`<a href="#root/id2">Display Name</a>`);
        expect(internalLinks).toEqual(["id2"]);
    });

    it("unwraps an unresolved wikilink to plain text (target, or the alias when present)", () => {
        expect(resolveLinks(`<p><a class="reference-link" href="/Missing">Missing</a></p>`, index).html).toBe("<p>Missing</p>");
        expect(resolveLinks(`<p><a class="reference-link" href="/Missing|Shown">x</a></p>`, index).html).toBe("<p>Shown</p>");
    });

    it("unwraps an ambiguous base-name link (a name shared by 2+ notes is never guessed)", () => {
        const { html, internalLinks } = resolveLinks(`<p><a class="reference-link" href="/Note">Note</a></p>`, index);
        expect(html).toBe("<p>Note</p>");
        expect(internalLinks).toEqual([]);
    });

    it("unwraps a wikilink whose target is empty (e.g. a bare #heading link)", () => {
        const { html, internalLinks } = resolveLinks(`<p><a class="reference-link" href="/#section">x</a></p>`, index);
        expect(html).toBe("<p></p>");
        expect(internalLinks).toEqual([]);
    });

    it("skips embeds whose src is missing or not vault-relative even when another link forces a pass", () => {
        // A resolvable wikilink makes resolveLinks parse the html; the img loop must still skip these two.
        const html = `<a class="reference-link" href="/Other">o</a><img><img src="api/attachments/z.png">`;
        const { html: out, includeLinks } = resolveLinks(html, index);
        expect(out).toBe(`<a class="reference-link" href="#root/id2">o</a><img><img src="api/attachments/z.png">`);
        expect(includeLinks).toEqual([]);
    });

    it("leaves anchors that aren't wikilink placeholders alone", () => {
        // No reference-link class, and an already-rewritten attachment href (#root/…), are both skipped.
        const html = `<a href="/Other">plain markdown link</a><a class="reference-link" href="#root/id2">attachment</a>`;
        expect(resolveLinks(html, index)).toEqual({ html, internalLinks: [], includeLinks: [] });
    });

    it("recovers gracefully from an undecodable href and treats it as unresolved", () => {
        // A malformed percent-escape makes decodeURIComponent throw; safeDecode falls back to the raw value.
        const { html, internalLinks } = resolveLinks(`<p><a class="reference-link" href="/%E0%A4">x</a></p>`, index);
        expect(html).toBe("<p>%E0%A4</p>");
        expect(internalLinks).toEqual([]);
    });

    it("converts a resolved note embed into an include-note section and records the include", () => {
        const { html, includeLinks } = resolveLinks(`<p><img src="/Other"></p>`, index);
        expect(html).toBe(`<p><section class="include-note" data-note-id="id2" data-box-size="medium">&nbsp;</section></p>`);
        expect(includeLinks).toEqual(["id2"]);
    });

    it("drops an unsupported .base/.canvas embed, removing its now-empty wrapping paragraph", () => {
        expect(resolveLinks(`<p><img src="/Database.base"></p>`, index).html).toBe("");
        expect(resolveLinks(`<p><img src="/Board.canvas"></p>`, index).html).toBe("");
    });

    it("keeps the paragraph of an unsupported embed when it still holds other content", () => {
        const { html } = resolveLinks(`<p>see <img src="/Database.base"></p>`, index);
        expect(html).toBe("<p>see </p>");
    });

    it("leaves an unresolved, non-special embed in place for a later pass", () => {
        const html = `<p><img src="/Unknown.png"></p>`;
        expect(resolveLinks(html, index)).toEqual({ html, internalLinks: [], includeLinks: [] });
    });

    it("ignores an embed whose src is already an attachment URL (not vault-relative)", () => {
        const html = `<p><img src="api/attachments/x/image/y.png"></p>`;
        expect(resolveLinks(html, index)).toEqual({ html, internalLinks: [], includeLinks: [] });
    });
});
