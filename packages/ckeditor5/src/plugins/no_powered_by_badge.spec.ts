import { _setModelData as setModelData, Essentials, Paragraph } from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import NoPoweredByBadge from "./no_powered_by_badge.js";

describe("NoPoweredByBadge", () => {
    it("adds no badge to a focused editor", async () => {
        const editor = await createTestEditor([ Essentials, Paragraph, NoPoweredByBadge ]);
        // The badge needs an editable of at least 350 × 50 pixels.
        editor.ui.view.element?.style.setProperty("width", "600px");
        editor.ui.getEditableElement()?.style.setProperty("min-height", "200px");
        setModelData(editor.model, "<paragraph>fo[]o</paragraph>");

        editor.editing.view.focus();
        await expect.poll(() => editor.ui.focusTracker.isFocused).toBe(true);
        editor.ui.update();
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(document.querySelector(".ck-powered-by-balloon")).toBeNull();
    });
});
