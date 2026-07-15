import { render } from "preact";
import { describe, expect, it, vi } from "vitest";

// The real hooks module drags in the app context/bootstrap; the gallery only needs the event
// subscription, which the tests exercise through the extracted refresh predicates instead.
vi.mock("../hooks", () => ({ useTriliumEvent: () => {} }));

import type NoteContext from "../../../components/note_context";
import FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import type LoadResults from "../../../services/load_results";
import { buildNote } from "../../../test/easy-froca";
import {
    attachmentGalleryShouldRefresh,
    buildAttachmentGalleryItems,
    buildNoteGalleryItems,
    noteGalleryShouldRefresh,
    useImageAttachmentGallery,
    useImageNoteGallery
} from "./gallery";

function buildImageNote(id: string, title: string, blobId = `blob-${id}`) {
    const note = buildNote({ id, title, type: "image" });
    note.blobId = blobId;
    note.mime = "image/png";
    return note;
}

function buildImageAttachment(attachmentId: string, title: string, role = "image", utcDateModified = "2026-01-02 03:04:05Z") {
    return new FAttachment(froca, {
        attachmentId,
        ownerId: "owner",
        role,
        mime: "image/png",
        title,
        dateModified: utcDateModified,
        utcDateModified,
        utcDateScheduledForErasureSince: "",
        contentLength: 42
    });
}

describe("buildNoteGalleryItems", () => {
    it("maps image siblings to ordered items with versioned srcs, keeping the current note in place", () => {
        const a = buildImageNote("na", "First");
        const b = buildImageNote("nb", "Second");
        const items = buildNoteGalleryItems([ a, b ], a);

        expect(items.map((item) => item.id)).toEqual([ "na", "nb" ]);
        expect(items[0]).toEqual({
            id: "na",
            title: "First",
            src: "api/images/na/First?v=blob-na",
            kind: "note",
            mime: "image/png"
        });
    });

    it("keeps only available image notes (drops other types and protected-without-session siblings)", () => {
        const current = buildImageNote("nc", "Current");
        const textSibling = buildNote({ id: "nt", title: "Text", type: "text" });
        const protectedSibling = buildImageNote("np", "Locked");
        protectedSibling.isProtected = true;

        const items = buildNoteGalleryItems([ textSibling, current, protectedSibling ], current);
        expect(items.map((item) => item.id)).toEqual([ "nc" ]);
    });

    it("falls back to a single-item gallery when the current note is not among the candidates", () => {
        const current = buildImageNote("nx", "Lone");
        const items = buildNoteGalleryItems([], current);
        expect(items.map((item) => item.id)).toEqual([ "nx" ]);
        expect(items[0].src).toBe("api/images/nx/Lone?v=blob-nx");
    });

    it("URL-encodes the title used as the src filename", () => {
        const current = buildImageNote("ne", "My Pic + 100%.png");
        const items = buildNoteGalleryItems([ current ], current);
        expect(items[0].src).toBe(`api/images/ne/${encodeURIComponent("My Pic + 100%.png")}?v=blob-ne`);
    });
});

describe("buildAttachmentGalleryItems", () => {
    it("keeps only attachments sharing the current attachment's role, with versioned srcs", () => {
        const first = buildImageAttachment("aa", "a.png");
        const file = buildImageAttachment("af", "notes.txt", "file");
        const second = buildImageAttachment("ab", "b.png");

        const items = buildAttachmentGalleryItems([ first, file, second ], "ab");
        expect(items.map((item) => item.id)).toEqual([ "aa", "ab" ]);
        expect(items[1]).toEqual({
            id: "ab",
            title: "b.png",
            src: `api/attachments/ab/image/${encodeURIComponent("b.png")}?v=${encodeURIComponent("2026-01-02 03:04:05Z")}`,
            kind: "attachment",
            mime: "image/png"
        });
    });

    it("is empty when the current attachment is not among the note's attachments", () => {
        const only = buildImageAttachment("ac", "c.png");
        expect(buildAttachmentGalleryItems([ only ], "missing")).toEqual([]);
    });
});

describe("refresh predicates", () => {
    const loadResults = (branchParentIds: string[], noteIds: string[], attachmentOwnerIds: string[] = []) => ({
        getBranchRows: () => branchParentIds.map((parentNoteId) => ({ parentNoteId })),
        getNoteIds: () => noteIds,
        getAttachmentRows: () => attachmentOwnerIds.map((ownerId) => ({ ownerId }))
    }) as unknown as LoadResults;

    it("note gallery refreshes when the parent's branches or a member note change", () => {
        expect(noteGalleryShouldRefresh(loadResults([ "parent" ], []), "parent", [ "na" ])).toBe(true);
        expect(noteGalleryShouldRefresh(loadResults([], [ "na" ]), "parent", [ "na" ])).toBe(true);
        expect(noteGalleryShouldRefresh(loadResults([ "other" ], [ "unrelated" ]), "parent", [ "na" ])).toBe(false);
    });

    it("attachment gallery refreshes only when the owning note's attachments change", () => {
        expect(attachmentGalleryShouldRefresh(loadResults([], [], [ "owner" ]), "owner")).toBe(true);
        expect(attachmentGalleryShouldRefresh(loadResults([], [], [ "somebody" ]), "owner")).toBe(false);
    });
});

type NoteGallery = ReturnType<typeof useImageNoteGallery>;

function renderNoteGalleryHarness(note: FNote, noteContext: NoteContext) {
    const latest: { gallery: NoteGallery | null } = { gallery: null };
    function Harness() {
        latest.gallery = useImageNoteGallery(note, noteContext);
        return null;
    }
    render(<Harness />, document.createElement("div"));
    return latest;
}

describe("useImageNoteGallery", () => {
    const makeNoteContext = (notePath: string) => {
        const setNote = vi.fn();
        return { noteContext: { notePath, setNote } as unknown as NoteContext, setNote };
    };

    it("seeds with the current note synchronously, then expands to the image siblings", async () => {
        buildNote({
            id: "gparent",
            title: "Parent",
            children: [
                { id: "g1", title: "One", type: "image" },
                { id: "gtext", title: "Doc", type: "text" },
                { id: "g2", title: "Two", type: "image" }
            ]
        });
        const current = froca.notes.g1;
        const { noteContext } = makeNoteContext("root/gparent/g1");

        const latest = renderNoteGalleryHarness(current, noteContext);
        // Synchronous seed: the current note is viewable before the sibling load resolves.
        expect(latest.gallery?.items.map((item) => item.id)).toEqual([ "g1" ]);
        expect(latest.gallery?.currentIndex).toBe(0);

        await vi.waitFor(() => expect(latest.gallery?.items.map((item) => item.id)).toEqual([ "g1", "g2" ]));
        expect(latest.gallery?.currentIndex).toBe(0);
        expect(latest.gallery?.surfaceKey).toContain("gparent");
    });

    it("navigates by wrapping through the gallery via noteContext.setNote", async () => {
        buildNote({
            id: "wparent",
            title: "Parent",
            children: [
                { id: "w1", title: "One", type: "image" },
                { id: "w2", title: "Two", type: "image" },
                { id: "w3", title: "Three", type: "image" }
            ]
        });
        const current = froca.notes.w2;
        const { noteContext, setNote } = makeNoteContext("root/wparent/w2");
        const latest = renderNoteGalleryHarness(current, noteContext);
        await vi.waitFor(() => expect(latest.gallery?.items).toHaveLength(3));

        latest.gallery?.navigateNext();
        expect(setNote).toHaveBeenLastCalledWith("root/wparent/w3");
        latest.gallery?.navigatePrevious();
        expect(setNote).toHaveBeenLastCalledWith("root/wparent/w1");
        latest.gallery?.navigateFirst();
        expect(setNote).toHaveBeenLastCalledWith("root/wparent/w1");
        latest.gallery?.navigateLast();
        expect(setNote).toHaveBeenLastCalledWith("root/wparent/w3");
        latest.gallery?.navigateToIndex(0);
        expect(setNote).toHaveBeenLastCalledWith("root/wparent/w1");
    });

    it("stays a single-item gallery without navigation when the note path has no parent", async () => {
        const lone = buildImageNote("lone1", "Lone");
        const { noteContext, setNote } = makeNoteContext("lone1");
        const latest = renderNoteGalleryHarness(lone, noteContext);

        await Promise.resolve();
        expect(latest.gallery?.items.map((item) => item.id)).toEqual([ "lone1" ]);
        latest.gallery?.navigateNext();
        latest.gallery?.navigatePrevious();
        expect(setNote).not.toHaveBeenCalled();
    });
});

describe("useImageAttachmentGallery", () => {
    it("cycles the note's same-role attachments through viewScope navigation", async () => {
        const owner = buildNote({ id: "aowner", title: "Owner" });
        const a1 = buildImageAttachment("at1", "one.png");
        const a2 = buildImageAttachment("at2", "two.png");
        owner.getAttachments = async () => [ a1, a2 ];

        const setNote = vi.fn();
        const noteContext = { notePath: "root/aowner", setNote } as unknown as NoteContext;
        const latest: { gallery: NoteGallery | null } = { gallery: null };
        function Harness() {
            latest.gallery = useImageAttachmentGallery(owner, noteContext, { viewMode: "attachments", attachmentId: "at1" });
            return null;
        }
        render(<Harness />, document.createElement("div"));

        await vi.waitFor(() => expect(latest.gallery?.items.map((item) => item.id)).toEqual([ "at1", "at2" ]));
        expect(latest.gallery?.currentIndex).toBe(0);

        latest.gallery?.navigateNext();
        expect(setNote).toHaveBeenLastCalledWith("root/aowner", { viewScope: { viewMode: "attachments", attachmentId: "at2" } });
    });
});
