import { _setModelData as setModelData, ClassicEditor, keyCodes, List, Paragraph, TodoList, Typing, Undo, type ModelElement } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor, getEditorElement } from "../../test/editor-kit.js";
import CollapsibleListItems, { LIST_COLLAPSED_ATTRIBUTE, ToggleListCollapseCommand } from "./collapsible_list_items.js";

// Lists are flat in the model: sibling blocks related by listIndent/listItemId.
const LIST_FIXTURE =
    '<paragraph listIndent="0" listItemId="i-a" listType="bulleted">Parent[]</paragraph>' +
    '<paragraph listIndent="1" listItemId="i-b" listType="bulleted">Child</paragraph>' +
    '<paragraph listIndent="1" listItemId="i-c" listType="bulleted">Other child</paragraph>' +
    '<paragraph listIndent="0" listItemId="i-d" listType="bulleted">Sibling</paragraph>' +
    "<paragraph>Outside of the list</paragraph>";

describe("CollapsibleListItems", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([CollapsibleListItems, List, TodoList, Paragraph, Typing, Undo]);

        setModelData(editor.model, LIST_FIXTURE);
    });

    it("collapses and expands via the command and persists the state into the data", () => {
        const dataBefore = editor.getData();
        const command = editor.commands.get("toggleListCollapse");
        expect(command?.isEnabled).toBe(true);

        editor.execute("toggleListCollapse");

        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);
        expect(command?.value).toBe(true);

        const domRoot = editor.editing.view.getDomRoot();
        const collapsedItem = domRoot?.querySelector('li[data-trilium-collapsed="true"]');
        expect(collapsedItem).not.toBeNull();
        const nestedList = collapsedItem?.querySelector("ul");
        expect(nestedList).not.toBeNull();
        if (nestedList) {
            expect(getComputedStyle(nestedList).display).toBe("none");
        }

        expect(editor.getData()).toContain('data-trilium-collapsed="true"');

        editor.execute("toggleListCollapse");
        expect(getBlock(editor, 0).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
        expect(command?.value).toBe(false);
        expect(domRoot?.querySelector("li[data-trilium-collapsed]")).toBeNull();
        expect(editor.getData()).toBe(dataBefore);
    });

    it("round-trips the collapsed state through the data without expanding it on load", () => {
        editor.setData(
            '<ul><li data-trilium-collapsed="true">Parent<ul><li>Child</li></ul></li><li>Sibling</li></ul>');

        // Loading a collapsed subtree must not trigger the "content placed under a
        // collapsed parent" auto-expansion: the children arrive together with the parent.
        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);

        const domRoot = editor.editing.view.getDomRoot();
        const nestedList = domRoot?.querySelector('li[data-trilium-collapsed="true"] ul');
        expect(nestedList).not.toBeNull();
        if (nestedList) {
            expect(getComputedStyle(nestedList).display).toBe("none");
        }

        expect(editor.getData()).toContain('data-trilium-collapsed="true"');
    });

    it("normalizes away persisted state that has nothing to collapse", () => {
        editor.setData('<ul><li data-trilium-collapsed="true">No children</li></ul>');

        expect(getBlock(editor, 0).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
        expect(editor.getData()).not.toContain("data-trilium-collapsed");
    });

    it("collapse toggles are undoable", () => {
        const dataBefore = editor.getData();

        editor.execute("toggleListCollapse");
        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);

        editor.execute("undo");
        expect(getBlock(editor, 0).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
        expect(editor.getData()).toBe(dataBefore);
    });

    it("is only enabled on list items that have nested items", () => {
        const command = editor.commands.get("toggleListCollapse");

        setSelectionIn(editor, 1); // leaf child
        expect(command?.isEnabled).toBe(false);

        setSelectionIn(editor, 4); // outside of the list
        expect(command?.isEnabled).toBe(false);
    });

    it("applies to every block of a multi-block list item", () => {
        setModelData(editor.model,
            '<paragraph listIndent="0" listItemId="i-a" listType="bulleted">First[]</paragraph>' +
            '<paragraph listIndent="0" listItemId="i-a" listType="bulleted">Second</paragraph>' +
            '<paragraph listIndent="1" listItemId="i-b" listType="bulleted">Child</paragraph>');

        editor.execute("toggleListCollapse");
        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);
        expect(getBlock(editor, 1).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);

        editor.execute("toggleListCollapse");
        expect(getBlock(editor, 0).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
        expect(getBlock(editor, 1).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
    });

    it("expands automatically when the selection moves into a hidden item", () => {
        editor.execute("toggleListCollapse");
        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);

        setSelectionIn(editor, 1);

        expect(getBlock(editor, 0).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
        expect(editor.getData()).not.toContain("data-trilium-collapsed");
    });

    it("expands automatically when an item is indented under a collapsed parent", () => {
        editor.execute("toggleListCollapse");
        setSelectionIn(editor, 3); // "Sibling", still visible at indent 0

        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);

        editor.execute("indentList");

        expect(getBlock(editor, 3).getAttribute("listIndent")).toBe(1);
        expect(getBlock(editor, 0).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
    });

    it("drops the collapsed attribute from new items that have nothing to collapse", () => {
        // Simulates e.g. an Enter split copying the attribute onto the new block.
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                throw new Error("The editor has no root.");
            }
            const block = writer.createElement("paragraph", {
                listIndent: 0,
                listItemId: "i-z",
                listType: "bulleted",
                [LIST_COLLAPSED_ATTRIBUTE]: true
            });
            writer.insert(block, root, "end");
        });

        expect(getBlock(editor, 5).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
    });

    it("toggles when clicking the arrow in the gutter and ignores other clicks", () => {
        const domRoot = editor.editing.view.getDomRoot();
        const items = domRoot ? Array.from(domRoot.querySelectorAll("li")) : [];
        const parentItem = items.at(0);
        const leafItem = items.at(1);
        expect(parentItem).toBeDefined();
        expect(leafItem).toBeDefined();
        if (!parentItem || !leafItem) {
            return;
        }

        mouseDownAt(parentItem, -10); // on the gutter arrow
        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);

        mouseDownAt(parentItem, -10); // toggles back
        expect(getBlock(editor, 0).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);

        mouseDownAt(parentItem, 5); // inside the item box: not a gutter click
        expect(getBlock(editor, 0).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);

        mouseDownAt(leafItem, -10); // leaf items have nothing to collapse
        expect(getBlock(editor, 1).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
    });

    it("toggles when the rendered arrow is clicked at its real on-screen position", () => {
        // Unlike the test above (which dispatches straight onto the <li>), this reproduces a
        // genuine user click: it asks the browser what element actually sits at the arrow's
        // pixel coordinates and dispatches there — so it catches a mismatch between where the
        // arrow paints and what the mousedown handler receives as its target.

        // Shift the editor away from the viewport's left edge so the negative-inset gutter
        // (where the arrow lives) is actually on-screen and hit-testable.
        const editorElement = getEditorElement(editor);
        editorElement.style.marginLeft = "160px";
        editorElement.style.marginTop = "60px";

        const parentLi = editor.editing.view.getDomRoot()?.querySelector("li");
        expect(parentLi).toBeTruthy();
        if (!parentLi) {
            return;
        }

        const rect = parentLi.getBoundingClientRect();
        const fontSize = parseFloat(getComputedStyle(parentLi).fontSize);
        // CSS: inset-inline-start: -2.1em; width/height: 0.4em; top: 0.45em → aim at its centre.
        const x = Math.round(rect.left - 1.9 * fontSize);
        const y = Math.round(rect.top + 0.65 * fontSize);

        // Click whatever element actually sits at the arrow's coordinates — the real target,
        // not a forced <li> — so a mismatch between where the arrow paints and what the
        // handler receives would be caught.
        const hit = document.elementFromPoint(x, y);
        hit?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: x, clientY: y }));

        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);
    });

    it("toggles a to-do list item when its gutter arrow is clicked", () => {
        // To-do <li>s wrap content in <span class="todo-list__label">, which shifts the
        // view->model mapping; regression guard for that resolution (the click works for
        // bulleted lists but used to silently no-op on to-do lists).
        setModelData(editor.model,
            '<paragraph listIndent="0" listItemId="td-a" listType="todo">Parent[]</paragraph>' +
            '<paragraph listIndent="1" listItemId="td-b" listType="todo">Child</paragraph>' +
            '<paragraph listIndent="1" listItemId="td-c" listType="todo">Other child</paragraph>');

        const parentLi = editor.editing.view.getDomRoot()?.querySelector("li");
        expect(parentLi).toBeTruthy();
        if (!parentLi) {
            return;
        }

        const rect = parentLi.getBoundingClientRect();
        const fontSize = parseFloat(getComputedStyle(parentLi).fontSize);
        const x = Math.round(rect.left - 1.9 * fontSize);
        const y = Math.round(rect.top + 0.65 * fontSize);

        const hit = document.elementFromPoint(x, y);
        hit?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: x, clientY: y }));

        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);
    });

    it("resolves the model item from a to-do <li> via the command", () => {
        // Selection-independent of the click path: the command's getSelectedListBlock must
        // also work for to-do items (it does, via the selection), proving end to end.
        setModelData(editor.model,
            '<paragraph listIndent="0" listItemId="tc-a" listType="todo">Parent[]</paragraph>' +
            '<paragraph listIndent="1" listItemId="tc-b" listType="todo">Child</paragraph>');

        editor.execute("toggleListCollapse");
        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);
    });

    it("toggles via Ctrl+Alt+Enter on a collapsible item and ignores leaves", () => {
        pressCtrlAltEnter(editor); // selection starts in the parent
        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);

        pressCtrlAltEnter(editor);
        expect(getBlock(editor, 0).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);

        setSelectionIn(editor, 1); // leaf child: nothing to collapse
        pressCtrlAltEnter(editor);
        expect(getBlock(editor, 1).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
    });

    it("collapses to-do items via Ctrl+Alt+Enter without checking them", () => {
        setModelData(editor.model,
            '<paragraph listIndent="0" listItemId="ta-a" listType="todo">Parent[]</paragraph>' +
            '<paragraph listIndent="1" listItemId="ta-b" listType="todo">Child</paragraph>');

        pressCtrlAltEnter(editor);

        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);
        expect(getBlock(editor, 0).hasAttribute("todoListChecked")).toBe(false);
    });

    it("leaves Ctrl+Enter to the native to-do check (no longer bound to collapse)", () => {
        setModelData(editor.model,
            '<paragraph listIndent="0" listItemId="t-a" listType="todo">Parent[]</paragraph>' +
            '<paragraph listIndent="1" listItemId="t-b" listType="todo">Child</paragraph>');

        pressCtrlEnter(editor);

        // Collapse no longer touches Ctrl+Enter, so the native checkTodoList handles it.
        expect(getBlock(editor, 0).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
        expect(getBlock(editor, 0).getAttribute("todoListChecked")).toBe(true);
    });

    it("removes the data attribute in the view when the model attribute is set to false", () => {
        // The downcast strategy's setAttributeOnDowncast runs with a falsy value when the model
        // attribute is present but false (rather than removed), exercising its removeAttribute
        // branch directly.
        editor.execute("toggleListCollapse");
        const domRoot = editor.editing.view.getDomRoot();
        expect(domRoot?.querySelector("li[data-trilium-collapsed]")).not.toBeNull();

        editor.model.change((writer) => {
            writer.setAttribute(LIST_COLLAPSED_ATTRIBUTE, false, getBlock(editor, 0));
        });

        expect(domRoot?.querySelector("li[data-trilium-collapsed]")).toBeNull();
    });

    it("ignores a persisted data attribute whose value is not exactly \"true\"", () => {
        editor.setData(
            '<ul><li data-trilium-collapsed="false">Parent<ul><li>Child</li></ul></li></ul>');

        // The upcast converter maps anything other than "true" to null (no model attribute).
        expect(getBlock(editor, 0).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
        expect(editor.getData()).not.toContain("data-trilium-collapsed");
    });

    it("ignores a mousedown that does not target a list item", () => {
        // Click in the paragraph outside the list: data.target is not an <li>, so the handler
        // bails before resolving any block and nothing collapses.
        const domRoot = editor.editing.view.getDomRoot();
        const paragraph = domRoot?.querySelector("p");
        expect(paragraph).toBeTruthy();
        if (!paragraph) {
            return;
        }

        const rect = paragraph.getBoundingClientRect();
        paragraph.dispatchEvent(new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            clientX: rect.left - 10,
            clientY: rect.top + 5
        }));

        expect(getBlock(editor, 0).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
    });

    it("treats a click past the right edge as a gutter click in RTL", () => {
        const domRoot = editor.editing.view.getDomRoot();
        if (domRoot) {
            domRoot.setAttribute("dir", "rtl");
            domRoot.style.direction = "rtl";
        }

        const parentLi = domRoot?.querySelector("li");
        expect(parentLi).toBeTruthy();
        if (!parentLi) {
            return;
        }
        parentLi.style.direction = "rtl";

        const rect = parentLi.getBoundingClientRect();
        // In RTL the gutter sits to the right of the box; a click past rect.right is a gutter click.
        parentLi.dispatchEvent(new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            clientX: rect.right + 10,
            clientY: rect.top + 5
        }));

        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);
    });

    it("is a no-op when execute runs with no list item selected", () => {
        setSelectionIn(editor, 4); // the paragraph outside the list

        const command = editor.commands.get("toggleListCollapse");
        expect(command).toBeInstanceOf(ToggleListCollapseCommand);
        if (!(command instanceof ToggleListCollapseCommand)) {
            return;
        }
        // editor.execute() (and the decorated command.execute()) short-circuit a disabled
        // command before its body runs, so invoke the raw method to exercise its null-block
        // guard with a non-list selection active.
        expect(() => ToggleListCollapseCommand.prototype.execute.call(command)).not.toThrow();
        expect(getBlock(editor, 0).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
    });

    it("ignores list attribute changes whose target is not a list block", () => {
        // A listIndent change on the trailing range covers the postfixer branch where the
        // changed range's nodeAfter is not a resolvable list element.
        expect(() => editor.model.change((writer) => {
            const last = getBlock(editor, 4); // "Outside of the list" paragraph
            writer.setAttribute("listIndent", 0, last);
            writer.removeAttribute("listIndent", last);
        })).not.toThrow();

        expect(getBlock(editor, 0).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
    });

    it("does nothing when execute runs on a leaf list item", () => {
        setSelectionIn(editor, 1); // leaf child, no nested items

        const command = editor.commands.get("toggleListCollapse");
        expect(command?.isEnabled).toBe(false);
        expect(command).toBeInstanceOf(ToggleListCollapseCommand);
        if (!(command instanceof ToggleListCollapseCommand)) {
            return;
        }
        // Block exists but has nothing to collapse: the hasNestedItems guard short-circuits.
        expect(() => ToggleListCollapseCommand.prototype.execute.call(command)).not.toThrow();
        expect(getBlock(editor, 1).hasAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(false);
    });

    it("collapses from a selection in a later block of a multi-block item", () => {
        setModelData(editor.model,
            '<paragraph listIndent="0" listItemId="m-a" listType="bulleted">First</paragraph>' +
            '<paragraph listIndent="0" listItemId="m-a" listType="bulleted">Second[]</paragraph>' +
            '<paragraph listIndent="1" listItemId="m-b" listType="bulleted">Child</paragraph>');

        // Selection is in the second block, so getItemBlocks must walk back to the first one.
        editor.execute("toggleListCollapse");

        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);
        expect(getBlock(editor, 1).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);
    });

    it("treats a list block without a numeric indent as indent 0", () => {
        // listItemId present but no listIndent: getIndent falls back to 0, so a deeper sibling
        // still counts as nested and the item is collapsible.
        setModelData(editor.model,
            '<paragraph listItemId="n-a" listType="bulleted">Parent[]</paragraph>' +
            '<paragraph listIndent="1" listItemId="n-b" listType="bulleted">Child</paragraph>');

        const command = editor.commands.get("toggleListCollapse");
        expect(command?.isEnabled).toBe(true);

        editor.execute("toggleListCollapse");
        expect(getBlock(editor, 0).getAttribute(LIST_COLLAPSED_ATTRIBUTE)).toBe(true);
    });
});

function getBlock(editor: ClassicEditor, index: number): ModelElement {
    const child = editor.model.document.getRoot()?.getChild(index);
    if (!child || !child.is("element")) {
        throw new Error(`No element block at index ${index}.`);
    }
    return child;
}

function setSelectionIn(editor: ClassicEditor, blockIndex: number): void {
    editor.model.change((writer) => {
        writer.setSelection(writer.createPositionAt(getBlock(editor, blockIndex), 0));
    });
}

function pressCtrlAltEnter(editor: ClassicEditor): void {
    editor.editing.view.document.fire("keydown", {
        keyCode: keyCodes.enter,
        ctrlKey: true,
        altKey: true,
        preventDefault: () => {},
        stopPropagation: () => {}
    });
}

function pressCtrlEnter(editor: ClassicEditor): void {
    editor.editing.view.document.fire("keydown", {
        keyCode: keyCodes.enter,
        ctrlKey: true,
        preventDefault: () => {}
    });
}

function mouseDownAt(item: HTMLElement, offsetX: number): void {
    const rect = item.getBoundingClientRect();
    item.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + offsetX,
        clientY: rect.top + 5
    }));
}
