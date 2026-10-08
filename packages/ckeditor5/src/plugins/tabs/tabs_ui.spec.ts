import { ButtonView, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installGlobMock } from "../../../test/globals-test-kit.js";
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

    it("copies a link to the tab holding the selection through the host", () => {
        const copyTabReference = vi.fn();
        installGlobMock({ getComponentByEl: () => ({ copyTabReference }) });
        editor.setData("<p>x</p>");
        const button = editor.ui.componentFactory.create("copyTabLink") as ButtonView;
        expect(button.isEnabled).toBe(false);

        editor.execute("tabs");
        expect(button.isEnabled).toBe(true);
        expect(button.label && button.icon && button.tooltip).toBeTruthy();
        button.fire("execute");

        expect(copyTabReference).toHaveBeenCalledTimes(1);
    });
});
