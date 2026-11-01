import { type TaskStateDef } from "@triliumnext/commons";
import { Autoformat, ClassicEditor, Essentials, List, Paragraph, TodoList, type ModelElement } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import TodoListMultistateAutoformat from "./todo_list_multistate_autoformat.js";
import TodoListMultistateEditing, { TASK_STATE_ATTRIBUTE } from "./todo_list_multistate_editing.js";

const TODO_LIST_CHECKED_ATTRIBUTE = "todoListChecked";

async function createEditor(config: Record<string, unknown> = {}): Promise<ClassicEditor> {
    return await createTestEditor(
        [Essentials, Paragraph, List, TodoList, Autoformat, TodoListMultistateEditing, TodoListMultistateAutoformat],
        config
    );
}

/** Type `text` into the editor one character at a time, as real typing (and thus autoformat) would. */
function type(editor: ClassicEditor, text: string): void {
    for (const ch of text) {
        editor.execute("insertText", { text: ch });
    }
}

function getBlock(editor: ClassicEditor, index: number): ModelElement {
    const child = editor.model.document.getRoot()?.getChild(index);
    if (!child || !child.is("element")) {
        throw new Error(`No element block at index ${index}.`);
    }
    return child;
}

describe("TodoListMultistateAutoformat", () => {
    let editor: ClassicEditor;

    describe("with the default states", () => {
        beforeEach(async () => {
            editor = await createEditor();
        });

        it("loads the plugin", () => {
            expect(editor.plugins.get(TodoListMultistateAutoformat)).toBeInstanceOf(TodoListMultistateAutoformat);
        });

        it("turns `[/] ` into a todo item in the 'doing' state", () => {
            type(editor, "[/] ");
            const block = getBlock(editor, 0);
            expect(block.getAttribute("listType")).toBe("todo");
            expect(block.getAttribute(TASK_STATE_ATTRIBUTE)).toBe("doing");
            // "doing" is not a completed state, so the box stays unchecked.
            expect(block.getAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBeFalsy();
            // The trigger text is consumed, leaving an empty task.
            expect(block.isEmpty).toBe(true);
        });

        it("turns `[-] ` into a todo item in the 'cancelled' state", () => {
            type(editor, "[-] ");
            const block = getBlock(editor, 0);
            expect(block.getAttribute("listType")).toBe("todo");
            expect(block.getAttribute(TASK_STATE_ATTRIBUTE)).toBe("cancelled");
        });

        it("escapes regex-metacharacter markers — `[?] ` becomes the 'maybe' state", () => {
            type(editor, "[?] ");
            const block = getBlock(editor, 0);
            expect(block.getAttribute("listType")).toBe("todo");
            expect(block.getAttribute(TASK_STATE_ATTRIBUTE)).toBe("maybe");
        });

        it("leaves the native `[ ]` / `[x]` markers to upstream (no custom state attached)", () => {
            type(editor, "[x] ");
            const block = getBlock(editor, 0);
            expect(block.getAttribute("listType")).toBe("todo");
            expect(block.hasAttribute(TASK_STATE_ATTRIBUTE)).toBe(false);
            expect(block.getAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(true);
        });
    });

    describe("with custom states", () => {
        // A metacharacter marker (`*`) exercises escaping; a non-anchor state with no marker
        // exercises the skip branch; a hidden state must not get an autoformat rule.
        const CUSTOM_STATES: TaskStateDef[] = [
            { id: "_wip", name: "wip", title: "WIP", markdownSymbol: "*", isCompleted: false, icon: "bx bx-loader" },
            { id: "_nomark", name: "nomark", title: "No marker", markdownSymbol: "", isCompleted: false, icon: "bx bx-question-mark" },
            { id: "_hidden", name: "secret", title: "Secret", markdownSymbol: "h", isCompleted: false, icon: "bx bx-hide", isHidden: true }
        ];

        beforeEach(async () => {
            editor = await createEditor({ taskStates: CUSTOM_STATES });
        });

        it("autoformats a configured marker into its state", () => {
            type(editor, "[*] ");
            const block = getBlock(editor, 0);
            expect(block.getAttribute("listType")).toBe("todo");
            expect(block.getAttribute(TASK_STATE_ATTRIBUTE)).toBe("wip");
        });

        it("does not register a rule for a hidden state's marker", () => {
            type(editor, "[h] ");
            const block = getBlock(editor, 0);
            // No rule fired: still a plain paragraph carrying the literally typed text.
            expect(block.getAttribute("listType")).toBeUndefined();
        });
    });
});
