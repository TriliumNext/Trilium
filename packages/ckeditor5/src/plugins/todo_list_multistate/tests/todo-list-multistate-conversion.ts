import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData, _getModelData as getModelData } from "ckeditor5";
import type { ModelElement } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TodoListMultistateEditing from "../todo_list_multistate_editing.js";

const TODO_HTML = "<ul class=\"todo-list\">" +
    "<li><label class=\"todo-list__label\">" +
        "<input type=\"checkbox\" disabled>" +
        "<span class=\"todo-list__label__description\">x</span>" +
    "</label></li>" +
    "</ul>";

function todoItem(model: ClassicEditor["model"]) {
    return model.document.getRoot()!.getChild(0) as ModelElement;
}

describe("TodoListMultistateEditing conversion", () => {
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

    describe("upcast", () => {
        for (const state of ["doing", "maybe", "cancelled"]) {
            it(`reads data-trilium-task-state="${state}" off the <li>`, () => {
                editor.setData(
                    "<ul class=\"todo-list\">" +
                        `<li data-trilium-task-state="${state}"><label class="todo-list__label">` +
                            "<input type=\"checkbox\" disabled>" +
                            "<span class=\"todo-list__label__description\">x</span>" +
                        "</label></li>" +
                    "</ul>"
                );
                expect(getModelData(model, { withoutSelection: true })).toContain(`taskState="${state}"`);
            });
        }

        it("preserves an unknown custom state from the source HTML", () => {
            // Round-trip safety: a state not in the active config still survives upcast.
            editor.setData(
                "<ul class=\"todo-list\">" +
                    "<li data-trilium-task-state=\"shipped\"><label class=\"todo-list__label\">" +
                        "<input type=\"checkbox\" disabled>" +
                        "<span class=\"todo-list__label__description\">x</span>" +
                    "</label></li>" +
                "</ul>"
            );
            expect(getModelData(model, { withoutSelection: true })).toContain("taskState=\"shipped\"");
        });

        it("ignores the anchor state names (none/done) on data-trilium-task-state", () => {
            for (const anchor of ["none", "done"]) {
                editor.setData(
                    "<ul class=\"todo-list\">" +
                        `<li data-trilium-task-state="${anchor}"><label class="todo-list__label">` +
                            "<input type=\"checkbox\" disabled>" +
                            "<span class=\"todo-list__label__description\">x</span>" +
                        "</label></li>" +
                    "</ul>"
                );
                expect(getModelData(model, { withoutSelection: true })).not.toContain("taskState");
            }
        });
    });

    describe("data downcast", () => {
        beforeEach(() => {
            editor.setData(TODO_HTML);
        });

        it("emits data-trilium-task-state on the <li> for a custom state", () => {
            model.change((writer) => {
                writer.setAttribute("taskState", "cancelled", todoItem(model));
            });
            expect(editor.getData()).toContain("data-trilium-task-state=\"cancelled\"");
        });

        it("omits data-trilium-task-state for anchor states (none/done map to the native checkbox)", () => {
            for (const anchor of ["none", "done"]) {
                model.change((writer) => {
                    writer.setAttribute("taskState", anchor, todoItem(model));
                });
                expect(editor.getData()).not.toContain("data-trilium-task-state");
            }
        });

        it("removes data-trilium-task-state when the model attribute is cleared", () => {
            model.change((writer) => {
                writer.setAttribute("taskState", "doing", todoItem(model));
            });
            expect(editor.getData()).toContain("data-trilium-task-state=\"doing\"");
            model.change((writer) => {
                writer.removeAttribute("taskState", todoItem(model));
            });
            expect(editor.getData()).not.toContain("data-trilium-task-state");
        });

        it("does NOT leak the editing-only tn-unknown-task-state class into the saved data", () => {
            // "shipped" isn't in DEFAULT_TASK_STATES — the editing pipeline marks it,
            // the data pipeline must not.
            editor.setData(
                "<ul class=\"todo-list\">" +
                    "<li data-trilium-task-state=\"shipped\"><label class=\"todo-list__label\">" +
                        "<input type=\"checkbox\" disabled>" +
                        "<span class=\"todo-list__label__description\">x</span>" +
                    "</label></li>" +
                "</ul>"
            );
            expect(editor.getData()).not.toContain("tn-unknown-task-state");
        });
    });

    describe("editing downcast", () => {
        it("mirrors a custom state to data-trilium-task-state on the live <li>", () => {
            setModelData(
                model,
                "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\" taskState=\"doing\">[]x</paragraph>"
            );
            const liDom = editor.editing.view.getDomRoot()!.querySelector("li") as HTMLLIElement;
            expect(liDom.getAttribute("data-trilium-task-state")).toBe("doing");
        });

        it("adds tn-unknown-task-state to the live <li> for states not in the active config", () => {
            setModelData(
                model,
                "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\" taskState=\"shipped\">[]x</paragraph>"
            );
            const liDom = editor.editing.view.getDomRoot()!.querySelector("li") as HTMLLIElement;
            expect(liDom.classList.contains("tn-unknown-task-state")).toBe(true);
        });
    });
});
