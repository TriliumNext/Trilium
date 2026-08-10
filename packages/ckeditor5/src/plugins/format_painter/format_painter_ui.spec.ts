import { userEvent } from "vitest/browser";
import {
    Bold,
    type ButtonView,
    type ClassicEditor,
    Essentials,
    _getModelData as getModelData,
    HorizontalLine,
    Italic,
    keyCodes,
    Paragraph,
    _setModelData as setModelData
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { COPY_FORMAT_COMMAND, CURSOR_ACTIVE_CSS_CLASS, FORMAT_PAINTER_COMPONENT } from "./constants.js";
import TriliumFormatPainter from "./format_painter.js";
import FormatPainterUI from "./format_painter_ui.js";

describe("FormatPainterUI", () => {
    let editor: ClassicEditor;

    async function createEditor() {
        editor = await createTestEditor([ Essentials, Paragraph, Bold, Italic, HorizontalLine, TriliumFormatPainter ]);
    }

    function ui() {
        return editor.plugins.get(FormatPainterUI);
    }

    function button() {
        return editor.ui.componentFactory.create(FORMAT_PAINTER_COMPONENT) as ButtonView;
    }

    function root() {
        const domRoot = editor.editing.view.getDomRoot();
        if (!domRoot) {
            throw new Error("editing root is not attached");
        }
        return domRoot;
    }

    function paintClick() {
        root().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }

    function pressKey(keyCode: number) {
        editor.editing.view.document.fire("keydown", {
            keyCode,
            preventDefault: () => {},
            stopPropagation: () => {},
            domTarget: editor.editing.view.getDomRoot()
        });
    }

    function model() {
        return getModelData(editor.model, { withoutSelection: true });
    }

    beforeEach(async () => {
        await createEditor();
    });

    it("registers the plugin and a labelled, icon-bearing button", () => {
        expect(FormatPainterUI.pluginName).toBe("FormatPainterUI");

        const view = button();
        expect(view.label).toBe("Copy formatting");
        expect(view.icon).toBeTruthy();
        expect(view.tooltip).toBe(true);
    });

    it("binds the button's enabled state to whether formatting can be copied", () => {
        const view = button();

        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        expect(view.isEnabled).toBe(true);

        // A selected block object is not a place formatting can be read from.
        setModelData(editor.model, "[<horizontalLine></horizontalLine>]");
        expect(view.isEnabled).toBe(false);
    });

    describe("one-shot painting", () => {
        it("arms on click: copies the formatting and marks the roots", () => {
            setModelData(editor.model, "<paragraph>[<$text bold=\"true\">foo</$text>]</paragraph>");

            const view = button();
            view.fire("execute");

            expect(ui().isActive).toBe(true);
            expect(view.isOn).toBe(true);
            expect(root().classList.contains(CURSOR_ACTIVE_CSS_CLASS)).toBe(true);
            expect(editor.commands.get(COPY_FORMAT_COMMAND)?.value).toEqual({ bold: true });
        });

        it("pastes onto the next click's selection, then disarms", () => {
            setModelData(editor.model, "<paragraph>[<$text bold=\"true\">foo</$text>]</paragraph>");
            button().fire("execute");

            // The user now selects a target elsewhere and releases the mouse over it.
            setModelData(editor.model, "<paragraph>[bar]</paragraph>");
            paintClick();

            expect(model()).toContain("<$text bold=\"true\">bar</$text>");
            expect(ui().isActive).toBe(false);
            expect(root().classList.contains(CURSOR_ACTIVE_CSS_CLASS)).toBe(false);
        });

        it("disarms without pasting when the button is clicked again", () => {
            setModelData(editor.model, "<paragraph>[<$text bold=\"true\">foo</$text>]</paragraph>");
            const view = button();

            view.fire("execute");
            expect(ui().isActive).toBe(true);

            view.fire("execute");
            expect(ui().isActive).toBe(false);

            // A later click must not paste, since the painter is no longer armed.
            setModelData(editor.model, "<paragraph>[bar]</paragraph>");
            paintClick();
            expect(model()).toContain("<paragraph>bar</paragraph>");
        });

        // The tests above drive `mouseup` synthetically, with the model selection already moved, so
        // they cannot show whether a *real* pointer interaction has updated the model selection by
        // the time the DOM `mouseup` listener runs. It has: the browser dispatches the queued
        // `selectionchange` (which CKEditor converts to a model selection synchronously) before it
        // dispatches `mouseup`. These two run in a real Chrome, so a regression here — a paint that
        // lands on the pre-click selection — turns the suite red rather than shipping.
        it("paints onto a real click's selection, not the one it replaced", async () => {
            setModelData(editor.model,
                "<paragraph><$text bold=\"true\">[foo]</$text></paragraph><paragraph>barbarbarbar</paragraph>");
            button().fire("execute");

            const target = root().children[1];
            if (!(target instanceof HTMLElement)) {
                throw new Error("target paragraph is not attached");
            }
            await userEvent.click(target);

            // Collapsed target: the format arrives as selection attributes, in the clicked paragraph.
            const position = editor.model.document.selection.getFirstPosition();
            expect(position?.path[0]).toBe(1);
            expect(editor.model.document.selection.getAttribute("bold")).toBe(true);
        });

        it("paints onto a real drag-selection", async () => {
            setModelData(editor.model,
                "<paragraph><$text bold=\"true\">[foo]</$text></paragraph>"
                + "<paragraph>barbarbarbarbarbarba</paragraph><paragraph>bazbazbazbazbazbazba</paragraph>");
            button().fire("execute");

            const [ , second, third ] = Array.from(root().children);
            if (!(second instanceof HTMLElement) || !(third instanceof HTMLElement)) {
                throw new Error("target paragraphs are not attached");
            }
            // A real pointer press, move and release — i.e. a native text drag-select.
            await userEvent.dragAndDrop(second, third);

            const selection = editor.model.document.selection;
            expect(selection.isCollapsed).toBe(false);
            // The paint covered exactly what the drag selected, across the two paragraphs it spans.
            const [ firstRange ] = [ ...selection.getRanges() ];
            expect(model()).toContain("<$text bold=\"true\">");
            expect(firstRange.start.path[0]).toBe(1);
            expect(firstRange.end.path[0]).toBe(2);
        });
    });

    describe("cancelling", () => {
        function arm() {
            setModelData(editor.model, "<paragraph>[<$text bold=\"true\">foo</$text>]</paragraph>");
            button().fire("execute");
            expect(ui().isActive).toBe(true);
        }

        it("cancels on Escape", () => {
            arm();
            pressKey(keyCodes.esc);
            expect(ui().isActive).toBe(false);
        });

        it("ignores a non-Escape key while armed", () => {
            arm();
            pressKey(keyCodes.arrowdown);
            expect(ui().isActive).toBe(true);
        });

        it("does nothing on Escape when not armed", () => {
            pressKey(keyCodes.esc);
            expect(ui().isActive).toBe(false);
        });

        it("cancels when the editor turns read-only", () => {
            arm();
            editor.enableReadOnlyMode("test");
            expect(ui().isActive).toBe(false);
            editor.disableReadOnlyMode("test");
        });

        it("tolerates a read-only toggle while not armed", () => {
            editor.enableReadOnlyMode("test");
            expect(ui().isActive).toBe(false);
            editor.disableReadOnlyMode("test");
        });
    });
});
