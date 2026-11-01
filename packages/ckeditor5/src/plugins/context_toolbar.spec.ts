import {
    _setModelData as setModelData,
    ButtonView, type ClassicEditor, ContextualBalloon, DropdownView, Essentials, IconLink, Image, ImageStyle, ImageToolbar,
    IconBulletedList, IconNumberedList, IconPreviousArrow, IconThreeVerticalDots, IconTodoList, IconTable, Link, LinkUI, List, ListProperties, Paragraph, TodoList, Table, TableCaption, TableToolbar, ToolbarSeparatorView,
    type ViewElement, WidgetToolbarRepository
} from "ckeditor5";
import bxPencil from "boxicons/svg/regular/bx-pencil.svg?raw";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ContextToolbar from "./context_toolbar.js";
import ImagePosition from "./image_position.js";
import LinkEmbedToolbar from "./link_embed/link_embed_toolbar.js";
import MobileToolbarItems from "./mobile_toolbar_items.js";
import { getActiveTaskStates } from "./todo_list_multistate/todo_list_multistate_editing.js";
import TodoListMultistateToolbar from "./todo_list_multistate/todo_list_multistate_toolbar.js";
import TodoListMultistateUI from "./todo_list_multistate/todo_list_multistate_ui.js";
import ToolbarGroupMenu, { type ToolbarGroupMenuRequest } from "./toolbar_group_menu.js";

const TABLE = "<table><tableRow><tableCell><paragraph>a[]</paragraph></tableCell></tableRow></table><paragraph>b</paragraph>";

describe("ContextToolbar", () => {
    async function createEditor(toolbar = ["undo", "contextToolbar"]) {
        const editor = await createTestEditor([Essentials, Paragraph, Table, TableCaption, TableToolbar, ContextToolbar], {
            toolbar,
            table: { contentToolbar: ["tableColumn", "tableRow"], tableToolbar: ["toggleTableCaption"] }
        });
        editor.ui.focusTracker.isFocused = true;
        return { editor, plugin: editor.plugins.get(ContextToolbar) };
    }

    it("shows its button while the selection is in a widget with a toolbar, in place of that toolbar's balloon", async () => {
        const { editor } = await createEditor();
        const button = getButton(editor);
        setModelData(editor.model, "<paragraph>b[]</paragraph>");
        editor.ui.update();
        expect(button.isVisible).toBe(false);

        setModelData(editor.model, TABLE);
        editor.ui.update();
        // A chip naming the widget, with the toolbar's own name as its tooltip.
        expect(button).toMatchObject({
            isVisible: true, label: "Table", withText: true, icon: IconTable, tooltip: "Table toolbar",
            class: "ck-context-toolbar-button"
        });
        expect(editor.plugins.get(WidgetToolbarRepository).isEnabled).toBe(false);
    });

    it("swaps in the items of that toolbar after a back button, and out from the back button", async () => {
        const { editor, plugin } = await createEditor();
        const button = getButton(editor);
        const focus = vi.spyOn(editor.editing.view, "focus");
        setModelData(editor.model, TABLE);
        editor.ui.update();

        button.fire("execute");
        expect(plugin.isActive).toBe(true);
        expect(focus).toHaveBeenCalledTimes(1);
        const [back, separator, chip, ...items] = [...plugin.toolbarView.items];
        expect(back).toMatchObject({ label: "Back", withText: false, icon: IconPreviousArrow, tooltip: true });
        // A title naming the widget the tools act on, which is not a button.
        expect(chip).not.toBeInstanceOf(ButtonView);
        expect(chip).toMatchObject({ isVisible: true, label: "Table", icon: IconTable });
        expect(chip.element?.classList).toContain("ck-context-toolbar-title");
        expect(chip.element?.textContent).toBe("Table");
        expect(chip.element?.querySelector("svg")).not.toBeNull();
        expect(separator).toBeInstanceOf(ToolbarSeparatorView);
        expect(items.map((item) => (item as { buttonView?: ButtonView }).buttonView?.label)).toStrictEqual(["Column", "Row"]);
        expect(editor.ui.focusTracker.elements).toContain(plugin.toolbarView.element);

        (back as ButtonView).fire("execute");
        expect(plugin.isActive).toBe(false);
        expect(focus).toHaveBeenCalledTimes(2);
    });

    it("follows the toolbar of the widget at the selection, and swaps out as the selection leaves it", async () => {
        const { editor, plugin } = await createEditor();
        const button = getButton(editor);
        setModelData(editor.model, "[<table><tableRow><tableCell><paragraph>a</paragraph></tableCell></tableRow></table>]<paragraph>b</paragraph>");
        editor.ui.update();
        button.fire("execute");
        expect([...plugin.toolbarView.items].slice(3).map((item) => (item as ButtonView).label))
            .toStrictEqual(["Toggle caption on"]);

        editor.model.change((writer) => writer.setSelection(editor.model.document.getRoot()?.getChild(1) ?? null, "end"));
        editor.ui.update();
        expect(plugin.isActive).toBe(false);
        expect(button.isVisible).toBe(false);
    });

    it("opens the lists of its dropdowns as menus of the app, in place of their panels", async () => {
        const requests: ToolbarGroupMenuRequest[] = [];
        const host = { show: vi.fn((request: ToolbarGroupMenuRequest) => requests.push(request)), hide: vi.fn(), destroy: vi.fn() };
        const editor = await createTestEditor(
            [Essentials, Paragraph, Table, TableToolbar, ContextToolbar, ToolbarGroupMenu],
            {
                toolbar: ["contextToolbar"],
                table: { contentToolbar: ["tableColumn"] },
                toolbarGroupMenu: { host: () => host }
            }
        );
        editor.ui.focusTracker.isFocused = true;
        setModelData(editor.model, TABLE);
        editor.ui.update();
        getButton(editor).fire("execute");

        const column = [...editor.plugins.get(ContextToolbar).toolbarView.items][3] as DropdownView;
        column.buttonView.fire("open");
        expect(column.isOpen).toBe(false);
        const rows = requests.at(-1)?.items ?? [];
        expect(rows.flatMap((row) => (row.kind === "entry" ? [row.label] : []))).toContain("Insert column left");
    });

    it("keeps the layout a dropdown asks for itself", async () => {
        const requests: ToolbarGroupMenuRequest[] = [];
        const host = { show: vi.fn((request: ToolbarGroupMenuRequest) => requests.push(request)), hide: vi.fn(), destroy: vi.fn() };
        const editor = await createTestEditor(
            [Essentials, Paragraph, Image, ImageStyle, ImageToolbar, ImagePosition, ContextToolbar, ToolbarGroupMenu],
            {
                toolbar: ["contextToolbar"],
                image: { toolbar: ["imagePosition"] },
                toolbarGroupMenu: { host: () => host }
            }
        );
        editor.ui.focusTracker.isFocused = true;
        setModelData(editor.model, "[<imageBlock src=\"a.png\"></imageBlock>]<paragraph>b</paragraph>");
        editor.ui.update();
        getButton(editor).fire("execute");

        const position = [...editor.plugins.get(ContextToolbar).toolbarView.items][3] as DropdownView;
        position.buttonView.fire("open");
        expect(requests.at(-1)?.layout).toBe("tiles");
    });

    it("swaps in on its own for a widget selected whole, and not for a caret inside one", async () => {
        const { editor, plugin } = await createEditor();
        const selectTable = () => setModelData(editor.model, `[${TABLE.replace("a[]", "a").replace("</table>", "</table>]")}`);
        const toCell = () => editor.model.change((writer) => {
            const cell = editor.model.document.getRoot()?.getNodeByPath([0, 0, 0, 0]);
            writer.setSelection(cell ?? null, "end");
        });
        const toParagraph = () => editor.model.change((writer) => {
            writer.setSelection(editor.model.document.getRoot()?.getChild(1) ?? null, "end");
        });

        setModelData(editor.model, TABLE);
        editor.ui.update();
        expect(plugin.isActive).toBe(false);

        selectTable();
        editor.ui.update();
        expect(plugin.isActive).toBe(true);
        expect([...plugin.toolbarView.items].slice(3).map((item) => (item as ButtonView).label))
            .toStrictEqual(["Toggle caption on"]);

        // The back button holds while the selection stays on the widget.
        ([...plugin.toolbarView.items][0] as ButtonView).fire("execute");
        editor.ui.update();
        expect(plugin.isActive).toBe(false);

        // Moving into a cell swaps nothing in; leaving and selecting the table again does.
        toCell();
        editor.ui.update();
        expect(plugin.isActive).toBe(false);
        toParagraph();
        editor.ui.update();
        selectTable();
        editor.ui.update();
        expect(plugin.isActive).toBe(true);
    });

    it("offers the list toolbar for the innermost list, to-do lists included", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, List, ListProperties, TodoList, MobileToolbarItems, ContextToolbar], {
            toolbar: ["contextToolbar"],
            list: { properties: { styles: true, startIndex: true, reversed: true } },
            listToolbar: ["listTypeMenu", "listReversed"]
        });
        editor.ui.focusTracker.isFocused = true;
        const plugin = editor.plugins.get(ContextToolbar);
        const button = getButton(editor);

        setModelData(editor.model,
            "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"bulleted\">a</paragraph>"
            + "<paragraph listIndent=\"1\" listItemId=\"b\" listType=\"numbered\">b[]</paragraph>");
        editor.ui.update();
        expect(button).toMatchObject({ isVisible: true, label: "List", icon: IconNumberedList });
        // A caret in a list is in text, so the row waits for the chip.
        expect(plugin.isActive).toBe(false);
        button.fire("execute");
        expect([...plugin.toolbarView.items].slice(3).map((item) => (item as ButtonView).label))
            .toStrictEqual([undefined, "Reversed order"]);
        ([...plugin.toolbarView.items].at(-1) as ButtonView).fire("execute");
        expect([editor.commands.get("listReversed")?.value, plugin.isActive]).toStrictEqual([true, true]);

        setModelData(editor.model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"bulleted\">a[]</paragraph>");
        editor.ui.update();
        expect(button).toMatchObject({ isVisible: true, icon: IconBulletedList });

        setModelData(editor.model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">a[]</paragraph>");
        editor.ui.update();
        expect(button).toMatchObject({ isVisible: true, label: "List", icon: IconTodoList });

        setModelData(editor.model, "<paragraph>a[]</paragraph>");
        editor.ui.update();
        expect(button.isVisible).toBe(false);
    });

    it("opens the list toolbar as a list starts, and not as the caret enters one", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, List, ListProperties, TodoList, MobileToolbarItems, ContextToolbar], {
            toolbar: ["contextToolbar"],
            list: { properties: { styles: true } },
            listToolbar: ["listTypeMenu"]
        });
        editor.ui.focusTracker.isFocused = true;
        const plugin = editor.plugins.get(ContextToolbar);
        const back = plugin.toolbarView.items.first as ButtonView;

        setModelData(editor.model, "<paragraph>a[]</paragraph>");
        editor.execute("bulletedList");
        expect([plugin.source?.id, plugin.isActive]).toStrictEqual(["bulletedList", true]);

        // Closed, it stays closed as items are added.
        back.fire("execute");
        editor.execute("enter");
        expect([plugin.source?.id, plugin.isActive]).toStrictEqual(["bulletedList", false]);

        // A marker of the other kind starts a numbered list, which keeps the row open.
        editor.execute("listStyle", { type: "decimal" });
        expect([plugin.source?.id, plugin.isActive]).toStrictEqual(["numberedList", true]);
        editor.execute("todoList");
        expect([plugin.source?.id, plugin.isActive]).toStrictEqual(["todoList", true]);

        // Ending the list closes it.
        editor.execute("todoList");
        expect([plugin.source, plugin.isActive]).toStrictEqual([null, false]);

        setModelData(editor.model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"bulleted\">a[]</paragraph>");
        editor.ui.update();
        expect([plugin.source?.id, plugin.isActive]).toStrictEqual(["bulletedList", false]);

        // Drawn anew while its row was never shown, the list still waits for the chip.
        const element = plugin.source?.element;
        editor.execute("listStyle", { type: "circle" });
        expect([plugin.source?.id, plugin.source?.element === element, plugin.isActive])
            .toStrictEqual(["bulletedList", false, false]);
    });

    it("adds the task states to the row of a to-do list", async () => {
        const editTaskStates = vi.fn();
        const editor = await createTestEditor([Essentials, Paragraph, List, ListProperties, TodoListMultistateUI, MobileToolbarItems, ContextToolbar], {
            toolbar: ["contextToolbar"],
            list: { properties: { styles: true } },
            listToolbar: ["listTypeMenu"],
            editTaskStates
        });
        editor.ui.focusTracker.isFocused = true;
        const plugin = editor.plugins.get(ContextToolbar);
        const button = getButton(editor);
        const rowLabels = () => [...plugin.toolbarView.items].slice(3)
            .map((item) => (item instanceof ButtonView ? item.label : item instanceof DropdownView ? "menu" : "|"));

        setModelData(editor.model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"bulleted\">a[]</paragraph>");
        editor.ui.update();
        button.fire("execute");
        expect(rowLabels()).toStrictEqual(["menu"]);

        setModelData(editor.model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">a[]</paragraph>");
        editor.ui.update();
        button.fire("execute");
        const states = getActiveTaskStates(editor);
        expect(states.length).toBeGreaterThan(2);
        expect(rowLabels()).toStrictEqual([
            "menu", "|", ...states.map((state) => state.title || state.name), "|", "Edit task states"
        ]);

        const last = states.at(-1);
        const stateButton = [...plugin.toolbarView.items].find((item): item is ButtonView =>
            item instanceof ButtonView && item.label === (last?.title || last?.name));
        const element = plugin.source?.element;
        stateButton?.fire("execute");
        expect(editor.commands.get("setTaskState")?.value).toBe(last?.name);
        expect(stateButton?.isOn).toBe(true);
        // The list is drawn anew, and the row stays up for it.
        expect([plugin.source?.element === element, plugin.isActive]).toStrictEqual([false, true]);

        const edit = [...plugin.toolbarView.items].at(-1);
        expect(edit).toBeInstanceOf(ButtonView);
        // An icon of its own, as the row draws the pill of each button on its `::before`.
        expect(edit).toMatchObject({ icon: bxPencil, withText: false });
        (edit as ButtonView).fire("execute");
        expect(editTaskStates).toHaveBeenCalledOnce();
    });

    it("keeps the balloon of task states closed on a long press of a checkbox", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, List, ListProperties, TodoListMultistateToolbar, MobileToolbarItems, ContextToolbar], {
            toolbar: ["contextToolbar"],
            listToolbar: ["listTypeMenu"]
        });
        const plugin = editor.plugins.get(ContextToolbar);
        setModelData(editor.model, "<paragraph>[]Intro</paragraph>"
            + "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">a</paragraph>"
            + "<paragraph listIndent=\"0\" listItemId=\"b\" listType=\"todo\">b</paragraph>");
        const checkboxes = editor.editing.view.getDomRoot()
            ?.querySelectorAll<HTMLInputElement>(".todo-list__label input[type=\"checkbox\"]");
        const checkbox = checkboxes?.[1];
        expect(checkbox).toBeDefined();
        if (!checkbox) return;

        const onText = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        editor.editing.view.getDomRoot()?.querySelector("p")?.dispatchEvent(onText);
        expect([onText.defaultPrevented, plugin.isActive]).toStrictEqual([false, false]);

        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        checkbox.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(editor.plugins.get(ContextualBalloon).visibleView).toBeNull();
        expect(plugin.isActive).toBe(false);
        expect(editor.model.document.selection.getFirstPosition()?.parent)
            .toBe(editor.model.document.getRoot()?.getChild(0));
    });

    describe("for a link", () => {
        async function createLinkEditor(toolbar = ["undo", "contextToolbar"], decorators = {}) {
            const editor = await createTestEditor([Essentials, Paragraph, Link, ContextToolbar], {
                toolbar,
                link: { toolbar: ["editLink", "linkProperties", "unlink"], decorators }
            });
            editor.ui.focusTracker.isFocused = true;
            setModelData(editor.model, "<paragraph><$text linkHref=\"https://a.b\">li[]nk</$text> text</paragraph>");
            editor.ui.update();
            return editor;
        }

        it("offers the link toolbar as a chip while the caret is in a link, leaving out what the link cannot use", async () => {
            const editor = await createLinkEditor();
            const plugin = editor.plugins.get(ContextToolbar);
            const button = getButton(editor);
            expect(button).toMatchObject({ isVisible: true, label: "Link", icon: IconLink, withText: true });
            // A caret in a link is in text, so the row waits for the chip.
            expect(plugin.isActive).toBe(false);

            button.fire("execute");
            expect([...plugin.toolbarView.items].slice(3).map((item) => (item as ButtonView).label))
                .toStrictEqual(["Edit link", "Unlink"]);

            editor.model.change((writer) => writer.setSelection(editor.model.document.getRoot()?.getChild(0) ?? null, "end"));
            editor.ui.update();
            expect(plugin.isActive).toBe(false);
            expect(button.isVisible).toBe(false);

            // With a property a link can be given, the toolbar keeps its button.
            const withDecorators = await createLinkEditor(undefined, {
                openInNewTab: { mode: "manual", label: "Open in a new tab", attributes: { target: "_blank" } }
            });
            getButton(withDecorators).fire("execute");
            expect([...withDecorators.plugins.get(ContextToolbar).toolbarView.items].slice(3).map((item) => (item as ButtonView).label))
                .toStrictEqual(["Edit link", "Link properties", "Unlink"]);
        });

        it("swaps in on a tap in the link, which is about the link rather than its text", async () => {
            const editor = await createLinkEditor();
            const plugin = editor.plugins.get(ContextToolbar);

            click(editor);
            expect(plugin.isActive).toBe(true);
            expect([...plugin.toolbarView.items].slice(3).map((item) => (item as ButtonView).label))
                .toStrictEqual(["Edit link", "Unlink"]);

            // The back button holds while the caret stays in the link, until the next tap.
            ([...plugin.toolbarView.items][0] as ButtonView).fire("execute");
            editor.ui.update();
            expect(plugin.isActive).toBe(false);
            click(editor);
            expect(plugin.isActive).toBe(true);

            // A tap outside any link swaps nothing in.
            editor.model.change((writer) => writer.setSelection(editor.model.document.getRoot()?.getChild(0) ?? null, "end"));
            editor.ui.update();
            click(editor);
            expect(plugin.isActive).toBe(false);
        });

        it("keeps the link toolbar out of the balloon, and leaves its form there", async () => {
            const editor = await createLinkEditor();
            const balloon = editor.plugins.get(ContextualBalloon);
            const linkUI = editor.plugins.get(LinkUI);

            click(editor);
            await Promise.resolve();
            expect(linkUI.toolbarView).not.toBeNull();
            expect(linkUI.toolbarView && balloon.hasView(linkUI.toolbarView)).toBe(false);

            getButton(editor).fire("execute");
            const edit = [...editor.plugins.get(ContextToolbar).toolbarView.items][3] as ButtonView;
            edit.fire("execute");
            expect(balloon.visibleView).toBe(linkUI.formView);

            // Without the chip, CKEditor's balloon is left as it is.
            const desktop = await createLinkEditor(["undo"]);
            click(desktop);
            await Promise.resolve();
            const desktopUI = desktop.plugins.get(LinkUI);
            expect(desktop.plugins.get(ContextualBalloon).visibleView).toBe(desktopUI.toolbarView);
        });
    });

    it("names the toolbar of a link preview after the link it is", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, LinkEmbedToolbar, ContextToolbar], {
            toolbar: ["contextToolbar"]
        });
        editor.ui.focusTracker.isFocused = true;
        setModelData(editor.model, "<paragraph>a[<linkMention url=\"https://a.b\"></linkMention>]b</paragraph>");
        editor.ui.update();

        expect(getButton(editor)).toMatchObject({ isVisible: true, label: "Link", icon: IconLink });
        expect([...editor.plugins.get(ContextToolbar).toolbarView.items][2]).toMatchObject({ label: "Link" });
    });

    it("names the toolbar of each widget, or takes the toolbar's own label for a widget it has no name for", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, ContextToolbar], { toolbar: ["contextToolbar"] });
        editor.ui.focusTracker.isFocused = true;
        const plugin = editor.plugins.get(ContextToolbar);
        const names: Record<string, string | undefined> = {
            codeblock: "Code block", inlineCode: "Code", admonition: "Admonition", tabs: "Tabs",
            multicolumnLayout: "Columns", contentEmbed: "Embed", other: undefined
        };
        // Stand-ins for the toolbars of those widgets, each for the paragraph while it is the current one.
        let current = "";
        for (const id of Object.keys(names)) {
            editor.plugins.get(WidgetToolbarRepository).register(id, {
                ariaLabel: `${id} toolbar`, items: ["undo"],
                getRelatedElement: (selection) => (current === id ? selection.getFirstPosition()?.parent as ViewElement : null)
            });
        }
        setModelData(editor.model, "<paragraph>a[]</paragraph>");
        const button = getButton(editor);

        for (const [id, name] of Object.entries(names)) {
            current = id;
            editor.ui.update();
            button.fire("execute");
            const title = [...plugin.toolbarView.items][2];
            if (name) {
                expect(button).toMatchObject({ label: name, withText: true, tooltip: `${id} toolbar` });
                expect(title).toMatchObject({ isVisible: true, label: name });
            } else {
                expect(button).toMatchObject({ label: "other toolbar", withText: false, icon: IconThreeVerticalDots });
                expect(title).toMatchObject({ isVisible: false, label: "", icon: "" });
            }
        }
    });

    it("takes over the balloons only in an editor whose toolbar holds its button, at any depth", async () => {
        const { editor } = await createEditor(["undo"]);
        expect(editor.plugins.get(WidgetToolbarRepository).isEnabled).toBe(true);

        const unset = await createTestEditor([Essentials, Paragraph, Table, TableToolbar, ContextToolbar], {});
        expect(unset.plugins.get(WidgetToolbarRepository).isEnabled).toBe(true);

        const nested = await createTestEditor([Essentials, Paragraph, Table, TableToolbar, ContextToolbar], {
            toolbar: { items: ["undo", { label: "More", items: ["contextToolbar"] }] }
        });
        expect(nested.plugins.get(WidgetToolbarRepository).isEnabled).toBe(false);
    });
});

/** A click in the editing view, as `LinkUI` opens its toolbar on. */
function click(editor: ClassicEditor) {
    const domEvent = new MouseEvent("click");
    editor.editing.view.document.fire("click", {
        domEvent, domTarget: document.body, preventDefault: () => undefined, stopPropagation: () => undefined
    });
}

function getButton(editor: ClassicEditor) {
    const item = [...editor.ui.view.toolbar.items].find((view) => view instanceof ButtonView && !view.label?.startsWith("Undo"));
    if (!(item instanceof ButtonView)) throw new Error("expected the context toolbar button");
    return item;
}
