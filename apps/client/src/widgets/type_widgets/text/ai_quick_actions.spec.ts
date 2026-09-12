// @vitest-environment jsdom
// The prompt of a text note is read out of its HTML through DOMParser, which happy-dom does not
// traverse faithfully — the same reason `ai_assistant_stream.spec` pins itself to jsdom.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/search.js", () => ({ default: { searchForNotes: vi.fn() } }));
vi.mock("../../../services/froca.js", () => ({ default: { getNotes: vi.fn() } }));
// `getAvailableLocales` is reached through the built-in groups, which come along for the ride.
vi.mock("../../../services/i18n.js", () => ({ t: (key: string) => key, getAvailableLocales: () => [] }));
vi.mock("../../../services/options.js", () => ({ default: { getJson: () => null } }));
vi.mock("../../../components/app_context.js", () => ({ default: { triggerCommand: vi.fn() } }));
// The hook is not under test here; importing the module must not drag in the Preact context it
// needs, nor the editor bundle behind it.
vi.mock("../../react/hooks.jsx", () => ({ useTriliumEvent: vi.fn(), useTriliumOption: () => [""] }));

import type FNote from "../../../entities/fnote.js";
import type LoadResults from "../../../services/load_results.js";
import search from "../../../services/search.js";
import { buildQuickActions, refreshQuickActions } from "./ai_quick_actions.js";

interface NoteStub {
    noteId: string;
    title: string;
    type: string;
    isArchived: boolean;
    isContentAvailable: () => boolean;
    getContent: () => Promise<string | undefined>;
    getIcon: () => string;
}

function makeNote(overrides: Partial<NoteStub> = {}): FNote {
    return {
        noteId: "act",
        title: "Make it a haiku",
        type: "text",
        isArchived: false,
        isContentAvailable: () => true,
        getContent: async () => "<p>Rewrite this as a haiku.</p>",
        getIcon: () => "bx bx-note",
        ...overrides
    } as unknown as FNote;
}

/** The custom group, or `undefined` when nothing earned one. */
async function customGroup() {
    return (await buildQuickActions()).find((group) => group.id === "custom");
}

function loadResults({ attributes = [], noteIds = [] }: {
    attributes?: Array<{ type: string; name?: string; value?: string }>;
    noteIds?: string[];
}) {
    return {
        getAttributeRows: () => attributes,
        getNoteIds: () => noteIds
    } as unknown as LoadResults;
}

describe("custom AI quick actions", () => {
    beforeEach(() => {
        vi.mocked(search.searchForNotes).mockReset();
        vi.stubGlobal("logError", vi.fn());
    });

    it("offers one action per labelled note, titled by it and prompted by its content", async () => {
        vi.mocked(search.searchForNotes).mockResolvedValue([
            makeNote(),
            makeNote({ noteId: "second", title: "Draft a reply", type: "code", getContent: async () => "  Draft a reply.  " })
        ]);

        const group = await customGroup();
        expect(group?.submenu).toBe(true);
        expect(group?.actions).toEqual([
            {
                id: "custom:act",
                label: "Make it a haiku",
                prompt: "Rewrite this as a haiku.",
                iconClass: "bx bx-note"
            },
            // A code note is already the plain text the model wants; only the padding goes.
            expect.objectContaining({ id: "custom:second", prompt: "Draft a reply." })
        ]);

        expect(vi.mocked(search.searchForNotes)).toHaveBeenCalledWith("#aiQuickAction");
    });

    // The instruction is what the user wrote, not the markup they wrote it in — which would spend
    // tokens on tags and invite the model to answer in kind.
    it("reads a text note's prompt as plain text, keeping the breaks between its blocks", async () => {
        vi.mocked(search.searchForNotes).mockResolvedValue([makeNote({
            getContent: async () => "<h2>Summarize</h2><ul><li>One bullet per idea</li><li>Keep &amp; the wording</li></ul>"
        })]);

        expect((await customGroup())?.actions[0].prompt)
            .toBe("Summarize\nOne bullet per idea\nKeep & the wording");
    });

    it("passes over the notes that cannot contribute a prompt", async () => {
        vi.mocked(search.searchForNotes).mockResolvedValue([
            makeNote({ noteId: "archived", isArchived: true }),
            makeNote({ noteId: "protected", isContentAvailable: () => false }),
            makeNote({ noteId: "image", type: "image" }),
            // Written but not yet filled in: an action with no instruction would hand the selection
            // to the model with nothing to do to it.
            makeNote({ noteId: "empty", getContent: async () => "<p>&nbsp;</p>" })
        ]);

        expect(await customGroup()).toBeUndefined();
    });

    it("keeps the group out of the menu entirely when the search fails", async () => {
        vi.mocked(search.searchForNotes).mockRejectedValue(new Error("offline"));

        expect(await customGroup()).toBeUndefined();
        expect(vi.mocked(globalThis.logError)).toHaveBeenCalled();
    });

    describe("refreshQuickActions", () => {
        it("rebuilds when a note gains the label or is made from the template", async () => {
            vi.mocked(search.searchForNotes).mockResolvedValue([]);
            const setQuickActions = vi.fn();

            await refreshQuickActions(loadResults({ attributes: [{ type: "label", name: "aiQuickAction" }] }), setQuickActions);
            await refreshQuickActions(loadResults({ attributes: [{ type: "relation", value: "_template_ai_quick_action" }] }), setQuickActions);

            expect(setQuickActions).toHaveBeenCalledTimes(2);
        });

        it("ignores a change to a label or a note that feeds nothing", async () => {
            vi.mocked(search.searchForNotes).mockResolvedValue([]);
            const setQuickActions = vi.fn();

            await refreshQuickActions(loadResults({ attributes: [{ type: "label", name: "snippet" }] }), setQuickActions);
            await refreshQuickActions(loadResults({ noteIds: ["someOtherNote"] }), setQuickActions);

            expect(setQuickActions).not.toHaveBeenCalled();
        });
    });
});
