import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, Essentials, Heading, Paragraph, TodoList } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor, getEditorElement } from "../../../test/editor-kit.js";
import CollapsibleEditing from "./collapsible_editing.js";

describe("collapsible structure and conversion", () => {
    let editor: ClassicEditor;
    let root: HTMLElement;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, CollapsibleEditing]);
        getEditorElement(editor).style.cssText = "width: 600px; position: absolute; top: 0; left: 0;";
        root = editor.editing.view.getDomRoot() as HTMLElement;
    });

    describe("editing-view downcast", () => {
        it("keeps an expanded collapsible open through the reconvert a body edit triggers", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>body[]</paragraph></details>"
            );
            editor.editing.view.forceRender();
            expect(root.querySelector("details")?.open).toBe(true);

            // Editing a body block rebuilds the whole <details> in the editing view.
            editor.model.change((writer) => {
                const details = editor.model.document.getRoot()?.getChild(0);
                const body = details?.is("element") ? details.getChild(1) : null;
                if (body?.is("element")) {
                    writer.insertText("!", body, "end");
                }
            });
            editor.editing.view.forceRender();

            // Still open — the renderer seeds `open` from the model rather than defaulting closed.
            expect(root.querySelector("details")?.open).toBe(true);
        });

        it("renders a collapsed collapsible closed", () => {
            setModelData(editor.model, "<details><summary>T</summary><paragraph>body[]</paragraph></details>");
            editor.editing.view.forceRender();

            expect(root.querySelector("details")?.open).toBe(false);
        });
    });

    describe("to-do list in the body", () => {
        let todoEditor: ClassicEditor;

        /** One entry per rendered `<li>`: whether it still carries its checkbox. */
        function checkboxes(): boolean[] {
            todoEditor.editing.view.forceRender();
            const items = todoEditor.editing.view.getDomRoot()?.querySelectorAll("li") ?? [];
            return [...items].map((item) => !!item.querySelector("input[type=checkbox]"));
        }

        beforeEach(async () => {
            todoEditor = await createTestEditor([Essentials, Paragraph, Heading, TodoList, CollapsibleEditing]);
        });

        it("keeps every checkbox as body items are added and indented", () => {
            setModelData(
                todoEditor.model,
                "<details open=\"true\"><summary>T</summary>"
                + "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">one[]</paragraph>"
                + "</details>"
            );

            for (const label of ["two", "three", "four"]) {
                todoEditor.execute("enter");
                todoEditor.execute("insertText", { text: label });
            }
            todoEditor.execute("indentList");

            expect(checkboxes()).toEqual([true, true, true, true]);
        });

        it("keeps every checkbox when an item is split at its first character", () => {
            setModelData(
                todoEditor.model,
                "<details open=\"true\"><summary>T</summary>"
                + "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">one</paragraph>"
                + "<paragraph listIndent=\"0\" listItemId=\"b\" listType=\"todo\">[]two</paragraph>"
                + "</details>"
            );

            // Splitting at offset 0 leaves the item's text behind an empty new item, so the
            // reconversion has to map a position into a block whose view it just replaced.
            todoEditor.execute("enter");

            expect(checkboxes()).toEqual([true, true, true]);
        });

        it("keeps every checkbox when a neighbouring block merges into the list", () => {
            setModelData(
                todoEditor.model,
                "<details open=\"true\"><summary>T</summary>"
                + "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">one</paragraph>"
                + "<paragraph>[]tail</paragraph><paragraph>keep</paragraph>"
                + "</details>"
            );
            todoEditor.editing.view.forceRender();

            todoEditor.execute("delete");

            expect(checkboxes()).toEqual([true]);
        });

        it("keeps every checkbox as blocks around the list change", () => {
            setModelData(
                todoEditor.model,
                "<details open=\"true\"><summary>T</summary>"
                + "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">one</paragraph>"
                + "<paragraph listIndent=\"0\" listItemId=\"b\" listType=\"todo\">two[]</paragraph>"
                + "</details>"
            );

            // Leave the list, then build a heading and two paragraphs under it. None of these
            // changes mentions the list, so nothing but the reconversion itself points at it.
            todoEditor.execute("enter");
            todoEditor.execute("todoList");
            todoEditor.execute("heading", { value: "heading2" });
            todoEditor.execute("insertText", { text: "Section" });
            for (const label of ["first", "second"]) {
                todoEditor.execute("enter");
                todoEditor.execute("insertText", { text: label });
            }
            expect(checkboxes()).toEqual([true, true]);

            todoEditor.model.change((writer) => {
                const details = todoEditor.model.document.getRoot()?.getChild(0);
                const last = details?.is("element") ? details.getChild(details.childCount - 1) : null;
                if (last) {
                    writer.remove(last);
                }
            });
            expect(checkboxes()).toEqual([true, true]);

            // Putting that block back reconverts the collapsible once more.
            todoEditor.execute("undo");
            expect(checkboxes()).toEqual([true, true]);
        });

        it("leaves a to-do list outside any collapsible alone", () => {
            setModelData(
                todoEditor.model,
                "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">one[]</paragraph>"
                + "<details><summary>T</summary><paragraph>body</paragraph></details>"
            );

            todoEditor.execute("enter");
            todoEditor.execute("insertText", { text: "two" });

            expect(checkboxes()).toEqual([true, true]);
        });
    });

    describe("structural post-fixer", () => {
        it("removes a <summary> inserted outside any collapsible", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            editor.model.change((writer) => {
                const root_ = editor.model.document.getRoot();
                const stray = writer.createElement("summary");
                writer.insert(stray, writer.createPositionAt(root_ ?? stray, "end"));
            });

            expect(getModelData(editor.model, { withoutSelection: true })).not.toContain("<summary>");
        });

        it("removes an empty collapsible that arrives as part of a multi-block insert", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            editor.model.change((writer) => {
                const root_ = editor.model.document.getRoot();
                if (!root_) {
                    return;
                }
                // Two top-level nodes in one insert, so the post-fixer walks the run via
                // nextSibling rather than looking at a single node.
                const fragment = writer.createDocumentFragment();
                writer.append(writer.createElement("paragraph"), fragment);
                writer.append(writer.createElement("details"), fragment);
                writer.insert(fragment, writer.createPositionAt(root_, "end"));
            });

            expect(getModelData(editor.model, { withoutSelection: true })).not.toContain("<details>");
        });

        it("removes a collapsible left empty after its last child is deleted", () => {
            setModelData(
                editor.model,
                "<paragraph>keep[]</paragraph><details><summary>T</summary><paragraph>body</paragraph></details>"
            );

            editor.model.change((writer) => {
                const details = editor.model.document.getRoot()?.getChild(1);
                if (details?.is("element")) {
                    writer.remove(writer.createRangeIn(details));
                }
            });

            expect(getModelData(editor.model, { withoutSelection: true })).toBe("<paragraph>keep</paragraph>");
        });
    });
});
