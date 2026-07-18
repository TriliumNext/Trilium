import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData, _getModelData as getModelData } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CollapsibleEditing from "../src/collapsible-editing.js";

describe("gapPostFixer + onEnterInBody", () => {
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

    describe("gapPostFixer", () => {
        it("re-pins a caret that lands directly between <summary> and the body to the end of <summary>", () => {
            setModelData(model,
                "<details><summary>Title</summary><paragraph>body</paragraph></details>"
            );
            model.change(writer => {
                const details = model.document.getRoot()!.getChild(0)!;
                // Offset 1 inside details = the "gap" between summary (idx 0) and body (idx 1).
                writer.setSelection(writer.createPositionAt(details, 1));
            });
            // Caret should NOT be sitting directly in the details element — it should
            // have been moved to the end of the previous child (the summary).
            expect(getModelData(model)).toBe(
                "<details><summary>Title[]</summary><paragraph>body</paragraph></details>"
            );
        });

        it("dives into a nested <details>'s last block when the gap before the caret is a nested <details>", () => {
            setModelData(model,
                "<details>" +
                    "<summary>Outer</summary>" +
                    "<details><summary>Inner</summary><paragraph>nested</paragraph></details>" +
                "</details>"
            );
            // Open both details manually so hiddenBodyPostFixer doesn't rescue
            // the caret away from the nested body — we're isolating gapPostFixer.
            // (Auto-open only walks top-level siblings of the insert entry, so
            // nested details from a single setModelData stay closed in tests.)
            for (const d of editor.editing.view.getDomRoot()!.querySelectorAll("details")) {
                (d as HTMLDetailsElement).open = true;
            }
            model.change(writer => {
                const outer = model.document.getRoot()!.getChild(0)!;
                // Position at outer's end: between inner-details and end-of-outer.
                writer.setSelection(writer.createPositionAt(outer, 2));
            });
            // Caret should land at the end of the nested details' last block.
            expect(getModelData(model)).toBe(
                "<details><summary>Outer</summary>" +
                    "<details><summary>Inner</summary><paragraph>nested[]</paragraph></details>" +
                "</details>"
            );
        });
    });

    describe("onEnterInBody", () => {
        it("escapes the collapsible when Enter is pressed in an empty trailing body paragraph", () => {
            setModelData(model,
                "<details>" +
                    "<summary>X</summary>" +
                    "<paragraph>existing</paragraph>" +
                    "<paragraph>[]</paragraph>" +
                "</details>"
            );
            // Fire the view-level enter event the same way CKEditor would on Enter keydown.
            editor.editing.view.document.fire("enter", {
                preventDefault: () => {},
                stop: () => {},
                isSoft: false
            });
            // The empty trailing paragraph is gone; the caret has moved to a new
            // paragraph outside the details.
            expect(getModelData(model)).toBe(
                "<details><summary>X</summary><paragraph>existing</paragraph></details>" +
                "<paragraph>[]</paragraph>"
            );
        });
    });
});
