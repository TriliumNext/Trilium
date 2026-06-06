import type { Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import type LoadResults from "../../../services/load_results";

vi.mock("../../../services/search.js", () => ({
    default: { searchForNotes: vi.fn() }
}));

import search from "../../../services/search.js";
import { buildSnippetCompletions, getCodeSnippets, isCodeSnippetChange } from "./snippets.js";

const logErrorMock = vi.fn();

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

describe("buildSnippetCompletions", () => {
    it("formats labels with/without a description and inserts content on apply", () => {
        const [withDesc, withoutDesc] = buildSnippetCompletions([
            { noteId: "a", title: "Header", description: "Page header", content: "# Header\n" },
            { noteId: "b", title: "Footer", content: "the footer" }
        ]);

        expect(withDesc?.label).toBe("/snippet:Header - Page header");
        expect(withoutDesc?.label).toBe("/snippet:Footer");

        // Applying replaces the typed [from, to] token with the content, caret at its end.
        const apply = withoutDesc?.apply;
        expect(typeof apply).toBe("function");
        if (typeof apply !== "function") return;

        const dispatched: unknown[] = [];
        const view = { dispatch: (tx: unknown) => dispatched.push(tx) } as unknown as EditorView;
        apply(view, {} as Completion, 3, 11);

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
        logErrorMock.mockReset();
        vi.stubGlobal("logError", logErrorMock);
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

    it("returns an empty list and logs when loading fails", async () => {
        vi.mocked(search.searchForNotes).mockRejectedValue(new Error("boom"));

        expect(await getCodeSnippets(() => true)).toEqual([]);
        expect(logErrorMock).toHaveBeenCalled();
    });
});
