import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, Essentials, List, Paragraph, Plugin, TodoList, type ModelElement } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import TodoListUncheckOnEnter, { onTodoRowSplit } from "./todo_list_uncheck_on_enter.js";

const TODO_LIST_CHECKED_ATTRIBUTE = "todoListChecked";

function getBlock(editor: ClassicEditor, index: number): ModelElement {
    const child = editor.model.document.getRoot()?.getChild(index);
    if (!child || !child.is("element")) {
        throw new Error(`No element block at index ${index}.`);
    }
    return child;
}

describe("TodoListUncheckOnEnter", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, List, TodoList, TodoListUncheckOnEnter]);
    });

    it("loads the plugin and requires TodoList", () => {
        expect(editor.plugins.get(TodoListUncheckOnEnter)).toBeInstanceOf(TodoListUncheckOnEnter);
        expect(TodoListUncheckOnEnter.requires).toContain(TodoList);
    });

    it("starts a new todo row unchecked when splitting a checked row (#10084)", () => {
        setModelData(editor.model,
            '<paragraph listIndent="0" listItemId="t-a" listType="todo" todoListChecked="true">Task[]</paragraph>');
        editor.execute("enter");

        // The original row keeps its checked state; the new row is unchecked.
        expect(getBlock(editor, 0).getAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(true);
        const newRow = getBlock(editor, 1);
        expect(newRow.getAttribute("listType")).toBe("todo");
        expect(newRow.hasAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(false);
    });

    it("leaves a non-todo block untouched on Enter", () => {
        setModelData(editor.model, "<paragraph>Hello[]</paragraph>");
        editor.execute("enter");
        expect(getBlock(editor, 1).getAttribute("listType")).toBe(undefined);
        expect(getModelData(editor.model)).toContain("<paragraph>[]</paragraph>");
    });

    it("onTodoRowSplit is a no-op when the Enter command is absent", () => {
        // TodoList always pulls in the Enter feature, so simulate its absence with a stub plugin.
        const callback = vi.fn();
        const stub = { editor: { commands: { get: () => undefined } } } as unknown as Plugin;
        expect(() => onTodoRowSplit(stub, callback)).not.toThrow();
        expect(callback).not.toHaveBeenCalled();
    });
});
