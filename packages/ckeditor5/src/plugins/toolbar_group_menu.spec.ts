import {
    addListToDropdown, Bold, ButtonView, type ClassicEditor, Collection, createDropdown,
    type DropdownMenuNestedMenuView, DropdownView, Essentials, Italic,
    type ListDropdownItemDefinition, ListSeparatorView, type Locale, Paragraph, Plugin,
    SplitButtonView, type ToolbarView, UIModel, View
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor, createTestEditorOf } from "../../test/editor-kit.js";
import ToolbarGroupMenu from "./toolbar_group_menu.js";

const insertedSamples: string[] = [];
const blankInserts = vi.fn();
/** What the `clock` entry below writes into its list, standing in for `dateTime`'s previews. */
let now = "";

beforeEach(() => {
    insertedSamples.length = 0;
    blankInserts.mockClear();
    now = "noon";
});

/** A toolbar item that is neither a button nor a dropdown, focusable as a toolbar wants. */
class PlainItemView extends View {
    focus() {}
}

/**
 * Stands in for the group's dropdown entries — `mermaid` and `dateTime` are split buttons over a
 * list, with an action of their own on the button half.
 */
class SampleDropdown extends Plugin {

    init() {
        this.editor.ui.componentFactory.add("samples", (locale: Locale) => {
            const dropdown = createDropdown(locale, SplitButtonView);
            dropdown.buttonView.set({ label: "Insert sample", icon: "<svg />", tooltip: true });
            dropdown.buttonView.on("execute", () => blankInserts());

            const items = new Collection<ListDropdownItemDefinition>();
            for (const name of ["Flowchart", "Sequence"]) {
                items.add({ type: "button", model: new UIModel({ label: name, withText: true }) });
            }
            addListToDropdown(dropdown, items);
            dropdown.on("execute", (evt) => {
                insertedSamples.push((evt.source as ButtonView).label ?? "");
            });

            return dropdown;
        });

        // Like `dateTime`, which shows the moment its list was opened at.
        this.editor.ui.componentFactory.add("clock", (locale: Locale) => {
            const dropdown = createDropdown(locale);
            dropdown.buttonView.set({ label: "Clock", icon: "<svg />" });

            const items = new Collection<ListDropdownItemDefinition>();
            addListToDropdown(dropdown, items);
            dropdown.on("change:isOpen", (evt, name, isOpen) => {
                if (isOpen) {
                    items.clear();
                    const model = new UIModel({ label: now, withText: true });
                    items.add({ type: "button", model });
                }
            });

            return dropdown;
        });

        // A list carrying everything a dropdown list can hold besides plain rows.
        this.editor.ui.componentFactory.add("oddList", (locale: Locale) => {
            const dropdown = createDropdown(locale);
            dropdown.buttonView.set({ label: "Odd list", icon: "<svg />" });

            const items = new Collection<ListDropdownItemDefinition>();
            items.add({ type: "separator" });
            items.add({ type: "button", model: new UIModel({ label: "First", withText: true }) });
            items.add({ type: "separator" });
            items.add({ type: "button", model: new UIModel({ withText: true }) });
            items.add({
                type: "group",
                model: new UIModel({ label: "Grouped" }),
                items: new Collection([{
                    type: "button" as const,
                    model: new UIModel({ label: "Inside", withText: true })
                }])
            });
            addListToDropdown(dropdown, items);

            return dropdown;
        });

        // Neither a button nor a dropdown: a toolbar item the menu has no row to draw for.
        this.editor.ui.componentFactory.add("plainView", (locale: Locale) => {
            const view = new PlainItemView(locale);
            view.setTemplate({ tag: "span", attributes: { class: ["ck"] } });
            return view;
        });

        // A dropdown with no list of its own: nothing to open onto, so it stays a plain row.
        this.editor.ui.componentFactory.add("panelOnly", (locale: Locale) => {
            const dropdown = createDropdown(locale);
            dropdown.buttonView.set({ label: "Panel only", icon: "<svg />" });
            return dropdown;
        });
    }

}

const MENU_GROUP = {
    label: "Insert",
    icon: "plus",
    asMenu: true,
    items: ["bold", "|", "italic", "samples"]
};
const PLAIN_GROUP = { label: "Plain", icon: "text", items: ["bold", "italic"] };
const PLUGINS = [Essentials, Paragraph, Bold, Italic, SampleDropdown, ToolbarGroupMenu];

describe("ToolbarGroupMenu", () => {
    it("opens a group marked with asMenu as a menu of rows, ruled as the group was", async () => {
        const editor = await createTestEditor(PLUGINS, {
            toolbar: { items: ["bold", MENU_GROUP, PLAIN_GROUP] }
        });

        const menu = openGroup(getToolbar(editor), "Insert");
        expect(rowLabels(menu)).toStrictEqual(["Bold", "—", "Italic", "Insert sample"]);

        // Each row carries the icon of the toolbar item it stands for, and follows its enabled
        // state: `bold` is disabled while the editor is read-only, so its row is too.
        const [bold] = menu.buttons;
        expect(bold.icon).toBeTruthy();
        expect(bold.isEnabled).toBe(true);
        editor.enableReadOnlyMode("spec");
        expect(bold.isEnabled).toBe(false);
    });

    it("opens an entry carrying a list of its own as a submenu over that list", async () => {
        const editor = await createTestEditor(PLUGINS, {
            toolbar: { items: [MENU_GROUP] }
        });

        const dropdown = openDropdown(getToolbar(editor), "Insert");
        const submenu = openSubmenu(dropdown);
        expect(submenu.buttonView.label).toBe("Insert sample");
        expect(submenu.buttonView.icon).toBe("<svg />");
        // `toolbar_group_menu.css` sizes the icons of a panel pinned into the body by this class.
        expect(submenu.panelView.class).toBe("ck-toolbar-group-menu__panel");
        expect(itemLabels(submenu.listView.items)).toStrictEqual(["Flowchart", "Sequence"]);
    });

    it("runs the action of a split button when its submenu's opener is pressed", async () => {
        const editor = await createTestEditor(PLUGINS, {
            toolbar: { items: [MENU_GROUP] }
        });

        const dropdown = openDropdown(getToolbar(editor), "Insert");
        submenuOf(dropdown).buttonView.fire("execute");

        expect(blankInserts).toHaveBeenCalled();
        expect(dropdown.isOpen).toBe(false);
    });

    it("runs the toolbar item a row stands for, in the menu and in a submenu alike", async () => {
        const editor = await createTestEditor(PLUGINS, {
            toolbar: { items: [MENU_GROUP] }
        });

        const dropdown = openDropdown(getToolbar(editor), "Insert");
        const menuView = openGroup(getToolbar(editor), "Insert");

        const bold = menuView.buttons.find((button) => button.label === "Bold");
        expect(bold).toBeTruthy();
        bold?.fire("execute");
        expect(editor.commands.get("bold")?.value).toBe(true);

        submenuRow(openSubmenu(dropdown), "Sequence").fire("execute");
        expect(insertedSamples).toStrictEqual(["Sequence"]);
    });

    it("draws a submenu on each open, so an entry filling its own list stays fresh", async () => {
        const editor = await createTestEditor(PLUGINS, {
            toolbar: { items: [{ ...MENU_GROUP, items: ["clock"] }] }
        });

        const dropdown = openDropdown(getToolbar(editor), "Insert");
        expect(itemLabels(openSubmenu(dropdown).listView.items)).toStrictEqual(["noon"]);

        // Reopening the submenu alone is enough: it is what the reader waits in front of.
        now = "half past";
        submenuOf(dropdown).isOpen = false;
        expect(itemLabels(openSubmenu(dropdown).listView.items)).toStrictEqual(["half past"]);

        now = "one";
        dropdown.isOpen = false;
        dropdown.isOpen = true;
        expect(itemLabels(openSubmenu(dropdown).listView.items)).toStrictEqual(["one"]);
    });

    it("only opens the submenu of an entry that has no action of its own", async () => {
        const editor = await createTestEditor(PLUGINS, {
            toolbar: { items: [{ ...MENU_GROUP, items: ["clock"] }] }
        });

        const dropdown = openDropdown(getToolbar(editor), "Insert");
        const submenu = submenuOf(dropdown);
        submenu.buttonView.fire("execute");

        expect(submenu.isOpen).toBe(true);
        expect(dropdown.isOpen).toBe(true);
    });

    it("holds a dropdown that carries a panel of its own in the row, panel and all", async () => {
        const editor = await createTestEditor(PLUGINS, {
            toolbar: { items: [{ ...MENU_GROUP, items: ["bold", "panelOnly"] }] }
        });

        const dropdown = openDropdown(getToolbar(editor), "Insert");
        expect(openGroup(getToolbar(editor), "Insert").menus).toStrictEqual([]);

        const mounted = rowChildren(dropdown).at(-1);
        expect(mounted).toBeInstanceOf(DropdownView);
        if (!(mounted instanceof DropdownView)) {
            return;
        }

        // Its panel opens from inside the menu, where firing the detached dropdown could only have
        // opened it on the strip the menu replaced.
        expect(mounted.buttonView.withText).toBe(true);
        mounted.isOpen = true;
        expect(mounted.panelView.isVisible).toBe(true);

        // A redraw leaves it alive: it belongs to the group, not to the menu drawn over it.
        dropdown.isOpen = false;
        dropdown.isOpen = true;
        expect(rowChildren(dropdown).at(-1)).toBe(mounted);
    });

    it("hands the keyboard to a mounted control when its row takes focus", async () => {
        const editor = await createTestEditor(PLUGINS, {
            toolbar: { items: [{ ...MENU_GROUP, items: ["panelOnly"] }] }
        });

        const dropdown = openDropdown(getToolbar(editor), "Insert");
        const mounted = rowChildren(dropdown).at(-1);
        expect(mounted).toBeInstanceOf(DropdownView);
        if (!(mounted instanceof DropdownView)) {
            return;
        }

        // The row goes on naming the button that stood there as its `childView`, which only the
        // hover behaviour reads, and only to recognize a submenu. Focus takes the other road:
        // `ListItemView#focus()` reaches for `children.first`, which is the control itself.
        const [row] = [...dropdown.menuView?.items ?? []] as Array<{ childView?: unknown }>;
        expect(row?.childView).not.toBe(mounted);

        dropdown.menuView?.focus();
        expect(document.activeElement).toBe(mounted.buttonView.element);
    });

    it("draws a rule where the list has one, never at its head, and names every row", async () => {
        const editor = await createTestEditor(PLUGINS, {
            toolbar: { items: [{ ...MENU_GROUP, items: ["oddList"] }] }
        });

        const dropdown = openDropdown(getToolbar(editor), "Insert");

        // `listEntriesOf()` skips a `ListItemGroupView`, and `labelOf()` names an unlabeled
        // button "", which still runs on execute.
        const rows = itemLabels(openSubmenu(dropdown).listView.items);
        expect(rows).toStrictEqual(["First", "—", ""]);
    });

    // `_cleanSeparatorsAndLineBreaks()` drops a leading `|`, so `plan.definition` can only be
    // empty at a separator when `planGroupMenu()` skipped the item before it.
    it("passes over an item it has no row for, and the rule that follows it", async () => {
        const editor = await createTestEditor(PLUGINS, {
            toolbar: {
                items: [{ ...MENU_GROUP, items: ["plainView", "|", "bold", "-", "italic"] }]
            }
        });

        const menu = openGroup(getToolbar(editor), "Insert");
        expect(rowLabels(menu)).toStrictEqual(["Bold", "Italic"]);
    });

    it("converts a group of the block toolbar, filled after the plugin is set up", async () => {
        const { BlockToolbar } = await import("ckeditor5");
        const editor = await createTestEditor([BlockToolbar, ...PLUGINS], {
            toolbar: { items: ["bold"] },
            blockToolbar: [MENU_GROUP]
        });

        const menu = openGroup(editor.plugins.get(BlockToolbar).toolbarView, "Insert");
        expect(rowLabels(menu)).toStrictEqual(["Bold", "—", "Italic", "Insert sample"]);
    });

    // A real `BalloonEditor`, whose UI view carries no fixed bar at all: the group is reached
    // through the plugin holding the selection toolbar, and nowhere else.
    it("converts a group of the selection balloon", async () => {
        const { BalloonEditor, BalloonToolbar } = await import("ckeditor5");
        const editor = await createTestEditorOf(BalloonEditor, PLUGINS, {
            toolbar: [MENU_GROUP]
        });

        expect((editor.ui.view as { toolbar?: ToolbarView }).toolbar).toBeUndefined();
        const menu = openGroup(editor.plugins.get(BalloonToolbar).toolbarView, "Insert");
        expect(rowLabels(menu)).toStrictEqual(["Bold", "—", "Italic", "Insert sample"]);
    });

    it("leaves every group alone when none is marked", async () => {
        const editor = await createTestEditor(PLUGINS, {
            toolbar: { items: ["bold", PLAIN_GROUP] }
        });

        expect(editor.plugins.has(ToolbarGroupMenu)).toBe(true);
        expect(openDropdown(getToolbar(editor), "Plain").menuView).toBeUndefined();
    });
});

function getToolbar(editor: ClassicEditor) {
    return (editor.ui.view as { toolbar: ToolbarView }).toolbar;
}

function openDropdown(toolbar: ToolbarView, label: string) {
    const dropdown = [...toolbar.items].find((item): item is DropdownView =>
        item instanceof DropdownView && item.buttonView.label === label);
    if (!dropdown) {
        throw new Error(`No "${label}" group dropdown in the toolbar.`);
    }

    dropdown.isOpen = true;
    return dropdown;
}

/** Open the group dropdown carrying `label` and return the menu built in its panel. */
function openGroup(toolbar: ToolbarView, label: string) {
    const menuView = openDropdown(toolbar, label).menuView;
    if (!menuView) {
        throw new Error(`The "${label}" group built no menu.`);
    }

    return menuView;
}

function submenuOf(dropdown: DropdownView) {
    const [submenu] = dropdown.menuView?.menus ?? [];
    if (!submenu) {
        throw new Error("The menu holds no submenu.");
    }

    return submenu;
}

/** Open the menu's one submenu, which is what draws its rows. */
function openSubmenu(dropdown: DropdownView) {
    const submenu = submenuOf(dropdown);
    submenu.isOpen = true;
    return submenu;
}

function submenuRow(submenu: DropdownMenuNestedMenuView, label: string) {
    for (const item of submenu.listView.items) {
        const child = (item as { children?: { first?: unknown } }).children?.first;
        if (child instanceof ButtonView && child.label === label) {
            return child;
        }
    }

    throw new Error(`No "${label}" row in the submenu.`);
}

/** What each row of the menu holds: a button, a submenu, or a control mounted into the row. */
function rowChildren(dropdown: DropdownView) {
    return [...dropdown.menuView?.items ?? []]
        .map((item) => (item as { children?: { first?: unknown } }).children?.first);
}

/** The labels the menu shows, top level only, with a rule written as an em dash. */
function rowLabels(menuView: { items: Iterable<unknown> }) {
    return itemLabels(menuView.items);
}

function itemLabels(items: Iterable<unknown>) {
    const labels: string[] = [];

    for (const item of items) {
        if (item instanceof ListSeparatorView) {
            labels.push("—");
            continue;
        }

        const child = (item as { children?: { first?: unknown } }).children?.first;
        if (child instanceof ButtonView) {
            labels.push(child.label ?? "");
        } else if (isNestedMenu(child)) {
            labels.push(child.buttonView.label ?? "");
        }
    }

    return labels;
}

function isNestedMenu(view: unknown): view is DropdownMenuNestedMenuView {
    return !!view && typeof view === "object" && "buttonView" in view && "listView" in view;
}
