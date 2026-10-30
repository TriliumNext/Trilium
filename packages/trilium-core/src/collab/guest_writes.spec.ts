import { describe, expect, it, vi } from "vitest";

import type BNote from "../becca/entities/bnote.js";
import { ValidationError } from "../errors.js";
import { getContext } from "../services/context.js";
import noteService from "../services/notes.js";
import {
    isGuestEditableNote, MAX_GUEST_CONTENT_LENGTH, sanitizeGuestContent, updateContentAsGuest,
    updateTitleAsGuest
} from "./guest_writes.js";

let counter = 0;

function createNote(content = "<p>hello</p>", type: "text" | "code" = "text"): BNote {
    counter++;
    return getContext().init(() => noteService.createNewNote({
        parentNoteId: "root",
        title: `guest-writes-spec-${counter}`,
        content,
        type,
        mime: type === "text" ? "text/html" : "text/plain"
    })).note;
}

describe("guest writes", () => {
    it("lets guests edit text notes only, and never a read-only one", () => {
        const text = createNote();
        const code = createNote("x = 1", "code");
        expect(isGuestEditableNote(text)).toBe(true);
        expect(isGuestEditableNote(code)).toBe(false);
        expect(() => getContext().init(() => updateContentAsGuest(code, "<p>x</p>", null))).toThrow(/text notes/);

        getContext().init(() => text.setLabel("readOnly"));
        expect(isGuestEditableNote(text)).toBe(false);
        expect(() => getContext().init(() => updateTitleAsGuest(text, "Renamed"))).toThrow(/text notes/);
    });

    it("sanitizes the content, keeps links, drops inline images and includes, and skips saveLinks", () => {
        const note = createNote();
        const dirty = [
            "<p>Hello <a href=\"https://example.com\">site</a></p>",
            "<script>alert(1)</script>",
            "<p><img src=\" DATA:image/png;base64,AAAA\"><img src=\"api/images/x/y.png\"></p>",
            "<section class=\"include-note\" data-note-id=\"abc\"></section>",
            "<p><a href=\"#root/xyz\">internal</a></p>"
        ].join("");

        const result = getContext().init(() => updateContentAsGuest(note, dirty, note.blobId ?? null));

        expect(result).toEqual({ ok: true, blobId: note.blobId });
        const saved = String(note.getContent());
        expect(saved).toContain("<a href=\"https://example.com\">site</a>");
        expect(saved).toContain("api/images/x/y.png");
        expect(saved).toContain("#root/xyz");
        expect(saved).not.toContain("<script");
        expect(saved).not.toContain("data:image");
        expect(saved).not.toContain("include-note");
        expect(note.getRelations("internalLink")).toEqual([]);
        expect(sanitizeGuestContent("<p>plain</p>")).toBe("<p>plain</p>");
        // An include in any element, as the share renders every `.include-note`.
        const includes = sanitizeGuestContent([
            "<figure class=\"include-note\" data-note-id=\"abc\"></figure>",
            "<div class=\"box include-note\" data-note-id=\"abc\"></div><p>kept</p>"
        ].join(""));
        expect(includes).not.toContain("include-note");
        expect(includes).toContain("<p>kept</p>");
        // A block's id, which block references link to, and an inline icon stay as they are.
        const marked = "<p data-trilium-block-id=\"b1\">a "
            + "<span class=\"tn-icon bx bx-star\"></span></p>";
        expect(sanitizeGuestContent(marked)).toBe(marked);
    });

    it("refuses a save over a newer version, and one past the size cap", () => {
        const note = createNote();
        const current = note.blobId ?? "";

        const stale = getContext().init(() => updateContentAsGuest(note, "<p>mine</p>", "olderBlobId"));
        expect(stale).toEqual({ ok: false, current: { blobId: current } });
        expect(String(note.getContent())).toBe("<p>hello</p>");

        // Without a base version, the save lands regardless.
        expect(getContext().init(() => updateContentAsGuest(note, "<p>mine</p>", null)).ok).toBe(true);
        expect(() => getContext().init(() =>
            updateContentAsGuest(note, "x".repeat(MAX_GUEST_CONTENT_LENGTH + 1), null)))
            .toThrow(ValidationError);
    });

    it("keeps a revision of source collab before a change to a note that is old enough", () => {
        const note = createNote();
        note.utcDateCreated = "2020-01-01 00:00:00.000Z";

        getContext().init(() => updateContentAsGuest(note, "<p>changed</p>", null));
        expect(getContext().init(() => updateTitleAsGuest(note, "  Renamed  "))).toEqual({ title: "Renamed" });

        const revisions = note.getRevisions();
        expect(revisions.length).toBeGreaterThanOrEqual(1);
        expect(revisions.map((revision) => revision.source)).toEqual(revisions.map(() => "collab"));
        expect(note.title).toBe("Renamed");
    });

    it("renames only to a plain title of a sensible length, and saves nothing for the same title", () => {
        const note = createNote();
        const save = vi.spyOn(note, "save");

        expect(() => getContext().init(() => updateTitleAsGuest(note, "   "))).toThrow(/title/);
        expect(() => getContext().init(() => updateTitleAsGuest(note, "x".repeat(1001)))).toThrow(/title/);
        expect(getContext().init(() => updateTitleAsGuest(note, note.title))).toEqual({ title: note.title });
        expect(save).not.toHaveBeenCalled();
    });
});
