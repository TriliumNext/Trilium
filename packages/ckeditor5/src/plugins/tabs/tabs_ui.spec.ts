import {
    _getModelData as getModelData,
    ButtonView,
    ClassicEditor,
    DropdownView,
    Essentials,
    type ListItemButtonView,
    type ListItemView,
    type ListView,
    Paragraph,
    ToolbarSeparatorView,
    type ToolbarView,
    WidgetToolbarRepository
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import tabsBottomIcon from "../../icons/tabs-bottom.svg?raw";
import tabsIcon from "../../icons/tabs.svg?raw";
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
        const copyReference = vi.fn();
        editor.setData("<p>x</p>");
        const button = editor.ui.componentFactory.create("copyTabLink") as ButtonView;
        expect(button.isEnabled).toBe(false);

        editor.execute("tabs");
        expect(button.isEnabled).toBe(true);
        expect(button.label && button.icon && button.tooltip).toBeTruthy();
        button.fire("execute");
        editor.config.set("tabs", { copyReference });
        button.fire("execute");

        expect(copyReference).toHaveBeenCalledTimes(1);
    });

    it("aligns the tabs from a dropdown at the end of the toolbar", () => {
        editor.setData("<p>x</p>");
        const dropdown = editor.ui.componentFactory.create("tabAlignment") as DropdownView;
        dropdown.render();
        document.body.appendChild(dropdown.element as HTMLElement);
        onTestFinished(() => dropdown.element?.remove());
        expect([dropdown.isEnabled, dropdown.buttonView.icon]).toEqual([false, tabsIcon]);

        editor.execute("tabs");
        dropdown.isOpen = true;
        const items = [...(dropdown.panelView.children.first as ListView).items]
            .map(item => (item as ListItemView).children.first as ListItemButtonView);
        expect(items.map(item => [item.label, item.icon, item.role, item.isOn])).toEqual([
            ["Align tabs at top", tabsIcon, "menuitemradio", true],
            ["Align tabs at bottom", tabsBottomIcon, "menuitemradio", false]
        ]);
        expect([dropdown.isEnabled, dropdown.buttonView.label, dropdown.buttonView.tooltip])
            .toEqual([true, "Tab alignment", true]);

        const focus = vi.spyOn(editor.editing.view, "focus");
        items[1].fire("execute");

        expect(getModelData(editor.model, { withoutSelection: true }))
            .toMatch(/^<tabs tabAlignment="bottom">/);
        expect(items.map(item => item.isOn)).toEqual([false, true]);
        expect([dropdown.buttonView.icon, dropdown.isOpen]).toEqual([tabsBottomIcon, false]);
        expect(focus).toHaveBeenCalled();

        const repository = editor.plugins.get(WidgetToolbarRepository) as unknown as {
            _toolbarDefinitions: Map<string, { view: ToolbarView }>;
        };
        const toolbarItems = [...repository._toolbarDefinitions.get("tabs")?.view.items ?? []];
        const [separator, last] = toolbarItems.slice(-2);
        expect(separator).toBeInstanceOf(ToolbarSeparatorView);
        expect(last).toBeInstanceOf(DropdownView);
        expect((last as DropdownView).buttonView.label).toBe("Tab alignment");
    });
});
