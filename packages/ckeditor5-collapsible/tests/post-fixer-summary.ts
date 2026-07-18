import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData, _getModelData as getModelData } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CollapsibleEditing from "../src/collapsible-editing.js";

describe("summaryInvariantPostFixer", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;
    let model: ClassicEditor["model"];

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [Essentials, Paragraph, CollapsibleEditing]
        });
        model = editor.model;
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    it("inserts a blank summary when a <details> is loaded without one", () => {
        setModelData(model, "<details><paragraph>Body only</paragraph></details>");
        expect(getModelData(model, { withoutSelection: true })).toBe(
            "<details><summary></summary><paragraph>Body only</paragraph></details>"
        );
    });

    it("demotes extra <summary>s to paragraphs (preserving their text)", () => {
        setModelData(model,
            "<details><summary>First</summary><summary>Second</summary></details>"
        );
        expect(getModelData(model, { withoutSelection: true })).toBe(
            "<details><summary>First</summary><paragraph>Second</paragraph></details>"
        );
    });

    it("moves a misplaced summary back to position 0", () => {
        setModelData(model,
            "<details><paragraph>Body</paragraph><summary>Title</summary></details>"
        );
        expect(getModelData(model, { withoutSelection: true })).toBe(
            "<details><summary>Title</summary><paragraph>Body</paragraph></details>"
        );
    });
});
