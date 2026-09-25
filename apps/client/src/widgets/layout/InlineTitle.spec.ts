import { describe, expect, it } from "vitest";

import { buildNote } from "../../test/easy-froca";
import { shouldShowInlineTitle } from "./InlineTitle";

describe("shouldShowInlineTitle", () => {
    const viewScope = { viewMode: "default" } as const;

    it("carries text notes only, since a code note fills the pane and scrolls its own editor", () => {
        const textNote = buildNote({ title: "Note", type: "text" });
        const codeNote = buildNote({ title: "Script", type: "code", mime: "application/javascript;env=backend" });

        expect(shouldShowInlineTitle(textNote, "text", viewScope)).toBe(true);
        expect(shouldShowInlineTitle(codeNote, "code", viewScope)).toBe(false);
    });
});
