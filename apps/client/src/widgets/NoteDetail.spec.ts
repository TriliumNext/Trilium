import { afterEach, describe, expect, it, vi } from "vitest";

import NoteContext from "../components/note_context";
import type FNote from "../entities/fnote";
import froca from "../services/froca";

// NoteDetail pulls in note_tree, which loads jquery.fancytree at import time and needs a `jQuery`
// global the test env doesn't provide. The pure function under test never touches the tree, so stub it.
vi.mock("./note_tree", () => ({ default: class {} }));

import { getExtendedWidgetType, isContextInActiveTab } from "./NoteDetail";

const FAKE_NOTE_ID = "blob-stub-note";

/**
 * Builds a tab as a list of note contexts: the first is the main context (the tab itself),
 * the rest are its splits. Every context resolves its main context to the first one — the
 * same topology `NoteContext.getMainContext()` produces, without needing a real tab manager.
 */
function buildTab(ntxIds: string[]): NoteContext[] {
    const contexts = ntxIds.map((id, i) => new NoteContext(id, "root", i === 0 ? null : ntxIds[0]));
    const mainContext = contexts[0];
    for (const context of contexts) {
        context.getMainContext = () => mainContext;
    }
    return contexts;
}

describe("isContextInActiveTab", () => {
    it("treats every split of the active tab as active, not just the focused one", () => {
        const [ mainContext, secondarySplit ] = buildTab([ "A", "B" ]);

        // The active tab is "A". Both the main split and the secondary (non-focused) split belong to
        // it, so both must load eagerly. The secondary split is the regression case: keying deferral on
        // the focused split alone (its own ntxId "B") would leave it blank until clicked.
        expect(isContextInActiveTab(mainContext, "A")).toBe(true);
        expect(isContextInActiveTab(secondarySplit, "A")).toBe(true);
    });

    it("defers splits that belong to a different (background) tab", () => {
        const [ backgroundMain, backgroundSplit ] = buildTab([ "C", "D" ]);

        expect(isContextInActiveTab(backgroundMain, "A")).toBe(false);
        expect(isContextInActiveTab(backgroundSplit, "A")).toBe(false);
    });

    it("returns false when the context is missing or no tab is active yet", () => {
        const [ , split ] = buildTab([ "A", "B" ]);

        expect(isContextInActiveTab(undefined, "A")).toBe(false);
        expect(isContextInActiveTab(split, null)).toBe(false);
        expect(isContextInActiveTab(split, undefined)).toBe(false);
    });
});

describe("getExtendedWidgetType blob-stub routing", () => {
    afterEach(() => {
        delete froca.notes[FAKE_NOTE_ID];
    });

    /**
     * Builds a note and registers it in the froca cache: `getExtendedWidgetType` only fetches a blob
     * for notes still present there, so an unregistered note would skip the stub check entirely.
     */
    function fakeNote(overrides: Record<string, unknown> = {}): FNote {
        const note = {
            noteId: FAKE_NOTE_ID,
            type: "text",
            isProtected: false,
            isTriliumSqlite: () => false,
            isMarkdown: () => false,
            isIconPack: () => false,
            getBlob: async () => ({ isStubbed: false }),
            ...overrides
        } as unknown as FNote;
        froca.notes[FAKE_NOTE_ID] = note;
        return note;
    }

    function fakeContext(overrides: Record<string, unknown> = {}): NoteContext {
        return {
            viewScope: {},
            isReadOnly: async () => false,
            ...overrides
        } as unknown as NoteContext;
    }

    it("routes a note whose blob was withheld (stubbed) to the blobStub placeholder", async () => {
        const note = fakeNote({ getBlob: async () => ({ isStubbed: true }) });
        expect(await getExtendedWidgetType(note, fakeContext())).toBe("blobStub");
    });

    it("routes a normal text note to the editable text widget", async () => {
        expect(await getExtendedWidgetType(fakeNote(), fakeContext())).toBe("editableText");
    });

    it("does not fetch the blob for note types that are not blob-backed", async () => {
        const getBlob = vi.fn(async () => ({ isStubbed: true }));
        // A launcher resolves to "doc", which is not blob-backed, so the stub check must be skipped.
        const note = fakeNote({ type: "launcher", getBlob });
        expect(await getExtendedWidgetType(note, fakeContext())).toBe("doc");
        expect(getBlob).not.toHaveBeenCalled();
    });
});
