import type { HiddenSubtreeItem } from "@triliumnext/commons";
import { afterEach, describe, expect, it } from "vitest";

import type BNote from "../../../becca/entities/bnote.js";
import { InAppHelpProvider, initInAppHelp } from "../../in_app_help.js";
import { clearDocSearchTextCache, getDocSearchText } from "./doc_content.js";

class FakeHelpProvider extends InAppHelpProvider {
    constructor(private docs: Record<string, string>) {
        super();
    }

    getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
        return [];
    }

    override getDocContent(docName: string): string | null {
        return this.docs[docName] ?? null;
    }
}

function fakeDocNote(noteId: string, docName: string | null, type = "doc"): BNote {
    return {
        noteId,
        type,
        getLabelValue: (name: string) => (name === "docName" ? docName : null)
    } as unknown as BNote;
}

describe("getDocSearchText", () => {
    afterEach(() => {
        clearDocSearchTextCache();
        initInAppHelp(undefined as unknown as InAppHelpProvider);
    });

    it("returns stripped, normalized plain text for a doc note", () => {
        initInAppHelp(new FakeHelpProvider({ "User Guide/Intro": "<p>Hello <b>World</b></p>" }));
        expect(getDocSearchText(fakeDocNote("n1", "User Guide/Intro"))).toBe("hello world");
    });

    it("returns null for non-doc notes, missing docName, and unavailable content", () => {
        initInAppHelp(new FakeHelpProvider({ Existing: "<p>hi</p>" }));
        expect(getDocSearchText(fakeDocNote("n2", "Existing", "text"))).toBeNull();
        expect(getDocSearchText(fakeDocNote("n3", null))).toBeNull();
        expect(getDocSearchText(fakeDocNote("n4", "Missing"))).toBeNull();
    });

    it("caches per note, ignoring later provider changes until the cache is cleared", () => {
        initInAppHelp(new FakeHelpProvider({ "Doc/A": "<p>first</p>" }));
        const note = fakeDocNote("n5", "Doc/A");
        expect(getDocSearchText(note)).toBe("first");

        // Provider now returns different content, but the cached value is reused.
        initInAppHelp(new FakeHelpProvider({ "Doc/A": "<p>second</p>" }));
        expect(getDocSearchText(note)).toBe("first");

        clearDocSearchTextCache();
        expect(getDocSearchText(note)).toBe("second");
    });
});
