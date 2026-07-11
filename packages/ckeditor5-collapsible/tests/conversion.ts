import { ClassicEditor, Essentials, Paragraph, _getModelData as getModelData } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CollapsibleEditing from "../src/collapsible-editing.js";

describe("CollapsibleEditing conversion", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, CollapsibleEditing]
        });
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    describe("upcast", () => {
        it("maps <details>/<summary>/<p> to the model details/summary/paragraph", () => {
            editor.setData("<details><summary>Title</summary><p>Body</p></details>");
            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<details><summary>Title</summary><paragraph>Body</paragraph></details>"
            );
        });

        it("preserves multiple body blocks", () => {
            editor.setData(
                "<details><summary>Title</summary><p>First</p><p>Second</p></details>"
            );
            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<details><summary>Title</summary>" +
                    "<paragraph>First</paragraph><paragraph>Second</paragraph>" +
                "</details>"
            );
        });

        it("preserves nested collapsibles", () => {
            editor.setData(
                "<details><summary>Outer</summary>" +
                    "<details><summary>Inner</summary><p>Nested</p></details>" +
                "</details>"
            );
            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<details><summary>Outer</summary>" +
                    "<details><summary>Inner</summary><paragraph>Nested</paragraph></details>" +
                "</details>"
            );
        });
    });

    describe("data downcast", () => {
        it("emits the trilium-collapsible class on the rendered <details>", () => {
            editor.setData("<details><summary>Title</summary><p>Body</p></details>");
            expect(editor.getData()).toBe(
                "<details class=\"trilium-collapsible\">" +
                    "<summary>Title</summary><p>Body</p>" +
                "</details>"
            );
        });

        it("roundtrips lossless when the source already has the class", () => {
            const html = "<details class=\"trilium-collapsible\">" +
                "<summary>Title</summary><p>Body</p>" +
                "</details>";
            editor.setData(html);
            expect(editor.getData()).toBe(html);
        });
    });
});
