import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (hoisted above imports) ---

// Default to a resolved promise: importing FNote's dependency graph calls `server.get(...).then(...)`
// at module load (e.g. keyboard_actions), so the mock must be thenable before any test runs.
const { get } = vi.hoisted(() => ({ get: vi.fn((): Promise<any> => Promise.resolve([])) }));

vi.mock("../services/server.js", () => ({
    default: { get }
}));

// The detached note stores the froca singleton but never calls it, so a bare stub is enough.
vi.mock("../services/froca.js", () => ({
    default: {}
}));

// Imports AFTER vi.mock calls.
import DeletedFNote from "./deleted_fnote.js";
import FNote from "./fnote.js";

const META = {
    noteId: "deletedabc12",
    title: "Deleted note",
    isProtected: false,
    type: "text",
    mime: "text/html",
    blobId: "blob123456"
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe("DeletedFNote", () => {
    it("load builds an instance that is interchangeable with a live FNote", async () => {
        get.mockResolvedValueOnce(META);

        const note = await DeletedFNote.load("deletedabc12");

        // Must satisfy `instanceof FNote` — content_renderer and the tooltip branch on it.
        expect(note).toBeInstanceOf(DeletedFNote);
        expect(note).toBeInstanceOf(FNote);
        expect(note?.noteId).toBe("deletedabc12");
        expect(note?.type).toBe("text");
        expect(note?.mime).toBe("text/html");
        expect(get).toHaveBeenCalledWith("deleted-notes/deletedabc12/metadata");
    });

    it("load returns null when the note is not previewable (server rejects)", async () => {
        get.mockRejectedValueOnce(new Error("404 Not Found"));

        expect(await DeletedFNote.load("gone12345678")).toBeNull();
    });

    it("getBlob fetches from the isolated deleted-content route", async () => {
        get.mockResolvedValueOnce(META);
        const note = await DeletedFNote.load("deletedabc12");

        get.mockResolvedValueOnce({
            blobId: "blob123456",
            content: "<p>gone but readable</p>",
            contentLength: 24,
            dateModified: "",
            utcDateModified: ""
        });
        const blob = await note?.getBlob();

        expect(get).toHaveBeenLastCalledWith("deleted-notes/deletedabc12/blob");
        expect(blob?.content).toBe("<p>gone but readable</p>");
    });

    it("getBlob returns null when the blob has already been erased", async () => {
        get.mockResolvedValueOnce(META);
        const note = await DeletedFNote.load("deletedabc12");

        get.mockRejectedValueOnce(new Error("404 Not Found"));

        expect(await note?.getBlob()).toBeNull();
    });

    it("reports no live tree path", async () => {
        get.mockResolvedValueOnce(META);
        const note = await DeletedFNote.load("deletedabc12");

        expect(note?.getBestNotePathString()).toBe("");
    });

    it("loadMany drops ids that aren't previewable and keeps request order", async () => {
        get
            .mockResolvedValueOnce(META)
            .mockRejectedValueOnce(new Error("404 Not Found"))
            .mockResolvedValueOnce({ ...META, noteId: "deleteddef34" });

        const notes = await DeletedFNote.loadMany(["deletedabc12", "gone12345678", "deleteddef34"]);

        expect(notes.map((note) => note.noteId)).toEqual(["deletedabc12", "deleteddef34"]);
    });
});
