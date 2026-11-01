import { ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import TodoListMultistate from "./todo_list_multistate.js";
import TodoListMultistateAutoformat from "./todo_list_multistate_autoformat.js";
import TodoListMultistateEditing from "./todo_list_multistate_editing.js";
import TodoListMultistateToolbar from "./todo_list_multistate_toolbar.js";
import TodoListMultistateUI from "./todo_list_multistate_ui.js";

describe("TodoListMultistate", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, TodoListMultistate]);
    });

    it("loads the plugin", () => {
        expect(editor.plugins.get(TodoListMultistate)).toBeInstanceOf(TodoListMultistate);
    });

    it("requires the sub-plugins", () => {
        const requires = TodoListMultistate.requires;
        expect(requires).toContain(TodoListMultistateEditing);
        expect(requires).toContain(TodoListMultistateUI);
        expect(requires).toContain(TodoListMultistateToolbar);
        expect(requires).toContain(TodoListMultistateAutoformat);
    });

    it("loads all sub-plugins via the editor", () => {
        expect(editor.plugins.get(TodoListMultistateEditing)).toBeInstanceOf(TodoListMultistateEditing);
        expect(editor.plugins.get(TodoListMultistateUI)).toBeInstanceOf(TodoListMultistateUI);
        expect(editor.plugins.get(TodoListMultistateToolbar)).toBeInstanceOf(TodoListMultistateToolbar);
        expect(editor.plugins.get(TodoListMultistateAutoformat)).toBeInstanceOf(TodoListMultistateAutoformat);
    });
});
