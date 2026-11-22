import {
    _setModelData, type ClassicEditor, env, Essentials, HorizontalLine, type ModelElement,
    type ModelWriter, Paragraph
} from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { registerTestCleanup } from "../../test/globals-test-kit.js";
import KeepDragSelection from "./keep_drag_selection.js";

const FIREFOX = { isBlink: false, isGecko: true, isAndroid: false };

describe("KeepDragSelection", () => {
    it("leaves the DOM selection to Firefox while a drag selects a widget", async () => {
        const editor = await createEditorIn(FIREFOX);
        const view = editor.editing.view;

        view.document.isSelecting = true;
        selectWidget(editor);
        expect(view.document.selection.isFake).toBe(true);
        expect(isDomSelectionOnWidget()).toBe(false);
        expect(document.getSelection()?.anchorNode?.textContent).toBe("ab");

        view.document.isSelecting = false;
        expect(isDomSelectionOnWidget()).toBe(true);
    });

    it("renders the selection during a drag that changes the structure", async () => {
        const editor = await createEditorIn(FIREFOX);

        editor.editing.view.document.isSelecting = true;
        selectWidget(editor, (writer, widget) => {
            writer.insertElement("paragraph", writer.createPositionBefore(widget));
        });
        expect(isDomSelectionOnWidget()).toBe(true);
    });

    it("leaves the renderer alone outside desktop Firefox", async () => {
        for (const browser of [
            { isBlink: false, isGecko: false, isAndroid: false },
            { isBlink: false, isGecko: true, isAndroid: true }
        ]) {
            const editor = await createEditorIn(browser);

            editor.editing.view.document.isSelecting = true;
            selectWidget(editor);
            expect(isDomSelectionOnWidget()).toBe(true);
            await editor.destroy();
        }
    });
});

/** Creates an editor while `env` describes `browser`, with the caret in the paragraph "ab". */
async function createEditorIn(browser: typeof FIREFOX) {
    const saved = { isBlink: env.isBlink, isGecko: env.isGecko, isAndroid: env.isAndroid };
    Object.assign(env, browser);
    registerTestCleanup(() => {
        Object.assign(env, saved);
    });

    const editor = await createTestEditor([
        Essentials, Paragraph, HorizontalLine, KeepDragSelection
    ]);
    _setModelData(editor.model,
        "<paragraph>a[]b</paragraph><horizontalLine></horizontalLine><paragraph>c</paragraph>");
    editor.editing.view.focus();
    return editor;
}

/** Selects the horizontal line, as a drag over it does, after `change` ran in the same block. */
function selectWidget(
    editor: ClassicEditor, change?: (writer: ModelWriter, widget: ModelElement) => void
) {
    editor.model.change((writer) => {
        const widget = [ ...editor.model.document.getRoot()?.getChildren() ?? [] ]
            .find((child) => child.is("element", "horizontalLine")) as ModelElement;
        change?.(writer, widget);
        writer.setSelection(widget, "on");
    });
}

function isDomSelectionOnWidget() {
    const anchor = document.getSelection()?.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    return !!element?.closest(".ck-fake-selection-container");
}
