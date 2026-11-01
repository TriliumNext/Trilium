import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData, _getModelData as getModelData } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CollapsibleEditing from "./collapsible_editing.js";

describe("caret pinning inside a collapsible + onEnterInBody", () => {
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

    /**
     * These guard the outcome, not an implementation of ours: the plugin used to carry a
     * `gapPostFixer` for this, but CKEditor's own selection post-fixer runs before every plugin
     * post-fixer and already moves a caret out of a container position, so ours never ran. The
     * assertions below are kept as regression cover for the behaviour users actually get.
     */
    describe("a caret never rests between a collapsible's children", () => {
        it("moves a caret dropped between <summary> and the body to the end of <summary>", () => {
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

        it("descends into a nested collapsible's last block when that is the nearest text position", () => {
            // Both details are open so hiddenBodyPostFixer doesn't rescue the caret away from the
            // nested body. The nested collapsible is the outer one's last child, so the nearest
            // valid position is backwards, inside it. (With a sibling after the gap the caret goes
            // forward to that sibling instead.)
            setModelData(model,
                "<details open=\"true\">" +
                    "<summary>Outer</summary>" +
                    "<details open=\"true\"><summary>Inner</summary><paragraph>nested</paragraph></details>" +
                "</details>"
            );
            model.change(writer => {
                const outer = model.document.getRoot()!.getChild(0)!;
                // Position at outer's end: between inner-details and end-of-outer.
                writer.setSelection(writer.createPositionAt(outer, 2));
            });
            // Caret should land at the end of the nested details' last block.
            expect(getModelData(model)).toBe(
                "<details open=\"true\"><summary>Outer</summary>" +
                    "<details open=\"true\"><summary>Inner</summary><paragraph>nested[]</paragraph></details>" +
                "</details>"
            );
        });
    });

    describe("onEnterInBody", () => {
        it("escapes the collapsible when Enter is pressed in an empty trailing body paragraph", () => {
            // Open: a caret can only ever be in a body that is actually visible —
            // hiddenBodyPostFixer bounces it to the summary otherwise, so a
            // collapsed block could never reach onEnterInBody in the first place.
            setModelData(model,
                "<details open=\"true\">" +
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
                "<details open=\"true\"><summary>X</summary><paragraph>existing</paragraph></details>" +
                "<paragraph>[]</paragraph>"
            );
        });
    });
});
