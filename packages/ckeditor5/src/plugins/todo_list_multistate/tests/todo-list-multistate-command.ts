import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData, _getModelData as getModelData } from "ckeditor5";
import type { Command, ModelElement } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TodoListMultistateEditing from "../todo_list_multistate_editing.js";

function todoItem(model: ClassicEditor["model"]) {
    return model.document.getRoot()!.getChild(0) as ModelElement;
}

describe("setTaskState command", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;
    let model: ClassicEditor["model"];
    let command: Command;

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, TodoListMultistateEditing]
        });
        model = editor.model;
        command = editor.commands.get("setTaskState")!;
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    describe("refresh / value", () => {
        it("is disabled when the caret is in a plain paragraph", () => {
            setModelData(model, "<paragraph>[]x</paragraph>");
            expect(command.isEnabled).toBe(false);
            expect(command.value).toBe(null);
        });

        it("reads value=\"none\" on a fresh todo item (no checked, no state)", () => {
            setModelData(model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">[]x</paragraph>");
            expect(command.isEnabled).toBe(true);
            expect(command.value).toBe("none");
        });

        it("reads value=\"done\" when the native checkbox is checked", () => {
            setModelData(model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\" todoListChecked=\"true\">[]x</paragraph>");
            expect(command.value).toBe("done");
        });

        it("reads value=\"doing\" when taskState is set to a custom state", () => {
            setModelData(model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\" taskState=\"doing\">[]x</paragraph>");
            expect(command.value).toBe("doing");
        });
    });

    describe("execute", () => {
        beforeEach(() => {
            setModelData(model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">[]x</paragraph>");
        });

        it("setting a custom state writes taskState and the checkbox stays falsy (post-fixer respects isCompleted=false)", () => {
            editor.execute("setTaskState", { state: "doing" });
            const item = todoItem(model);
            expect(item.getAttribute("taskState")).toBe("doing");
            expect(!!item.getAttribute("todoListChecked")).toBe(false);
        });

        it("setting \"done\" removes taskState and sets todoListChecked=true", () => {
            editor.execute("setTaskState", { state: "done" });
            const item = todoItem(model);
            expect(item.hasAttribute("taskState")).toBe(false);
            expect(item.getAttribute("todoListChecked")).toBe(true);
        });

        it("setting \"none\" removes taskState and sets todoListChecked=false", () => {
            editor.execute("setTaskState", { state: "doing" });
            editor.execute("setTaskState", { state: "none" });
            const item = todoItem(model);
            expect(item.hasAttribute("taskState")).toBe(false);
            expect(item.getAttribute("todoListChecked")).toBe(false);
        });

        it("syncs todoListChecked to the configured isCompleted of the custom state", () => {
            // "cancelled" is in DEFAULT_TASK_STATES with isCompleted=false.
            editor.execute("setTaskState", { state: "cancelled" });
            const item = todoItem(model);
            expect(item.getAttribute("taskState")).toBe("cancelled");
            expect(!!item.getAttribute("todoListChecked")).toBe(false);
        });

        it("custom isCompleted=true state ticks the native checkbox via the post-fixer", async () => {
            await editor.destroy();
            domElement = document.createElement("div");
            document.body.appendChild(domElement);
            editor = await ClassicEditor.create(domElement, {
                licenseKey: "GPL",
                plugins: [Essentials, Paragraph, TodoListMultistateEditing],
                taskStates: [
                    { id: "_taskStateNone", name: "none", title: "None", markdownSymbol: " ", isCompleted: false, icon: "bx bx-checkbox" },
                    { id: "_taskStateDone", name: "done", title: "Done", markdownSymbol: "x", isCompleted: true, icon: "bx bx-check" },
                    { id: "_custom", name: "shipped", title: "Shipped", markdownSymbol: "!", isCompleted: true, icon: "bx bx-rocket" }
                ]
            } as Parameters<typeof ClassicEditor.create>[1]);
            model = editor.model;
            setModelData(model, "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">[]x</paragraph>");
            editor.execute("setTaskState", { state: "shipped" });
            const item = todoItem(model);
            expect(item.getAttribute("taskState")).toBe("shipped");
            expect(item.getAttribute("todoListChecked")).toBe(true);
        });

        it("is a no-op on a non-todo selection", () => {
            setModelData(model, "<paragraph>[]x</paragraph>");
            editor.execute("setTaskState", { state: "doing" });
            expect(getModelData(model, { withoutSelection: true })).toBe("<paragraph>x</paragraph>");
        });
    });
});
