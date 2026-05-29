import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TodoListMultistateEditing from "../todo_list_multistate_editing.js";

describe("TodoListMultistateEditing schema", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;
    let schema: ClassicEditor["model"]["schema"];
    let model: ClassicEditor["model"];

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, TodoListMultistateEditing]
        });
        schema = editor.model.schema;
        model = editor.model;
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    it("registers the setTaskState command", () => {
        expect(editor.commands.get("setTaskState")).toBeDefined();
    });

    it("allows taskState on a todo list item", () => {
        setModelData(model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">[]x</paragraph>");
        const item = model.document.getRoot()!.getChild(0)!;
        expect(schema.checkAttribute(item, "taskState")).toBe(true);
    });

    it("allows taskState on a plain paragraph (schema is intentionally broad)", () => {
        // The plugin extends $block, not just $listItem — the post-fixer enforces
        // that only todo items act on it. The schema itself doesn't gate the attribute.
        setModelData(model, "<paragraph>[]x</paragraph>");
        const item = model.document.getRoot()!.getChild(0)!;
        expect(schema.checkAttribute(item, "taskState")).toBe(true);
    });
});
