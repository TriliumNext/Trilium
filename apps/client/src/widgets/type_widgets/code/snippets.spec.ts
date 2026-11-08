import type { NoteType } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import type LoadResults from "../../../services/load_results";

vi.mock("../../../services/search.js", () => ({
    default: { searchForNotes: vi.fn() }
}));

import search from "../../../services/search.js";
import * as ws from "../../../services/ws.js";
import { buildNote } from "../../../test/easy-froca";
import {
    type CodeSnippet, getCodeSnippets, isCodeSnippetChange, isSnippetFor, snippetCommand
} from "./snippets.js";

interface NoteStub {
    noteId: string;
    title: string;
    type: string;
    mime: string;
    isArchived: boolean;
    isContentAvailable: () => boolean;
    getLabelValue: (name: string) => string | null;
    getContent: () => Promise<string | undefined>;
}

function makeNote(overrides: Partial<NoteStub> = {}): FNote {
    return {
        noteId: "note",
        title: "Snippet",
        type: "code",
        mime: "text/css",
        isArchived: false,
        isContentAvailable: () => true,
        getLabelValue: () => null,
        getContent: async () => "body",
        ...overrides
    } as unknown as FNote;
}

function makeLoadResults(opts: {
    attrs?: { type: string; name?: string; value?: string }[];
    noteIds?: string[];
} = {}): LoadResults {
    return {
        getAttributeRows: () => opts.attrs ?? [],
        getNoteIds: () => opts.noteIds ?? []
    } as unknown as LoadResults;
}

describe("isSnippetFor", () => {
    it("offers code of the same language, any Markdown to Markdown, and plain text to all", () => {
        const snippet = (mime: string, type: NoteType = "code") => (
            buildNote({ title: mime, type, mime })
        );
        const css = snippet("text/css");
        const markdown = snippet("text/markdown");
        const plain = snippet("text/plain");

        expect(isSnippetFor(css, "text/css")).toBe(true);
        expect(isSnippetFor(css, "text/x-python")).toBe(false);
        expect(isSnippetFor(markdown, "text/x-markdown")).toBe(true);
        expect(isSnippetFor(markdown, "text/css")).toBe(false);
        expect(isSnippetFor(css, "text/x-markdown")).toBe(false);
        expect(isSnippetFor(plain, "text/x-markdown")).toBe(true);
        expect(isSnippetFor(plain, "text/css")).toBe(true);
        expect(isSnippetFor(snippet("text/plain", "text"), "text/css")).toBe(false);
    });
});

describe("snippetCommand", () => {
    it("lists a snippet by title and description, and inserts its content for the command", () => {
        const command = snippetCommand({
            noteId: "b", title: "Footer", description: "Page footer", content: "the footer"
        });

        expect(command).toMatchObject({
            id: "snippet:Footer",
            title: "Footer",
            description: "Page footer",
            aliases: [ "snippet:Footer", "snippet", "template" ]
        });

        // Applying replaces the typed [from, to] token with the content, caret at its end.
        const dispatched: unknown[] = [];
        const view = { dispatch: (tx: unknown) => dispatched.push(tx) } as unknown as
            Parameters<typeof command.apply>[0];
        command.apply(view, 3, 11);

        expect(dispatched).toEqual([{
            changes: { from: 3, to: 11, insert: "the footer" },
            selection: { anchor: 3 + "the footer".length }
        }]);
    });
});

describe("isCodeSnippetChange", () => {
    const known = new Set(["s1"]);

    it("reacts to snippet label/relation changes and to edits of a known snippet", () => {
        expect(isCodeSnippetChange(makeLoadResults({ attrs: [{ type: "label", name: "snippet" }] }), known)).toBe(true);
        expect(isCodeSnippetChange(makeLoadResults({ attrs: [{ type: "label", name: "snippetDescription" }] }), known)).toBe(true);
        expect(isCodeSnippetChange(makeLoadResults({ attrs: [{ type: "relation", value: "_template_markdown_snippet" }] }), known)).toBe(true);
        expect(isCodeSnippetChange(makeLoadResults({ attrs: [{ type: "relation", value: "_template_code_snippet" }] }), known)).toBe(true);
        // Content/title edit of a snippet the caller already holds.
        expect(isCodeSnippetChange(makeLoadResults({ noteIds: ["s1"] }), known)).toBe(true);
    });

    it("ignores unrelated attribute and note changes", () => {
        expect(isCodeSnippetChange(makeLoadResults({ attrs: [{ type: "label", name: "color" }], noteIds: ["other"] }), known)).toBe(false);
        expect(isCodeSnippetChange(makeLoadResults({ attrs: [{ type: "relation", value: "_template_table" }] }), known)).toBe(false);
        expect(isCodeSnippetChange(makeLoadResults(), known)).toBe(false);
    });
});

describe("getCodeSnippets", () => {
    beforeEach(() => {
        vi.mocked(search.searchForNotes).mockReset();
    });

    it("maps matching notes, reading the description from #snippetDescription", async () => {
        vi.mocked(search.searchForNotes).mockResolvedValue([
            makeNote({
                noteId: "css1",
                title: "Reset",
                mime: "text/css",
                getContent: async () => ".x {}",
                getLabelValue: (name) => (name === "snippetDescription" ? "CSS reset" : null)
            })
        ]);

        const result = await getCodeSnippets((note) => note.mime === "text/css");

        expect(result).toEqual([{ noteId: "css1", title: "Reset", description: "CSS reset", content: ".x {}" }]);
    });

    it("drops notes failing the predicate, archived notes, and content-unavailable (protected) notes", async () => {
        vi.mocked(search.searchForNotes).mockResolvedValue([
            makeNote({ noteId: "keep", mime: "text/css" }),
            makeNote({ noteId: "wrong-mime", mime: "text/x-markdown" }),
            makeNote({ noteId: "archived", mime: "text/css", isArchived: true }),
            makeNote({ noteId: "protected", mime: "text/css", isContentAvailable: () => false })
        ]);

        const result = await getCodeSnippets((note) => note.mime === "text/css");

        expect(result.map((snippet) => snippet.noteId)).toEqual(["keep"]);
    });

    it("defaults a missing description to undefined and missing content to an empty string", async () => {
        vi.mocked(search.searchForNotes).mockResolvedValue([
            makeNote({ getLabelValue: () => null, getContent: async () => undefined })
        ]);

        const [snippet] = await getCodeSnippets(() => true);

        expect(snippet?.description).toBeUndefined();
        expect(snippet?.content).toBe("");
    });

    it("shares one search between loads at the same time, and searches again later", async () => {
        vi.mocked(search.searchForNotes).mockResolvedValue([ makeNote({ noteId: "css1" }) ]);

        const [ first, second ] = await Promise.all([
            getCodeSnippets(() => true), getCodeSnippets(() => true)
        ]);
        expect(search.searchForNotes).toHaveBeenCalledOnce();
        expect([ first, second ].map((snippets) => snippets.length)).toEqual([ 1, 1 ]);

        await getCodeSnippets(() => true);
        expect(search.searchForNotes).toHaveBeenCalledTimes(2);
    });

    it("searches again for changes that arrive while a search runs, once for every editor", async () => {
        const deferred = () => {
            let resolve: (notes: FNote[]) => void = () => {};
            const promise = new Promise<FNote[]>((done) => { resolve = done; });
            return { promise, resolve };
        };
        const first = deferred();
        const second = deferred();
        vi.mocked(search.searchForNotes)
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const changes = makeLoadResults({ attrs: [ { type: "label", name: "snippet" } ] });
        const noteIds = (snippets: CodeSnippet[]) => snippets.map((snippet) => snippet.noteId);

        const before = getCodeSnippets(() => true);
        const after = [ getCodeSnippets(() => true, changes), getCodeSnippets(() => true, changes) ];
        first.resolve([ makeNote({ noteId: "old" }) ]);
        expect(search.searchForNotes).toHaveBeenCalledTimes(2);
        expect(noteIds(await before)).toEqual([ "old" ]);

        // The older search finishing leaves the newer one shared.
        after.push(getCodeSnippets(() => true));
        second.resolve([ makeNote({ noteId: "old" }), makeNote({ noteId: "new" }) ]);
        expect(search.searchForNotes).toHaveBeenCalledTimes(2);
        expect((await Promise.all(after)).map(noteIds)).toEqual(Array(3).fill([ "old", "new" ]));
    });

    it("returns an empty list and logs when loading fails", async () => {
        vi.mocked(search.searchForNotes).mockRejectedValue(new Error("boom"));
        const logError = vi.spyOn(ws, "logError");

        expect(await getCodeSnippets(() => true)).toEqual([]);
        expect(logError).toHaveBeenCalled();
        logError.mockRestore();
    });
});
