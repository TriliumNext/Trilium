import { beforeAll, describe, expect, it } from "vitest";

import type { HiddenSubtreeItem } from "@triliumnext/commons";
import { getBecca } from "../becca/becca.js";
import { getContext } from "./context.js";
import {
    cleanUpHelp,
    getHelpHiddenSubtreeData,
    InAppHelpProvider,
    initInAppHelp
} from "./in_app_help.js";

/** Minimal concrete provider so the abstract `cleanUpHelp` logic can be exercised. */
class TestHelpProvider extends InAppHelpProvider {

    constructor(private data: HiddenSubtreeItem[]) {
        super();
    }
    getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
        return this.data;
    }

}

const noteService = (await import("./notes.js")).default;

/** Creates a note with a forced id under the given parent within the help subtree. */
function createHelpNote(noteId: string, parentNoteId: string) {
    return getContext().init(
        () =>
            noteService.createNewNote({
                noteId,
                parentNoteId,
                title: noteId,
                content: "help content",
                type: "text",
                // The help subtree (`_help*`) is a forbidden parent by default.
                ignoreForbiddenParents: true
            }).note
    );
}

describe("in_app_help - module accessors", () => {
    it("delegates getHelpHiddenSubtreeData to the registered provider", () => {
        // The server suite registers a real provider during initializeCore;
        // override it with a deterministic stub for this isolated fork.
        const data: HiddenSubtreeItem[] = [
            { id: "_helpFoo", title: "Foo", type: "text" }
        ];
        initInAppHelp(new TestHelpProvider(data));
        expect(getHelpHiddenSubtreeData()).toBe(data);
    });
});

describe("in_app_help - cleanUpHelp", () => {
    beforeAll(() => {
        // `_help` already exists in the fixture (empty). Build a subtree under it:
        //   _help
        //     ├── _helpKeep
        //     │     └── _helpKeepChild
        //     └── _helpStale
        createHelpNote("_helpKeep", "_help");
        createHelpNote("_helpKeepChild", "_helpKeep");
        createHelpNote("_helpStale", "_help");
    });

    it("deletes notes absent from the definition and preserves the rest", () => {
        // Definition keeps _helpKeep (and its child) but omits _helpStale.
        const definition: HiddenSubtreeItem[] = [
            {
                id: "_help",
                title: "Help",
                type: "text",
                children: [
                    {
                        id: "_helpKeep",
                        title: "Keep",
                        type: "text",
                        children: [
                            {
                                id: "_helpKeepChild",
                                title: "Keep child",
                                type: "text"
                            }
                        ]
                    }
                ]
            }
        ];

        getContext().init(() => cleanUpHelp(definition));

        // The stale note is gone; the kept notes (incl. nested child and root) survive.
        expect(getBecca().getNote("_helpStale")?.isDeleted ?? true).toBe(true);
        expect(getBecca().getNote("_helpKeep")?.isDeleted).toBe(false);
        expect(getBecca().getNote("_helpKeepChild")?.isDeleted).toBe(false);
        expect(getBecca().getNote("_help")?.isDeleted).toBe(false);
    });

    it("is a no-op when the _help subtree does not exist", () => {
        // Remove the whole _help subtree, so getBecca().getNote("_help") is null and
        // the recursive flattener hits its empty-note short-circuit.
        getContext().init(() => getBecca().getNote("_help")?.deleteNote());
        expect(getBecca().getNote("_help")).toBeNull();

        expect(() => getContext().init(() => cleanUpHelp([]))).not.toThrow();
    });
});

describe("in_app_help - no provider registered", () => {
    // Runs last: it clears the provider for the rest of this isolated fork.
    it("falls back to defaults when no provider is registered", () => {
        initInAppHelp(undefined as unknown as InAppHelpProvider);
        expect(getHelpHiddenSubtreeData()).toEqual([]);
        expect(() => cleanUpHelp([])).not.toThrow();
    });
});
