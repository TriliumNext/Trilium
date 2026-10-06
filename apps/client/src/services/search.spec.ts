import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../components/component.js";
import { buildNote } from "../test/easy-froca";
import froca from "./froca.js";
import searchService from "./search.js";
import server from "./server.js";
import toast from "./toast.js";

describe("search service", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("searchForNoteIds uses a query parameter", async () => {
        const get = vi.fn(async () => ["id1", "id2"]);
        server.get = get as typeof server.get;

        const result = await searchService.searchForNoteIds("a/b & #c");

        expect(get).toHaveBeenCalledWith(`search?searchString=${encodeURIComponent("a/b & #c")}`);
        expect(result).toEqual(["id1", "id2"]);
    });

    it("searchForNotes resolves the returned ids into froca notes", async () => {
        const noteA = buildNote({ title: "Note A" });
        const noteB = buildNote({ title: "Note B" });

        const get = vi.fn(async () => [noteA.noteId, noteB.noteId]);
        server.get = get as typeof server.get;

        const notes = await searchService.searchForNotes("query");

        expect(get).toHaveBeenCalledWith(`search?searchString=${encodeURIComponent("query")}`);
        expect(notes.map((n) => n.noteId)).toEqual([noteA.noteId, noteB.noteId]);
    });

    it("searchInSubtree scopes the query to the ancestor and asks for tokens", async () => {
        const response = { searchResultNoteIds: ["id1"], highlightedTokens: [], error: null };
        const get = vi.fn(async () => response);
        server.get = get as typeof server.get;

        const result = await searchService.searchInSubtree("#done & task", "board1");

        expect(get).toHaveBeenCalledWith(
            `search?searchString=${encodeURIComponent("#done & task")}&ancestorNoteId=board1&includeTokens=true`);
        expect(result).toBe(response);
    });

    it("searchForNotes returns an empty array when no ids match", async () => {
        server.get = vi.fn(async () => []) as typeof server.get;

        const notes = await searchService.searchForNotes("nothing");

        expect(notes).toEqual([]);
    });

    it("runSearchNote returns the query's error, toasts a failed request and refreshes the tab", async () => {
        const component = new Component();
        const triggerEvent = vi.spyOn(component, "triggerEvent");
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});
        const loadSearchNote = vi.spyOn(froca, "loadSearchNote");

        loadSearchNote.mockResolvedValueOnce({ error: "Bad query" });
        expect(await searchService.runSearchNote(component, "search1", "ntx1")).toEqual({ error: "Bad query" });
        expect(loadSearchNote).toHaveBeenCalledWith("search1");

        loadSearchNote.mockResolvedValueOnce(undefined);
        expect(await searchService.runSearchNote(component, "search1", "ntx1")).toEqual({ error: undefined });
        expect(showError).not.toHaveBeenCalled();

        // `runSearchNote()` returns `undefined` after a failed request, so the caller keeps the query error.
        loadSearchNote.mockRejectedValueOnce(new Error("Network down"));
        expect(await searchService.runSearchNote(component, "search1", "ntx1")).toBeUndefined();
        expect(showError).toHaveBeenCalledWith("Network down");

        expect(triggerEvent).toHaveBeenCalledTimes(3);
        expect(triggerEvent).toHaveBeenCalledWith("searchRefreshed", { ntxId: "ntx1" });
    });
});
