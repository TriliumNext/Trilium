import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import CollapsibleEditing from "./collapsible_editing.js";

/**
 * Caret movement and deletion around a collapsible: the arrow-up jump into the block above,
 * the two-step delete next to one, and Backspace unwrapping an empty title.
 */
describe("collapsible keyboard navigation", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, CollapsibleEditing]);
    });

    function fireArrowUp(overrides: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
        const preventDefault = vi.fn();
        editor.editing.view.document.fire("arrowKey", {
            keyCode: 38,
            shiftKey: false,
            domTarget: editor.editing.view.getDomRoot(),
            preventDefault,
            ...overrides
        });
        return preventDefault;
    }

    function fireDelete(direction: "backward" | "forward"): ReturnType<typeof vi.fn> {
        const preventDefault = vi.fn();
        editor.editing.view.document.fire("delete", { direction, unit: "character", preventDefault });
        return preventDefault;
    }

    describe("arrow up into the preceding collapsible", () => {
        it("jumps from a following paragraph into an open collapsible's last block", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>body</paragraph></details>" +
                "<paragraph>[]after</paragraph>"
            );

            const preventDefault = fireArrowUp();

            expect(preventDefault).toHaveBeenCalled();
            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>T</summary><paragraph>[]body</paragraph></details>" +
                "<paragraph>after</paragraph>"
            );
        });

        it("jumps into a collapsed collapsible's summary instead of its hidden body", () => {
            setModelData(
                editor.model,
                "<details><summary>T</summary><paragraph>body</paragraph></details>" +
                "<paragraph>[]after</paragraph>"
            );

            fireArrowUp();

            expect(getModelData(editor.model)).toBe(
                "<details><summary>T[]</summary><paragraph>body</paragraph></details>" +
                "<paragraph>after</paragraph>"
            );
        });

        it("jumps from a summary into the collapsible directly above it", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>first</summary><paragraph>one</paragraph></details>" +
                "<details open=\"true\"><summary>[]second</summary><paragraph>two</paragraph></details>"
            );

            const preventDefault = fireArrowUp();

            expect(preventDefault).toHaveBeenCalled();
            expect(getModelData(editor.model)).toContain("<paragraph>one[]</paragraph>");
        });

        it("ignores the jump when the caret is not at the start of its block", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>body</paragraph></details>" +
                "<paragraph>af[]ter</paragraph>"
            );

            const preventDefault = fireArrowUp();

            expect(preventDefault).not.toHaveBeenCalled();
        });

        it("ignores the jump when the previous sibling is not a collapsible", () => {
            setModelData(editor.model, "<paragraph>before</paragraph><paragraph>[]after</paragraph>");

            const preventDefault = fireArrowUp();

            expect(preventDefault).not.toHaveBeenCalled();
        });

        it("ignores a summary whose collapsible has no previous sibling", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>[]T</summary><paragraph>body</paragraph></details>"
            );

            const preventDefault = fireArrowUp();

            expect(preventDefault).not.toHaveBeenCalled();
        });

        it("ignores keys other than arrow-up, and shift-extended selections", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>body</paragraph></details>" +
                "<paragraph>[]after</paragraph>"
            );

            expect(fireArrowUp({ keyCode: 40 })).not.toHaveBeenCalled();
            expect(fireArrowUp({ shiftKey: true })).not.toHaveBeenCalled();
        });

        it("ignores the jump when the selection is not collapsed", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>body</paragraph></details>" +
                "<paragraph>[after]</paragraph>"
            );

            expect(fireArrowUp()).not.toHaveBeenCalled();
        });
    });

    describe("two-step delete next to a collapsible", () => {
        // `Delete` (from Essentials) calls preventDefault on the event itself, so whether the
        // collapsible ends up *selected* is the only signal that this handler acted.
        const selectedName = () => editor.model.document.selection.getSelectedElement()?.name;

        it("leaves an empty block alone — the user is deleting the block, not the collapsible", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>body</paragraph></details>" +
                "<paragraph>[]</paragraph>"
            );

            fireDelete("backward");

            expect(selectedName()).toBeUndefined();
        });

        it("does nothing when there is no collapsible adjacent to the caret", () => {
            setModelData(editor.model, "<paragraph>before</paragraph>[]<paragraph>after</paragraph>");

            fireDelete("backward");

            expect(selectedName()).toBeUndefined();
        });

        it("does nothing when the selection is not collapsed", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>body</paragraph></details>" +
                "<paragraph>[after]</paragraph>"
            );

            fireDelete("backward");

            expect(selectedName()).toBeUndefined();
        });
    });

    describe("backspace in an empty summary", () => {
        it("unwraps the collapsible, keeping the body and parking the caret in it", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>[]</summary><paragraph>body</paragraph></details>"
            );

            const preventDefault = fireDelete("backward");

            expect(preventDefault).toHaveBeenCalled();
            expect(getModelData(editor.model)).toBe("<paragraph>[]body</paragraph>");
        });

        it("replaces a wholly empty collapsible with a fresh paragraph", () => {
            setModelData(editor.model, "<details open=\"true\"><summary>[]</summary></details>");

            fireDelete("backward");

            expect(getModelData(editor.model, { withoutSelection: true })).toBe("<paragraph></paragraph>");
        });

        it("leaves a non-empty title alone", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>[]T</summary><paragraph>body</paragraph></details>"
            );

            fireDelete("backward");

            // The collapsible survives — the handler only unwraps when the title is empty.
            expect(getModelData(editor.model, { withoutSelection: true })).toContain("<summary>T</summary>");
        });

        it("ignores a forward delete in an empty title", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>[]</summary><paragraph>body</paragraph></details>"
            );

            fireDelete("forward");

            expect(getModelData(editor.model, { withoutSelection: true })).toContain("<summary></summary>");
        });
    });
});
