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
        // The expanded/collapsed branch is decided by the `open` model attribute,
        // so the state is set up in the model rather than on the DOM element.
        setModelData(model,
            "<details open=\"true\"><summary>Title[]</summary><paragraph></paragraph></details>"
        );

        fireEnter();

        // Caret moved into the existing empty paragraph; no second one was inserted.
        expect(getModelData(model)).toBe(
            "<details open=\"true\"><summary>Title</summary><paragraph>[]</paragraph></details>"
        );
    });

    it("expands a collapsed block when splitting its title, as part of the same undo step", () => {
        setModelData(model,
            "<details><summary>Ti[]tle</summary><paragraph>body</paragraph></details>"
        );

        fireEnter();

        // The right half of the title became the first body block, and the block
        // expanded so the caret lands somewhere the user can actually see.
        expect(getModelData(model)).toBe(
            "<details open=\"true\"><summary>Ti</summary>" +
                "<paragraph>[]tle</paragraph><paragraph>body</paragraph>" +
            "</details>"
        );

        editor.execute("undo");

        // The expansion belongs to the user's edit — unlike a plain toggle — so
        // undoing the split restores the collapsed state along with the title.
        expect(getModelData(model, { withoutSelection: true })).toBe(
            "<details><summary>Title</summary><paragraph>body</paragraph></details>"
        );
    });

    it("at the end of a title (collapsed) parks the caret in the existing empty paragraph after the details instead of stacking a second one", () => {
        setModelData(model,
            "<details><summary>Title[]</summary><paragraph>body</paragraph></details>" +
            "<paragraph></paragraph>"
        );
        // No `open` attribute — the collapsed branch.

        fireEnter();

        // Caret moved into the existing empty paragraph after the details; no
        // second one was inserted between them.
        expect(getModelData(model)).toBe(
            "<details><summary>Title</summary><paragraph>body</paragraph></details>" +
            "<paragraph>[]</paragraph>"
        );
    });
});
