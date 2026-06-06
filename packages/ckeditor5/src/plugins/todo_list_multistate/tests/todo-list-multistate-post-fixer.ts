import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData } from "ckeditor5";
import type { ModelElement } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TodoListMultistateEditing from "../todo_list_multistate_editing.js";

function todoItem(model: ClassicEditor["model"]) {
    return model.document.getRoot()!.getChild(0) as ModelElement;
}

describe("TodoListMultistateEditing post-fixer", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;
    let model: ClassicEditor["model"];

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, TodoListMultistateEditing]
        });
        model = editor.model;
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    it("strips taskState when the native checkTodoList toggle ticks the checkbox", () => {
        // A user with a custom state who hits the native checkbox falls back to
        // the anchor `done` — taskState is cleared so the two systems don't drift.
        setModelData(
            model,
            "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\" taskState=\"doing\">[]x</paragraph>"
        );
        expect(todoItem(model).getAttribute("taskState")).toBe("doing");

        editor.execute("checkTodoList");

        const item = todoItem(model);
        expect(item.hasAttribute("taskState")).toBe(false);
        expect(item.getAttribute("todoListChecked")).toBe(true);
    });

    it("strips taskState when the native checkTodoList toggle unticks the checkbox", () => {
        setModelData(
            model,
            "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\" todoListChecked=\"true\" taskState=\"cancelled\">[]x</paragraph>"
        );

        editor.execute("checkTodoList");

        const item = todoItem(model);
        expect(item.hasAttribute("taskState")).toBe(false);
        expect(!!item.getAttribute("todoListChecked")).toBe(false);
    });

    it("syncs todoListChecked when only the state attribute changes", () => {
        // Setting a custom state directly (no command) — post-fixer drives todoListChecked.
        setModelData(model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\" todoListChecked=\"true\">[]x</paragraph>");
        model.change((writer) => {
            writer.setAttribute("taskState", "doing", todoItem(model));
        });
        // doing.isCompleted = false → checkbox must go false.
        expect(!!todoItem(model).getAttribute("todoListChecked")).toBe(false);
    });

    it("leaves taskState alone when both attributes change in the same transaction (the command flow)", () => {
        // setTaskState writes both attributes at once; the post-fixer's
        // "drop state on native toggle" branch must NOT fire in that case.
        setModelData(model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">[]x</paragraph>");
        editor.execute("setTaskState", { state: "doing" });
        const item = todoItem(model);
        expect(item.getAttribute("taskState")).toBe("doing");
        expect(!!item.getAttribute("todoListChecked")).toBe(false);
    });
});
