import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";

vi.mock("../../../services/search.js", () => ({
    default: { searchForNotes: vi.fn() }
}));

import search from "../../../services/search.js";
import getTemplates, { buildContentPreview } from "./snippets.js";

const logErrorMock = vi.fn();

interface TextNoteStub {
    noteId: string;
    title: string;
    type: string;
    isArchived: boolean;
    isContentAvailable: () => boolean;
    getLabelValue: (name: string) => string | null;
    getContent: () => Promise<string | undefined>;
    getIcon: () => string;
    getColorClass: () => string;
}

function makeTextNote(overrides: Partial<TextNoteStub> = {}): FNote {
    return {
        noteId: "snippet",
        title: "Snippet",
        type: "text",
        isArchived: false,
        isContentAvailable: () => true,
        getLabelValue: () => null,
        getContent: async () => "<p>hi</p>",
        getIcon: () => "tn-icon bx bx-note",
        getColorClass: () => "",
        ...overrides
    } as unknown as FNote;
}

describe("getTemplates (text snippets)", () => {
    beforeEach(() => {
        vi.mocked(search.searchForNotes).mockReset();
        logErrorMock.mockReset();
        vi.stubGlobal("logError", logErrorMock);
    });

    it("includes only available, non-archived text notes", async () => {
        vi.mocked(search.searchForNotes).mockResolvedValue([
            makeTextNote({ noteId: "keep", title: "Keep" }),
            makeTextNote({ noteId: "code", title: "Code", type: "code" }),
            makeTextNote({ noteId: "archived", title: "Archived", isArchived: true }),
            makeTextNote({ noteId: "protected", title: "Protected", isContentAvailable: () => false })
        ]);

        const definitions = await getTemplates();

        expect(definitions.map((definition) => definition.title)).toEqual(["Keep"]);
    });

    it("reads #snippetDescription, falling back to the legacy #textSnippetDescription", async () => {
        vi.mocked(search.searchForNotes).mockResolvedValue([
            makeTextNote({
                noteId: "unified",
                getLabelValue: (name) => (name === "snippetDescription" ? "unified desc" : name === "textSnippetDescription" ? "legacy desc" : null)
            }),
            makeTextNote({
                noteId: "legacy",
                getLabelValue: (name) => (name === "textSnippetDescription" ? "legacy only" : null)
            })
        ]);

        const definitions = await getTemplates();

        // The unified label wins where present; otherwise the legacy one is used.
        expect(definitions.map((definition) => definition.description)).toEqual(["unified desc", "legacy only"]);
    });

    it("exposes the note content lazily through data()", async () => {
        vi.mocked(search.searchForNotes).mockResolvedValue([
            makeTextNote({ noteId: "c", getContent: async () => "<b>body</b>" })
        ]);

        const [definition] = await getTemplates();
        const data = definition?.data;

        expect(typeof data).toBe("function");
        if (typeof data === "function") {
            expect(data()).toBe("<b>body</b>");
        }
    });

    it("falls back to a content preview when the note has no description label", async () => {
        vi.mocked(search.searchForNotes).mockResolvedValue([
            makeTextNote({ noteId: "plain", getContent: async () => "<p>Dear <b>Sir or Madam</b>,</p><p>I am writing to…</p>" }),
            makeTextNote({
                noteId: "labelled",
                getLabelValue: (name) => (name === "snippetDescription" ? "own description" : null),
                getContent: async () => "<p>content the label overrides</p>"
            }),
            makeTextNote({ noteId: "empty", getContent: async () => "<p>   </p>" })
        ]);

        const definitions = await getTemplates();

        // The user's own description always wins; empty content yields no description at all.
        expect(definitions.map((definition) => definition.description))
            .toEqual(["Dear Sir or Madam, I am writing to…", "own description", undefined]);
    });

    it("returns an empty list and logs when loading fails", async () => {
        vi.mocked(search.searchForNotes).mockRejectedValue(new Error("boom"));

        expect(await getTemplates()).toEqual([]);
        expect(logErrorMock).toHaveBeenCalled();
    });
});

describe("buildContentPreview", () => {
    it("strips markup, decodes entities and collapses whitespace", () => {
        expect(buildContentPreview("<p>Dear <b>Sir&nbsp;or Madam</b>,</p>\n<p>hello</p>")).toBe("Dear Sir or Madam, hello");
    });

    it("returns undefined for missing, empty or markup-only content", () => {
        expect(buildContentPreview(undefined)).toBeUndefined();
        expect(buildContentPreview("")).toBeUndefined();
        expect(buildContentPreview("<p>  </p><br/>")).toBeUndefined();
    });

    it("truncates long content at a word boundary with an ellipsis", () => {
        const preview = buildContentPreview(`<p>${"word ".repeat(40)}</p>`);

        expect(preview?.endsWith("…")).toBe(true);
        expect(preview?.length).toBeLessThanOrEqual(81);
        // No mid-word cut: everything before the ellipsis is whole words.
        expect(preview?.slice(0, -1).split(" ").every((part) => part === "word")).toBe(true);
    });

    it("hard-cuts a single giant word rather than returning nothing", () => {
        const preview = buildContentPreview(`<p>${"a".repeat(200)}</p>`);

        expect(preview).toBe(`${"a".repeat(80)}…`);
    });
});
