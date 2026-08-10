import { describe, expect, it } from "vitest";

import { EMPTY_BLOB_ID, type HelpBundle, type HiddenSubtreeItem } from "@triliumnext/commons";
import becca from "../becca/becca.js";
import { load } from "../becca/becca_loader.js";
import blobService from "./blob.js";
import { getContext } from "./context.js";
import { getHelpHiddenSubtreeData, InAppHelpProvider, initInAppHelp } from "./in_app_help.js";
import { getVirtualNoteProvider } from "./virtual_notes.js";

/** Minimal concrete provider standing in for the platform-specific implementations. */
class TestHelpProvider extends InAppHelpProvider {
    constructor(private data: HiddenSubtreeItem[], private content: HelpBundle = {}) {
        super();
    }

    getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
        return this.data;
    }

    getHelpContent(): HelpBundle {
        return this.content;
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

    it("serves page content from the provider, through becca and the blob route", () => {
        const data: HiddenSubtreeItem[] = [
            { id: "_helpPage", title: "Page", type: "text" },
            { id: "_helpBlank", title: "Blank", type: "text" }
        ];
        initInAppHelp(new TestHelpProvider(data, { _helpPage: "<p>Rendered</p>" }));
        reloadBecca();

        expect(becca.getNoteOrThrow("_helpPage").getContent()).toBe("<p>Rendered</p>");
        // A page the provider has no entry for reads as empty rather than failing.
        expect(becca.getNoteOrThrow("_helpBlank").getContent()).toBe("");

        // Virtual notes have no blobs row, so the route derives the POJO from the provider. The
        // blobId is content-derived, as for persisted notes, so the client change-detects it the
        // same way — and empty content yields the shared empty-blob id rather than looking like a
        // blob the sync server withheld.
        const page = blobService.getBlobPojo("notes", "_helpPage");
        expect(page.content).toBe("<p>Rendered</p>");
        expect(page.contentLength).toBe("<p>Rendered</p>".length);
        expect(page.isStubbed).toBe(false);

        const blank = blobService.getBlobPojo("notes", "_helpBlank");
        expect(blank.blobId).toBe(EMPTY_BLOB_ID);
        expect(blank.isStubbed).toBe(false);
        expect(page.blobId).not.toBe(blank.blobId);
    });

    it("makes every help page read-only through an inheritable label on the root", () => {
        initInAppHelp(new TestHelpProvider([{ id: "_helpPage", title: "Page", type: "text" }]));
        reloadBecca();

        // Owned by the root, inherited by the pages: the guide is never edited in place, and the
        // application must not offer an editor for it.
        expect(becca.getNoteOrThrow("_help").getOwnedAttribute("label", "readOnly")).toBeTruthy();
        expect(becca.getNoteOrThrow("_helpPage").isLabelTruthy("readOnly")).toBe(true);
    });

    it("unregisters the help provider when none is supplied", () => {
        initInAppHelp(undefined as unknown as InAppHelpProvider);
        expect(getHelpHiddenSubtreeData()).toEqual([]);
        expect(getVirtualNoteProvider("_help")).toBeNull();

        reloadBecca();
        expect(becca.getNote("_help")).toBeNull();
    });
});
