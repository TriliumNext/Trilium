import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";

vi.mock("../../../services/search.js", () => ({
    default: { searchForNotes: vi.fn() }
}));

import search from "../../../services/search.js";
import getTemplates from "./snippets.js";

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

    it("returns an empty list and logs when loading fails", async () => {
        vi.mocked(search.searchForNotes).mockRejectedValue(new Error("boom"));

        expect(await getTemplates()).toEqual([]);
        expect(logErrorMock).toHaveBeenCalled();
    });
});
