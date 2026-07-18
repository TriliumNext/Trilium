import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import searchService from "./search.js";
import server from "./server.js";

describe("search service", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("searchForNoteIds encodes the search string in the URL and returns the server result", async () => {
        const get = vi.fn(async () => ["id1", "id2"]);
        server.get = get as typeof server.get;

        const result = await searchService.searchForNoteIds("a b & #c");

        expect(get).toHaveBeenCalledWith(`search/${encodeURIComponent("a b & #c")}`);
        expect(result).toEqual(["id1", "id2"]);
    });

    it("searchForNotes resolves the returned ids into froca notes", async () => {
        const noteA = buildNote({ title: "Note A" });
        const noteB = buildNote({ title: "Note B" });

        const get = vi.fn(async () => [noteA.noteId, noteB.noteId]);
        server.get = get as typeof server.get;

        const notes = await searchService.searchForNotes("query");

        expect(get).toHaveBeenCalledWith(`search/${encodeURIComponent("query")}`);
        expect(notes.map((n) => n.noteId)).toEqual([noteA.noteId, noteB.noteId]);
    });

    it("searchForNotes returns an empty array when no ids match", async () => {
        server.get = vi.fn(async () => []) as typeof server.get;

        const notes = await searchService.searchForNotes("nothing");

        expect(notes).toEqual([]);
    });
});
