import {
    _getModelData as getModelData,
    ButtonView,
    ClassicEditor,
    DropdownView,
    Essentials,
    IconRemove,
    type ModelElement,
    Paragraph,
    type ToolbarView,
    WidgetToolbarRepository
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import tabsBottomIcon from "../../icons/tabs-bottom.svg?raw";
import tabsIcon from "../../icons/tabs.svg?raw";
import type {
    ToolbarGroupMenuEntry, ToolbarGroupMenuItem, ToolbarGroupMenuRequest
} from "../toolbar_group_menu.js";
import Tabs from "./tabs.js";

function tab(title: string) {
    return `<section class="trilium-tab"><p class="trilium-tab-title">${title}</p>` +
        "<div class=\"trilium-tab-panel\"><p>x</p></div></section>";
}

describe("TabsUI", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;
    let requests: ToolbarGroupMenuRequest[];

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        requests = [];
        const host = {
            show: (request: ToolbarGroupMenuRequest) => requests.push(request),
            hide: vi.fn(),
            destroy: vi.fn()
        };
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, Tabs],
            toolbar: ["tabsMenu"],
            toolbarGroupMenu: { host: () => host }
        });
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    /** Opens the "More actions" menu, and returns the entries the host is handed for it. */
    function openMenu() {
        const menu = editor.ui.view.toolbar.items.first as DropdownView;
        const shown = requests.length;
        menu.buttonView.fire("open");
        const request = requests.at(-1);
        if (!request || requests.length === shown) {
            throw new Error("The host was asked to show no menu.");
        }
        // Closed again, so the next press opens a fresh menu rather than closing this one.
        request.onClose(false);
        return request.items;
    }

    /** An entry as its label, marked `(on)` and `(off)`, with its submenu; a rule as `---`. */
    function describeEntries(items: ToolbarGroupMenuItem[]): unknown[] {
        return items.map(item => {
            if (item.kind !== "entry") {
                return "---";
            }
            const on = item.isOn ? " (on)" : "";
            const label = `${item.label}${on}${item.isEnabled ? "" : " (off)"}`;
            return item.children ? [label, describeEntries(item.children)] : label;
        });
    }

    /** The entry that `path` names, a label per submenu. */
    function findEntry(items: ToolbarGroupMenuItem[], ...path: string[]): ToolbarGroupMenuEntry {
        let found: ToolbarGroupMenuItem | undefined;
        for (const label of path) {
            found = items.find(item => item.kind === "entry" && item.label === label);
            items = found?.kind === "entry" ? found.children ?? [] : [];
        }
        if (found?.kind !== "entry") {
            throw new Error(`No "${path.join(" › ")}" entry.`);
        }
        return found;
    }

    /** Opens the menu and runs the entry that `path` names. */
    function runEntry(...path: string[]) {
        const entry = findEntry(openMenu(), ...path);
        if (!entry.run) {
            throw new Error(`The "${path.join(" › ")}" entry runs nothing.`);
        }
        entry.run();
    }

    function titles() {
        const tabs = editor.model.document.getRoot()?.getChild(0) as ModelElement;
        return [...tabs.getChildren()].map(child => {
            const title = (child as ModelElement).getChild(0) as ModelElement;
            return [...title.getChildren()].map(text => text.is("$text") ? text.data : "").join("");
        });
    }

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

    it("ends the toolbar with a menu of its actions, the alignment and deleting the block", () => {
        editor.setData(`<div class="trilium-tabs">${tab("A")}${tab("B")}</div>`);
        const tabs = editor.model.document.getRoot()?.getChild(0) as ModelElement;
        const panel = (tabs.getChild(0) as ModelElement).getChild(1) as ModelElement;
        editor.model.change(writer => writer.setSelection(panel, 0));

        const items = openMenu();
        expect(describeEntries(items)).toEqual([
            "Add new tab",
            "Copy reference to this tab",
            "---",
            "Move tab right",
            "Move tab left (off)",
            "---",
            ["Tab alignment", ["Align tabs at top (on)", "Align tabs at bottom"]],
            "---",
            "Delete tab",
            "Delete all tabs"
        ]);
        const deleteAll = findEntry(items, "Delete all tabs");
        expect([deleteAll.icon, deleteAll.isDestructive]).toEqual([IconRemove, true]);
        expect(items.filter(item => item.kind === "entry" && item.isDestructive)).toHaveLength(1);
        expect(findEntry(items, "Tab alignment").icon).toBe(tabsIcon);

        const menu = editor.ui.view.toolbar.items.first as DropdownView;
        expect([menu.buttonView.label, menu.buttonView.tooltip]).toEqual(["More actions", true]);
        // `WidgetToolbarRepository` fills a toolbar as it first shows it, in a focused editor.
        editor.editing.view.focus();
        const repository = editor.plugins.get(WidgetToolbarRepository) as unknown as {
            _toolbarDefinitions: Map<string, { view: ToolbarView }>;
        };
        const toolbarItems = [...repository._toolbarDefinitions.get("tabs")?.view.items ?? []];
        const labels = toolbarItems.map(item => item instanceof DropdownView
            ? item.buttonView.label
            : (item as ButtonView).label);
        expect(labels).toEqual([
            "Add tab", "Remove tab", undefined, "Move tab left", "Move tab right", "More actions"
        ]);
    });

    it("runs the toolbar's actions, aligns the tabs and deletes the block from the menu", () => {
        const copyReference = vi.fn();
        editor.setData(`<div class="trilium-tabs">${tab("A")}${tab("B")}</div>`);
        const tabs = editor.model.document.getRoot()?.getChild(0) as ModelElement;
        const title = (tabs.getChild(0) as ModelElement).getChild(0) as ModelElement;
        editor.model.change(writer => writer.setSelection(title, 0));

        runEntry("Move tab right");
        expect(titles()).toEqual(["B", "A"]);
        runEntry("Move tab left");
        expect(titles()).toEqual(["A", "B"]);

        // Without the host's `tabs.copyReference`, the entry copies nothing.
        runEntry("Copy reference to this tab");
        editor.config.set("tabs", { copyReference });
        runEntry("Copy reference to this tab");
        expect(copyReference).toHaveBeenCalledTimes(1);

        runEntry("Tab alignment", "Align tabs at bottom");
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toMatch(/^<tabs tabAlignment="bottom">/);
        const items = openMenu();
        expect(findEntry(items, "Tab alignment").icon).toBe(tabsBottomIcon);
        expect(describeEntries(findEntry(items, "Tab alignment").children ?? []))
            .toEqual(["Align tabs at top", "Align tabs at bottom (on)"]);

        runEntry("Add new tab");
        expect(titles()).toEqual(["A", "Tab 2", "B"]);
        runEntry("Delete tab");
        expect(titles()).toEqual(["A", "B"]);

        runEntry("Delete all tabs");
        expect(getModelData(editor.model)).toBe("<paragraph>[]</paragraph>");
    });

    it("turns off the tab entries on a block selected whole, and every entry outside one", () => {
        editor.setData(`<div class="trilium-tabs">${tab("A")}${tab("B")}</div><p>x</p>`);
        const root = editor.model.document.getRoot();
        editor.model.change(writer => writer.setSelection(root?.getChild(0) as ModelElement, "on"));

        expect(describeEntries(openMenu())).toEqual([
            "Add new tab",
            "Copy reference to this tab (off)",
            "---",
            "Move tab right (off)",
            "Move tab left (off)",
            "---",
            ["Tab alignment", ["Align tabs at top (on)", "Align tabs at bottom"]],
            "---",
            "Delete tab (off)",
            "Delete all tabs"
        ]);

        editor.model.change(writer => writer.setSelection(root?.getChild(1) as ModelElement, 0));
        const items = openMenu();
        expect(items.filter(item => item.kind === "entry" && item.isEnabled)).toEqual([]);
        expect(findEntry(items, "Tab alignment").icon).toBe(tabsIcon);
    });
});
