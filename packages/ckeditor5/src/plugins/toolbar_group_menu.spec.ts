import {
    addListToDropdown, Bold, ButtonView, type ClassicEditor, Collection, createDropdown,
    DropdownView, type Editor, Essentials, Italic, type ListDropdownItemDefinition, ListItemView,
    ListView, type Locale, Paragraph, Plugin, SearchTextView, SplitButtonView, type ToolbarView, UIModel,
    View
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor, createTestEditorOf } from "../../test/editor-kit.js";
import ToolbarGroupMenu, {
    openListAsMenu, type ToolbarGroupMenuEntry, type ToolbarGroupMenuHost, type ToolbarGroupMenuItem,
    type ToolbarGroupMenuRequest
} from "./toolbar_group_menu.js";

const insertedSamples: string[] = [];
const blankInserts = vi.fn();
/** What the `clock` entry below writes into its list, standing in for `dateTime`'s previews. */
let now = "";
/** The row of the `level` list that is on, and the one its `execute` picks. */
let level = "";

beforeEach(() => {
    insertedSamples.length = 0;
    blankInserts.mockClear();
    now = "noon";
    level = "High";
});

/** The list of a search panel, as the `insertTemplate` dropdown has. */
class SearchedListView extends ListView {
    filter() {
        return { resultsCount: this.items.length, totalItemsCount: this.items.length };
    }
}

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
                    items.add({ type: "button", model: new UIModel({ label: now, withText: true }) });
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
            items.add({ type: "separator" });
            items.add({ type: "button", model: new UIModel({ withText: true }) });
            items.add({
                type: "group",
                label: "Grouped",
                items: new Collection([{
                    type: "button" as const,
                    model: new UIModel({ label: "Inside", withText: true })
                }])
            });
            items.add({ type: "separator" });
            addListToDropdown(dropdown, items);

            return dropdown;
        });

        // Like `insertTemplate`: a list inside a search panel rather than the dropdown's own.
        this.editor.ui.componentFactory.add("searched", (locale: Locale) => {
            const dropdown = createDropdown(locale);
            dropdown.buttonView.set({ label: "Searched", icon: "<svg />" });

            const listView = new SearchedListView(locale);
            const item = new ListItemView(locale);
            const button = new ButtonView(locale);
            button.set({ label: "Greeting", withText: true });
            button.on("execute", () => insertedSamples.push("Greeting"));
            item.children.add(button);
            listView.items.add(item);
            dropdown.panelView.children.add(new SearchTextView(locale, {
                filteredView: listView,
                queryView: { label: "Search" }
            }));

            return dropdown;
        });

        // A list with no rows, as `insertTemplate` has without any template.
        this.editor.ui.componentFactory.add("emptyList", (locale: Locale) => {
            const dropdown = createDropdown(locale);
            dropdown.buttonView.set({ label: "Empty", icon: "<svg />" });
            addListToDropdown(dropdown, new Collection<ListDropdownItemDefinition>());
            return dropdown;
        });

        // Neither a button nor a dropdown: a toolbar item the menu has no row to draw for.
        this.editor.ui.componentFactory.add("plainView", (locale: Locale) => {
            const view = new PlainItemView(locale);
            view.setTemplate({ tag: "span", attributes: { class: ["ck"] } });
            return view;
        });

        // A dropdown whose button carries an icon and no label.
        this.editor.ui.componentFactory.add("iconOnly", (locale: Locale) => {
            const dropdown = createDropdown(locale);
            dropdown.buttonView.set({ icon: "<svg />" });

            const items = new Collection<ListDropdownItemDefinition>();
            items.add({ type: "button", model: new UIModel({ label: "Row", withText: true }) });
            addListToDropdown(dropdown, items);

            return dropdown;
        });

        // Like `headingCompact`: a list of exclusive rows, opened as a menu of its own.
        this.editor.ui.componentFactory.add("level", (locale: Locale) => {
            const dropdown = createDropdown(locale);
            dropdown.buttonView.set({ label: "Level", icon: "<svg />" });

            const items = new Collection<ListDropdownItemDefinition>();
            for (const name of ["Low", "High"]) {
                items.add({ type: "button", model: new UIModel({
                    label: name, withText: true, role: "menuitemradio", isOn: name === level,
                    class: `level-${name.toLowerCase()}`
                }) });
            }
            addListToDropdown(dropdown, items);
            dropdown.on("execute", (evt) => {
                level = (evt.source as ButtonView).label ?? "";
            });
            openListAsMenu(dropdown, { layout: "tiles" });

            return dropdown;
        });

        // Like `tableRow`: a switch among the rows of its list.
        this.editor.ui.componentFactory.add("rows", (locale: Locale) => {
            const dropdown = createDropdown(locale);
            dropdown.buttonView.set({ label: "Rows", icon: "<svg />" });

            const items = new Collection<ListDropdownItemDefinition>();
            items.add({ type: "switchbutton", model: new UIModel({ label: "Header row", withText: true, isOn: true }) });
            items.add({ type: "button", model: new UIModel({ label: "Insert row", withText: true }) });
            addListToDropdown(dropdown, items);
            openListAsMenu(dropdown);

            return dropdown;
        });

        // A dropdown whose entries the plugin cannot read from its views, which it describes itself.
        this.editor.ui.componentFactory.add("described", (locale: Locale) => {
            const dropdown = createDropdown(locale);
            dropdown.buttonView.set({ label: "Described", icon: "<svg />" });
            openListAsMenu(dropdown, {
                describe: (run) => [
                    { kind: "entry", label: `Now: ${now}`, iconClass: "bx bx-time", isEnabled: true, run: run(() => insertedSamples.push(now)) },
                    { kind: "heading", label: "Later" },
                    { kind: "entry", label: "Never", isEnabled: false }
                ]
            });
            return dropdown;
        });

        // A dropdown with no list of its own, which the menu has no rows to draw for.
        this.editor.ui.componentFactory.add("panelOnly", (locale: Locale) => {
            const dropdown = createDropdown(locale);
            dropdown.buttonView.set({ label: "Panel only", icon: "<svg />" });
            dropdown.panelView.children.add(new ButtonView(locale));
            return dropdown;
        });

        // A dropdown handed to `openListAsMenu` that holds no list after all.
        this.editor.ui.componentFactory.add("listless", (locale: Locale) => {
            const dropdown = createDropdown(locale);
            dropdown.buttonView.set({ label: "Listless", icon: "<svg />" });
            openListAsMenu(dropdown);
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

/** A host that records what it is asked to show, as the client's `Menu` would draw it. */
function createHost() {
    const requests: ToolbarGroupMenuRequest[] = [];
    const host = {
        show: vi.fn((request: ToolbarGroupMenuRequest) => {
            requests.push(request);
        }),
        hide: vi.fn(),
        destroy: vi.fn()
    } satisfies ToolbarGroupMenuHost;

    return {
        host,
        config: { toolbarGroupMenu: { host: () => host } },
        /** The request of the menu shown last. */
        last() {
            const request = requests.at(-1);
            if (!request) {
                throw new Error("The host was asked to show no menu.");
            }
            return request;
        }
    };
}

describe("ToolbarGroupMenu", () => {
    it("hands a group marked with asMenu to the host as entries, ruled as the group was", async () => {
        const { host, config, last } = createHost();
        const editor = await createTestEditor(PLUGINS, {
            ...config,
            toolbar: { items: ["bold", MENU_GROUP, PLAIN_GROUP] }
        });

        const dropdown = groupDropdown(getToolbar(editor), "Insert");
        dropdown.buttonView.fire("open");

        // The dropdown never opens its own panel; the host's menu opens under its button.
        expect(dropdown.isOpen).toBe(false);
        expect(host.show).toHaveBeenCalledTimes(1);
        expect(last().anchor).toBe(dropdown.buttonView.element);
        expect(labels(last().items)).toStrictEqual(["Bold", "—", "Italic", "Insert sample"]);
        expect(last().layout).toBeUndefined();

        // Each entry carries the icon and the enabled state of the toolbar item it stands for, as
        // they are when the menu opens: `bold` is disabled while the editor is read-only.
        const bold = entry(last().items, "Bold");
        expect(bold.icon).toBeTruthy();
        expect(bold.isEnabled).toBe(true);

        last().onClose(false);
        editor.enableReadOnlyMode("spec");
        dropdown.buttonView.fire("open");
        expect(entry(last().items, "Bold").isEnabled).toBe(false);

        // A group not marked opens its own panel, as CKEditor has it.
        const plain = groupDropdown(getToolbar(editor), "Plain");
        plain.isOpen = true;
        expect(plain.isOpen).toBe(true);
        expect(host.show).toHaveBeenCalledTimes(2);
    });

    it("hands the host the layout a group asks for in asMenu", async () => {
        const { config, last } = createHost();
        const editor = await createTestEditor(PLUGINS, {
            ...config,
            toolbar: { items: [{ ...MENU_GROUP, asMenu: { layout: "tiles" } }] }
        });

        groupDropdown(getToolbar(editor), "Insert").buttonView.fire("open");
        expect(labels(last().items)).toStrictEqual(["Bold", "—", "Italic", "Insert sample"]);
        expect(last().layout).toBe("tiles");
    });

    it("describes an entry carrying a list of its own as a submenu, read on each open", async () => {
        const { config, last } = createHost();
        const editor = await createTestEditor(PLUGINS, {
            ...config,
            toolbar: { items: [{ ...MENU_GROUP, items: ["samples", "clock"] }] }
        });

        const dropdown = groupDropdown(getToolbar(editor), "Insert");
        dropdown.isOpen = true;

        const samples = entry(last().items, "Insert sample");
        expect(samples.icon).toBe("<svg />");
        expect(labels(samples.children ?? [])).toStrictEqual(["Flowchart", "Sequence"]);

        // A split button runs its own action from the submenu's opener; a plain dropdown only
        // opens its submenu.
        samples.run?.();
        expect(blankInserts).toHaveBeenCalled();
        expect(entry(last().items, "Clock").run).toBeUndefined();

        // `clock`, like `dateTime`, fills its list as it opens, so each menu reads it afresh.
        expect(labels(entry(last().items, "Clock").children ?? [])).toStrictEqual(["noon"]);
        now = "half past";
        dropdown.isOpen = true;
        expect(labels(entry(last().items, "Clock").children ?? [])).toStrictEqual(["half past"]);
    });

    it("runs the toolbar item an entry stands for, hiding the menu first", async () => {
        const { host, config, last } = createHost();
        const editor = await createTestEditor(PLUGINS, {
            ...config,
            toolbar: { items: [MENU_GROUP] }
        });

        const dropdown = groupDropdown(getToolbar(editor), "Insert");
        dropdown.isOpen = true;
        const order: string[] = [];
        host.hide.mockImplementation(() => order.push("hide"));
        editor.commands.get("bold")?.on("execute", () => order.push("bold"));

        entry(last().items, "Bold").run?.();
        expect(order).toStrictEqual(["hide", "bold"]);
        expect(editor.commands.get("bold")?.value).toBe(true);
        expect(editor.editing.view.document.isFocused).toBe(true);

        dropdown.isOpen = true;
        const sequence = entry(entry(last().items, "Insert sample").children ?? [], "Sequence");
        sequence.run?.();
        expect(insertedSamples).toStrictEqual(["Sequence"]);
    });

    it("toggles the menu from the group's button, and returns focus to it on Escape", async () => {
        const { host, config, last } = createHost();
        const editor = await createTestEditor(PLUGINS, {
            ...config,
            toolbar: { items: [MENU_GROUP] }
        });

        const dropdown = groupDropdown(getToolbar(editor), "Insert");
        dropdown.buttonView.fire("open");
        dropdown.buttonView.fire("open");
        expect(host.show).toHaveBeenCalledTimes(1);
        expect(host.hide).toHaveBeenCalledTimes(1);

        // The ▼ key sets `isOpen` itself, past the button.
        dropdown.isOpen = true;
        expect(host.show).toHaveBeenCalledTimes(2);

        // Closed by the host, the menu opens again on the next press rather than toggling shut.
        last().onClose(true);
        expect(document.activeElement).toBe(dropdown.buttonView.element);
        dropdown.buttonView.fire("open");
        expect(host.show).toHaveBeenCalledTimes(3);

        // A close that comes late, from a menu since replaced, leaves the shown one alone.
        const first = last();
        dropdown.buttonView.fire("open");
        dropdown.buttonView.fire("open");
        first.onClose(false);
        dropdown.buttonView.fire("open");
        expect(host.hide).toHaveBeenCalledTimes(3);
    });

    it("gives the text the focus as its button closes a menu in the keyboard's place", async () => {
        const { host } = createHost();
        const inPlaceOfKeyboard = vi.fn(() => false);
        const editor = await createTestEditor(PLUGINS, {
            toolbarGroupMenu: {
                host: () => Object.assign(host, { isInPlaceOfKeyboard: inPlaceOfKeyboard })
            },
            toolbar: { items: [MENU_GROUP] }
        });
        const focusText = vi.spyOn(editor.editing.view, "focus");
        const dropdown = groupDropdown(getToolbar(editor), "Insert");

        dropdown.buttonView.fire("open");
        dropdown.buttonView.fire("open");
        expect(host.hide).toHaveBeenCalledTimes(1);
        expect(focusText).not.toHaveBeenCalled();

        // The press that closes it brings the keyboard back, which a later focus would not.
        inPlaceOfKeyboard.mockReturnValue(true);
        dropdown.buttonView.fire("open");
        dropdown.buttonView.fire("open");
        expect(host.hide).toHaveBeenCalledTimes(2);
        expect(focusText).toHaveBeenCalledOnce();
    });

    it("counts the menu's element as the editor's own while it is shown", async () => {
        const { config, last } = createHost();
        const editor = await createTestEditor(PLUGINS, {
            ...config,
            toolbar: { items: [MENU_GROUP] }
        });

        groupDropdown(getToolbar(editor), "Insert").isOpen = true;
        const element = document.createElement("div");
        document.body.appendChild(element);
        const pressesReachingDocument = vi.fn();
        document.addEventListener("mousedown", pressesReachingDocument);

        last().setElement(element);
        expect(editor.ui.focusTracker.elements).toContain(element);
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        expect(pressesReachingDocument).not.toHaveBeenCalled();

        last().setElement(null);
        expect(editor.ui.focusTracker.elements).not.toContain(element);
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        expect(pressesReachingDocument).toHaveBeenCalledTimes(1);

        document.removeEventListener("mousedown", pressesReachingDocument);
        element.remove();
    });

    it("keeps the toolbar's overflow dropdown open around the menu, and closes it on a run", async () => {
        const { config, last } = createHost();
        const editor = await createTestEditor(PLUGINS, {
            ...config,
            toolbar: { items: ["bold", "italic", MENU_GROUP] }
        });

        // The suite loads no editor stylesheet, so the items would wrap rather than overflow.
        const style = document.createElement("style");
        style.textContent = ".ck.ck-toolbar, .ck.ck-toolbar__items { display: flex; flex-wrap: nowrap; }";
        document.head.appendChild(style);
        const toolbar = getToolbar(editor);
        if (toolbar.element) {
            toolbar.element.style.width = "60px";
        }
        const overflow = await vi.waitFor(() => {
            const found = [...toolbar.children].find((child): child is DropdownView =>
                child instanceof DropdownView && child.class?.includes("ck-toolbar__grouped-dropdown") === true);
            if (!found) {
                throw new Error("The toolbar grouped no items yet.");
            }
            return found;
        });

        overflow.isOpen = true;
        groupDropdown(toolbar, "Insert").isOpen = true;
        const element = document.createElement("div");
        document.body.appendChild(element);
        last().setElement(element);
        expect(overflow.focusTracker.elements).toContain(element);

        entry(last().items, "Italic").run?.();
        expect(overflow.isOpen).toBe(false);
        expect(editor.commands.get("italic")?.value).toBe(true);

        last().setElement(null);
        element.remove();
        style.remove();
    });

    it("passes over items it has no entry for, and rules that would lead, end or double", async () => {
        const { config, last } = createHost();
        const editor = await createTestEditor(PLUGINS, {
            ...config,
            toolbar: {
                items: [{
                    ...MENU_GROUP,
                    items: [
                        "plainView", "|", "bold", "-", "panelOnly", "|", "italic", "oddList",
                        "iconOnly", "|", "plainView"
                    ]
                }]
            }
        });

        groupDropdown(getToolbar(editor), "Insert").isOpen = true;
        expect(labels(last().items)).toStrictEqual(["Bold", "—", "Italic", "Odd list", ""]);
        // A list's group is a heading over its rows, and an unlabeled button or dropdown is named "".
        const odd = entry(last().items, "Odd list").children ?? [];
        expect(labels(odd)).toStrictEqual(["First", "—", "", "Grouped", "Inside"]);
        expect(odd[3]?.kind).toBe("heading");
        expect(labels(entry(last().items, "").children ?? [])).toStrictEqual(["Row"]);
    });

    it("reads a list inside a search panel, and draws an empty list as a disabled entry", async () => {
        const { config, last } = createHost();
        const editor = await createTestEditor(PLUGINS, {
            ...config,
            toolbar: { items: ["iconOnly", "listless", { ...MENU_GROUP, items: ["searched", "emptyList", "panelOnly"] }] }
        });

        groupDropdown(getToolbar(editor), "Insert").isOpen = true;
        expect(labels(last().items)).toStrictEqual(["Searched", "Empty"]);

        const searched = entry(last().items, "Searched");
        expect(labels(searched.children ?? [])).toStrictEqual(["Greeting"]);
        entry(searched.children ?? [], "Greeting").run?.();
        expect(insertedSamples).toStrictEqual(["Greeting"]);

        const empty = entry(last().items, "Empty");
        expect([empty.isEnabled, empty.children, empty.run]).toStrictEqual([false, undefined, undefined]);

        // A dropdown handed to `openListAsMenu` without a list opens an empty menu.
        groupDropdown(getToolbar(editor), "Listless").buttonView.fire("open");
        expect(last().items).toStrictEqual([]);
    });

    it("converts a group of the block toolbar, filled after the plugin is set up", async () => {
        const { BlockToolbar } = await import("ckeditor5");
        const { config, last } = createHost();
        const editor = await createTestEditor([BlockToolbar, ...PLUGINS], {
            ...config,
            toolbar: { items: ["bold"] },
            blockToolbar: [MENU_GROUP]
        });

        groupDropdown(editor.plugins.get(BlockToolbar).toolbarView, "Insert").isOpen = true;
        expect(labels(last().items)).toStrictEqual(["Bold", "—", "Italic", "Insert sample"]);
    });

    // A real `BalloonEditor`, whose UI view carries no fixed bar at all: the group is reached
    // through the plugin holding the selection toolbar, and nowhere else.
    it("converts a group of the selection balloon, and destroys the host with the editor", async () => {
        const { BalloonEditor, BalloonToolbar } = await import("ckeditor5");
        const { host, config, last } = createHost();
        const editor: Editor = await createTestEditorOf(BalloonEditor, PLUGINS, {
            ...config,
            toolbar: [MENU_GROUP]
        });

        expect((editor.ui.view as { toolbar?: ToolbarView }).toolbar).toBeUndefined();
        groupDropdown(editor.plugins.get(BalloonToolbar).toolbarView, "Insert").isOpen = true;
        expect(labels(last().items)).toStrictEqual(["Bold", "—", "Italic", "Insert sample"]);

        await editor.destroy();
        expect(host.destroy).toHaveBeenCalled();
    });

    it("opens a dropdown handed to openListAsMenu as a menu of its rows, with the one on checked", async () => {
        const { host, config, last } = createHost();
        const editor = await createTestEditor(PLUGINS, {
            ...config,
            toolbar: { items: ["bold", "level"] }
        });

        const dropdown = groupDropdown(getToolbar(editor), "Level");
        dropdown.buttonView.fire("open");

        expect(dropdown.isOpen).toBe(false);
        expect(host.show).toHaveBeenCalledTimes(1);
        expect(last().anchor).toBe(dropdown.buttonView.element);
        expect(labels(last().items)).toStrictEqual(["Low", "High"]);
        expect(last().layout).toBe("tiles");
        expect(entry(last().items, "Low").isOn).toBe(false);
        expect(entry(last().items, "High").isOn).toBe(true);
        expect(entry(last().items, "High").className).toBe("level-high");

        entry(last().items, "Low").run?.();
        expect(level).toBe("Low");
        expect(host.hide).toHaveBeenCalled();

        // A button that is neither toggled nor a choice in a list says nothing of being on.
        const { config: groupConfig, last: lastGroup } = createHost();
        const other = await createTestEditor(PLUGINS, {
            ...groupConfig,
            toolbar: { items: [{ ...MENU_GROUP, items: ["bold", "samples"] }] }
        });
        groupDropdown(getToolbar(other), "Insert").isOpen = true;
        expect(entry(lastGroup().items, "Bold").isOn).toBe(false);
        const samples = entry(lastGroup().items, "Insert sample");
        expect(samples.isOn).toBeUndefined();
        expect(samples.children?.map((child) => child.kind === "entry" && child.isOn)).toStrictEqual([undefined, undefined]);
    });

    it("marks a switch among the rows of a list, which the host draws as a toggle", async () => {
        const { config, last } = createHost();
        const editor = await createTestEditor(PLUGINS, { ...config, toolbar: { items: ["rows"] } });

        groupDropdown(getToolbar(editor), "Rows").buttonView.fire("open");
        expect(entry(last().items, "Header row")).toMatchObject({ isSwitch: true, isOn: true });
        expect(entry(last().items, "Insert row").isSwitch).toBeUndefined();
    });

    it("opens the entries a dropdown handed to openListAsMenu describes, read on each open", async () => {
        const { host, config, last } = createHost();
        const editor = await createTestEditor(PLUGINS, {
            ...config,
            toolbar: { items: ["bold", "described"] }
        });

        const dropdown = groupDropdown(getToolbar(editor), "Described");
        dropdown.buttonView.fire("open");
        expect(dropdown.isOpen).toBe(false);
        expect(last().items).toStrictEqual([
            { kind: "entry", label: "Now: noon", iconClass: "bx bx-time", isEnabled: true, run: expect.any(Function) },
            { kind: "heading", label: "Later" },
            { kind: "entry", label: "Never", isEnabled: false }
        ]);
        expect("describe" in last()).toBe(false);

        // The menu hides before the entry runs, as for a toolbar item.
        entry(last().items, "Now: noon").run?.();
        expect(host.hide).toHaveBeenCalled();
        expect(insertedSamples).toStrictEqual(["noon"]);

        now = "dusk";
        dropdown.buttonView.fire("open");
        expect(labels(last().items)[0]).toBe("Now: dusk");
    });

    it("leaves a dropdown handed to openListAsMenu to CKEditor when no host is configured", async () => {
        const editor = await createTestEditor(PLUGINS, {
            toolbar: { items: ["level"] }
        });

        const dropdown = groupDropdown(getToolbar(editor), "Level");
        dropdown.isOpen = true;
        expect(dropdown.isOpen).toBe(true);
    });

    it("leaves a group marked with asMenu to CKEditor when no host is configured", async () => {
        const editor = await createTestEditor(PLUGINS, {
            toolbar: { items: [MENU_GROUP] }
        });

        const dropdown = groupDropdown(getToolbar(editor), "Insert");
        dropdown.isOpen = true;
        expect(dropdown.isOpen).toBe(true);
    });
});

function getToolbar(editor: ClassicEditor) {
    return (editor.ui.view as { toolbar: ToolbarView }).toolbar;
}

function groupDropdown(toolbar: ToolbarView, label: string) {
    const dropdown = [...toolbar.items].find((item): item is DropdownView =>
        item instanceof DropdownView && item.buttonView.label === label);
    if (!dropdown) {
        throw new Error(`No "${label}" group dropdown in the toolbar.`);
    }

    return dropdown;
}

/** The labels of `items`, with a rule written as an em dash. */
function labels(items: ToolbarGroupMenuItem[]) {
    return items.map((item) => (item.kind === "separator" ? "—" : item.label));
}

function entry(items: ToolbarGroupMenuItem[], label: string) {
    const found = items.find((item): item is ToolbarGroupMenuEntry =>
        item.kind === "entry" && item.label === label);
    if (!found) {
        throw new Error(`No "${label}" entry in the menu.`);
    }

    return found;
}
