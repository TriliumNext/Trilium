import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData, _getModelData as getModelData } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CollapsibleEditing from "./collapsible_editing.js";

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

    it("demotes a summary moved into a collapsible that already has one", () => {
        setModelData(model,
            "<details><summary>A</summary><paragraph>a</paragraph></details>" +
            "<details><summary>B</summary><paragraph>b</paragraph></details>"
        );

        model.change(writer => {
            const target = model.document.getRoot()?.getChild(0);
            const source = model.document.getRoot()?.getChild(1);
            const title = source?.is("element") ? source.getChild(0) : null;
            if (target?.is("element") && title) {
                writer.move(writer.createRangeOn(title), writer.createPositionAt(target, "end"));
            }
        });

        // The receiving block keeps its own title; the source block gets a blank one.
        expect(getModelData(model, { withoutSelection: true })).toBe(
            "<details><summary>A</summary><paragraph>a</paragraph><paragraph>B</paragraph>" +
            "</details><details><summary></summary><paragraph>b</paragraph></details>"
        );
    });
});
