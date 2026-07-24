import { describe, expect, it } from "vitest";

import type { HiddenSubtreeItem } from "@triliumnext/commons";
import becca from "../becca/becca.js";
import { load } from "../becca/becca_loader.js";
import { getContext } from "./context.js";
import { getHelpHiddenSubtreeData, InAppHelpProvider, initInAppHelp } from "./in_app_help.js";
import { getVirtualNoteProvider } from "./virtual_notes.js";

/** Minimal concrete provider standing in for the platform-specific implementations. */
class TestHelpProvider extends InAppHelpProvider {
    constructor(private data: HiddenSubtreeItem[]) {
        super();
    }

    getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
        return this.data;
    }
}

function reloadBecca() {
    getContext().init(() => load());
}

describe("in_app_help", () => {
    it("delegates getHelpHiddenSubtreeData to the registered provider", () => {
        // The server suite registers a real provider during initializeCore;
        // override it with a deterministic stub for this isolated fork.
        const data: HiddenSubtreeItem[] = [{ id: "_helpFoo", title: "Foo", type: "text" }];
        initInAppHelp(new TestHelpProvider(data));
        expect(getHelpHiddenSubtreeData()).toBe(data);
    });

    it("injects the help subtree as virtual notes under _hidden", () => {
        const data: HiddenSubtreeItem[] = [
            {
                id: "_helpStub",
                title: "Stub page",
                type: "doc",
                icon: "bx-file",
                attributes: [{ type: "label", name: "docName", value: "stub" }]
            }
        ];
        initInAppHelp(new TestHelpProvider(data));
        reloadBecca();

        const helpRoot = becca.getNoteOrThrow("_help");
        expect(helpRoot.isVirtual).toBe(true);
        expect(helpRoot.type).toBe("book");
        expect(helpRoot.getParentNotes().map((note) => note.noteId)).toEqual(["_hidden"]);

        const stub = becca.getNoteOrThrow("_helpStub");
        expect(stub.isVirtual).toBe(true);
        expect(stub.getParentNotes().map((note) => note.noteId)).toEqual(["_help"]);
        expect(stub.getLabelValue("docName")).toBe("stub");
        expect(stub.getLabelValue("iconClass")).toBe("bx bx-file");
    });

    it("unregisters the help provider when none is supplied", () => {
        initInAppHelp(undefined as unknown as InAppHelpProvider);
        expect(getHelpHiddenSubtreeData()).toEqual([]);
        expect(getVirtualNoteProvider("_help")).toBeNull();

        reloadBecca();
        expect(becca.getNote("_help")).toBeNull();
    });
});
