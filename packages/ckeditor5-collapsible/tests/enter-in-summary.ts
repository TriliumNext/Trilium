import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData, _getModelData as getModelData } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CollapsibleEditing from "../src/collapsible-editing.js";

describe("onEnterInSummary", () => {
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

    const fireEnter = () => editor.editing.view.document.fire("enter", {
        preventDefault: () => {},
        stop: () => {},
        isSoft: false
    });

    it("at the end of a title (expanded) parks the caret in the existing empty body paragraph instead of stacking a second one", () => {
        setModelData(model,
            "<details><summary>Title[]</summary><paragraph></paragraph></details>"
        );
        // Auto-open won't have fired in this synchronous slice, so the details
        // dom.open is still false. The expanded vs collapsed branch decision is
        // made via dom.open — force it true to exercise the expanded branch.
        const detailsDom = editor.editing.view.getDomRoot()!.querySelector("details") as HTMLDetailsElement;
        detailsDom.open = true;

        fireEnter();

        // Caret moved into the existing empty paragraph; no second one was inserted.
        expect(getModelData(model)).toBe(
            "<details><summary>Title</summary><paragraph>[]</paragraph></details>"
        );
    });

    it("at the end of a title (collapsed) parks the caret in the existing empty paragraph after the details instead of stacking a second one", () => {
        setModelData(model,
            "<details><summary>Title[]</summary><paragraph>body</paragraph></details>" +
            "<paragraph></paragraph>"
        );
        // dom.open stays false in happy-dom, exercising the collapsed branch.

        fireEnter();

        // Caret moved into the existing empty paragraph after the details; no
        // second one was inserted between them.
        expect(getModelData(model)).toBe(
            "<details><summary>Title</summary><paragraph>body</paragraph></details>" +
            "<paragraph>[]</paragraph>"
        );
    });
});
