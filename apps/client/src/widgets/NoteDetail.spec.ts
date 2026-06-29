import { describe, expect, it, vi } from "vitest";

import NoteContext from "../components/note_context";

// NoteDetail pulls in note_tree, which loads jquery.fancytree at import time and needs a `jQuery`
// global the test env doesn't provide. The pure function under test never touches the tree, so stub it.
vi.mock("./note_tree", () => ({ default: class {} }));

import { isContextInActiveTab } from "./NoteDetail";

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
