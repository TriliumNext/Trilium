import type { HiddenSubtreeItem } from "@triliumnext/commons";
import { afterEach, describe, expect, it } from "vitest";

import type BNote from "../../../becca/entities/bnote.js";
import { InAppHelpProvider, initInAppHelp } from "../../in_app_help.js";
import { getDocSearchText } from "./doc_content.js";

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
        initInAppHelp(undefined as unknown as InAppHelpProvider);
    });

    it("returns the indexed plain text for a doc note", () => {
        initInAppHelp(new FakeHelpProvider({ "User Guide/Intro": "Hello World" }));
        expect(getDocSearchText(fakeDocNote("n1", "User Guide/Intro"))).toBe("Hello World");
    });

    it("returns null for non-doc notes, missing docName, and unavailable content", () => {
        initInAppHelp(new FakeHelpProvider({ Existing: "hi" }));
        expect(getDocSearchText(fakeDocNote("n2", "Existing", "text"))).toBeNull();
        expect(getDocSearchText(fakeDocNote("n3", null))).toBeNull();
        expect(getDocSearchText(fakeDocNote("n4", "Missing"))).toBeNull();
    });
});
