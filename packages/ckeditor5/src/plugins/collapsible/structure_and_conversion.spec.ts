import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
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
