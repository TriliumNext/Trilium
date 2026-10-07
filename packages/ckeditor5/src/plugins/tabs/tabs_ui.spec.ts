import { ButtonView, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Tabs from "./tabs.js";

describe("TabsUI", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, Tabs]
        });
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    it("binds each button to its command and runs it on click", () => {
        editor.setData("<p>x</p>");
        const names = ["tabs", "insertTab", "removeTab", "moveTabLeft", "moveTabRight"] as const;
        const buttons = names.map(name => editor.ui.componentFactory.create(name) as ButtonView);
        expect(buttons.map(button => button.isEnabled)).toEqual([true, false, false, false, false]);

        buttons[0].fire("execute");

        expect(editor.getData()).toContain("trilium-tabs");
        expect(buttons.map(button => button.isEnabled)).toEqual([false, true, true, false, true]);
        expect(buttons.every(button => button.label && button.icon && button.tooltip)).toBe(true);
    });
});
