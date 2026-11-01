import { Essentials, Paragraph } from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../test/editor-kit.js";
import { renderShortcut } from "./shortcut.js";

describe("renderShortcut", () => {
    it("hands the keystroke to the host renderer", async () => {
        // `renderShortcut` is not declared on the editor config type; the host sets it via a cast.
        const editor = await createTestEditor([Essentials, Paragraph], {
            renderShortcut: (shortcut: string) => `<kbd>${shortcut}</kbd>`
        } as unknown as Parameters<typeof createTestEditor>[1]);

        expect(renderShortcut(editor, "Ctrl+Enter")).toBe("<kbd>Ctrl+Enter</kbd>");
    });

    // A standalone editor or a test has no host to render key names, and a hint that mentions a
    // shortcut still has to name one.
    it("falls back to the stored form when no host renderer is configured", async () => {
        const editor = await createTestEditor([Essentials, Paragraph]);

        expect(renderShortcut(editor, "Ctrl+Shift+Enter")).toBe("Ctrl+Shift+Enter");
    });
});
