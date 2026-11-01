import { _getModelData as getModelData, _setModelData as setModelData, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor, getEditorElement } from "../../../test/editor-kit.js";
import CollapsibleEditing from "./collapsible_editing.js";

/**
 * Enter inside a title and the ArrowDown escape out of one. Both depend on where the caret sits,
 * and ArrowDown additionally consults the caret's real position on screen, so these run against a
 * laid-out editable with a genuine DOM selection.
 */
describe("collapsible Enter and ArrowDown", () => {
    let editor: ClassicEditor;
    let root: HTMLElement;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, CollapsibleEditing]);
        getEditorElement(editor).style.cssText = "width: 600px; position: absolute; top: 0; left: 0;";
        root = editor.editing.view.getDomRoot() as HTMLElement;
    });

    function fireEnter(): void {
        editor.editing.view.document.fire("enter", { preventDefault: vi.fn(), isSoft: false });
    }

    /**
     * Put a real DOM selection where the model selection is, so `caretAtVisualEdge` measures an
     * actual caret rectangle rather than bailing out on an empty selection.
     */
    function syncDomSelection(): void {
        editor.editing.view.forceRender();
        const domSelection = document.getSelection();
        const viewSelection = editor.editing.view.document.selection;
        const viewPosition = viewSelection.getFirstPosition();
        if (!domSelection || !viewPosition) {
            return;
        }
        const domPosition = editor.editing.view.domConverter.viewPositionToDom(viewPosition);
        if (!domPosition) {
            return;
        }
        const range = document.createRange();
        range.setStart(domPosition.parent, domPosition.offset);
        range.collapse(true);
        domSelection.removeAllRanges();
        domSelection.addRange(range);
    }

    function fireDomKey(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
        root.dispatchEvent(event);
        return event;
    }

    describe("Enter in a title", () => {
        it("inserts a paragraph before the collapsible when the caret is at the start", () => {
            setModelData(editor.model, "<details open=\"true\"><summary>[]Title</summary><paragraph>body</paragraph></details>");

            fireEnter();

            expect(getModelData(editor.model)).toBe(
                "<paragraph>[]</paragraph>" +
                "<details open=\"true\"><summary>Title</summary><paragraph>body</paragraph></details>"
            );
        });

        it("drops a non-collapsed selection in the title before acting on it", () => {
            setModelData(editor.model, "<details open=\"true\"><summary>[Title]</summary><paragraph>body</paragraph></details>");

            fireEnter();

            // The whole title was selected, so deleting it leaves the caret at the start —
            // which then takes the "paragraph before" path.
            expect(getModelData(editor.model)).toBe(
                "<paragraph>[]</paragraph>" +
                "<details open=\"true\"><summary></summary><paragraph>body</paragraph></details>"
            );
        });

        it("opens a fresh first body block when the caret is at the end of an expanded title", () => {
            setModelData(editor.model, "<details open=\"true\"><summary>Title[]</summary><paragraph>body</paragraph></details>");

            fireEnter();

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>Title</summary>" +
                "<paragraph>[]</paragraph><paragraph>body</paragraph></details>"
            );
        });

        it("reuses an empty block already sitting at that spot instead of stacking another", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>Title[]</summary><paragraph></paragraph></details>"
            );

            fireEnter();

            // One empty paragraph, not two.
            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>Title</summary><paragraph>[]</paragraph></details>"
            );
        });

        it("escapes past a collapsed collapsible when the caret is at the end of its title", () => {
            setModelData(editor.model, "<details><summary>Title[]</summary><paragraph>body</paragraph></details>");

            fireEnter();

            expect(getModelData(editor.model)).toBe(
                "<details><summary>Title</summary><paragraph>body</paragraph></details>" +
                "<paragraph>[]</paragraph>"
            );
        });
    });

    describe("Enter in an empty trailing body block", () => {
        it("moves into the paragraph that already follows the collapsible", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>body</paragraph><paragraph>[]</paragraph></details>" +
                "<paragraph>after</paragraph>"
            );

            fireEnter();

            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>T</summary><paragraph>body</paragraph></details>" +
                "<paragraph>[]after</paragraph>"
            );
        });

        it("leaves a body block alone when it is not the last one", () => {
            setModelData(
                editor.model,
                "<details open=\"true\"><summary>T</summary><paragraph>[]</paragraph><paragraph>body</paragraph></details>"
            );

            fireEnter();

            // Native Enter handled it: still inside the collapsible.
            expect(getModelData(editor.model, { withoutSelection: true })).toContain("<summary>T</summary>");
            expect(editor.model.document.getRoot()?.childCount).toBe(1);
        });
    });

    describe("ArrowDown out of a title", () => {
        it("jumps into the body of an expanded collapsible", () => {
            setModelData(editor.model, "<details open=\"true\"><summary>Title[]</summary><paragraph>body</paragraph></details>");
            syncDomSelection();

            const event = fireDomKey("ArrowDown");

            expect(event.defaultPrevented).toBe(true);
            expect(getModelData(editor.model)).toBe(
                "<details open=\"true\"><summary>Title</summary><paragraph>[]body</paragraph></details>"
            );
        });

        it("skips past a collapsed collapsible to the block after it", () => {
            setModelData(
                editor.model,
                "<details><summary>Title[]</summary><paragraph>body</paragraph></details><paragraph>after</paragraph>"
            );
            syncDomSelection();

            fireDomKey("ArrowDown");

            expect(getModelData(editor.model)).toBe(
                "<details><summary>Title</summary><paragraph>body</paragraph></details><paragraph>[]after</paragraph>"
            );
        });

        it("does nothing when there is nowhere to go", () => {
            setModelData(editor.model, "<details><summary>Title[]</summary><paragraph>body</paragraph></details>");
            syncDomSelection();

            const event = fireDomKey("ArrowDown");

            expect(event.defaultPrevented).toBe(false);
        });

        it("ignores ArrowDown outside a title", () => {
            setModelData(editor.model, "<paragraph>plain[]</paragraph>");
            syncDomSelection();

            const event = fireDomKey("ArrowDown");

            expect(event.defaultPrevented).toBe(false);
        });

        it("ignores a modified or extended ArrowDown", () => {
            setModelData(editor.model, "<details open=\"true\"><summary>Title[]</summary><paragraph>body</paragraph></details>");
            syncDomSelection();

            expect(fireDomKey("ArrowDown", { shiftKey: true }).defaultPrevented).toBe(false);
            expect(fireDomKey("ArrowDown", { ctrlKey: true }).defaultPrevented).toBe(false);
            expect(fireDomKey("ArrowDown", { altKey: true }).defaultPrevented).toBe(false);
        });
    });

    describe("Ctrl+Enter in a title", () => {
        it("toggles the collapsible", () => {
            setModelData(editor.model, "<details><summary>Title[]</summary><paragraph>body</paragraph></details>");

            const event = fireDomKey("Enter", { ctrlKey: true });

            expect(event.defaultPrevented).toBe(true);
            expect(getModelData(editor.model, { withoutSelection: true })).toContain("open=\"true\"");
        });

        it("is ignored outside a title", () => {
            setModelData(editor.model, "<paragraph>plain[]</paragraph>");

            expect(fireDomKey("Enter", { ctrlKey: true }).defaultPrevented).toBe(false);
        });
    });
});
