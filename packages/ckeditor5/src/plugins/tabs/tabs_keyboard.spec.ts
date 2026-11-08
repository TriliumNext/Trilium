import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor,
    Essentials,
    Paragraph
} from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor, pressKey as press } from "../../../test/editor-kit.js";
import Tabs from "./tabs.js";

describe("tabs keyboard shortcuts", () => {

    it("lists the shortcuts in the accessibility help", async () => {
        const editor = await createEditor();
        const group = editor.accessibility.keystrokeInfos.get("contentEditing")?.groups.get("tabs");

        expect(group?.label).toBe("Keystrokes that can be used in a tabs block");
        expect(group?.keystrokes.map(({ keystroke }) => keystroke)).toEqual([
            "Ctrl+ArrowLeft", "Ctrl+ArrowRight", "Ctrl+Shift+Home", "Ctrl+Shift+End",
            "Ctrl+Alt+ArrowLeft", "Ctrl+Alt+ArrowRight", "Ctrl+Alt+Home", "Ctrl+Alt+End",
            "Ctrl+Enter", "Ctrl+Shift+Enter"
        ]);
    });

    it("moves the selected content to another tab, shows that tab and scrolls to it", async () => {
        const editor = await createEditor();
        const scroll = vi.spyOn(editor.editing.view, "scrollToTheSelection");
        setModelData(editor.model, block(tab("A", "a"), tab("B", "[b]"), tab("C", "c")));

        expect(press(editor, "ArrowRight", { ctrlKey: true })).toBe(true);
        expect(model(editor)).toBe(block(tab("A", "a"), tab("B", ""), tab("C", "[b]", "c")));
        expect(activeTitles(editor)).toEqual(["C"]);
        expect(scroll).toHaveBeenCalledOnce();

        expect(press(editor, "Home", { ctrlKey: true, shiftKey: true })).toBe(true);
        expect(model(editor)).toBe(block(tab("A", "a", "[b]"), tab("B", ""), tab("C", "c")));
        expect(activeTitles(editor)).toEqual(["A"]);

        expect(press(editor, "ArrowLeft", { ctrlKey: true })).toBe(true);
        expect(model(editor)).toBe(block(tab("A", "a", "[b]"), tab("B", ""), tab("C", "c")));
        expect(scroll).toHaveBeenCalledTimes(2);
    });

    it("leaves the keys to the editor for a caret and for a selection in a title", async () => {
        const editor = await createEditor();
        for (const data of [
            block(tab("A", "a[]"), tab("B", "b")),
            block(tab("[A]", "a"), tab("B", "b"))
        ]) {
            setModelData(editor.model, data);
            expect(press(editor, "ArrowRight", { ctrlKey: true }), data).toBe(false);
            expect(press(editor, "End", { ctrlKey: true, shiftKey: true }), data).toBe(false);
            expect(model(editor)).toBe(data);
        }
    });

    it("moves the current tab, from its title or its panel", async () => {
        const editor = await createEditor();
        setModelData(editor.model, block(tab("A[]", "a"), tab("B", "b"), tab("C", "c")));

        expect(press(editor, "ArrowRight", { ctrlKey: true, altKey: true })).toBe(true);
        expect(model(editor)).toBe(block(tab("B", "b"), tab("A[]", "a"), tab("C", "c")));

        expect(press(editor, "End", { ctrlKey: true, altKey: true })).toBe(true);
        expect(model(editor)).toBe(block(tab("B", "b"), tab("C", "c"), tab("A[]", "a")));

        setModelData(editor.model, block(tab("A", "a"), tab("B", "b"), tab("C", "c[]")));
        expect(press(editor, "Home", { ctrlKey: true, altKey: true })).toBe(true);
        expect(model(editor)).toBe(block(tab("C", "c[]"), tab("A", "a"), tab("B", "b")));

        expect(press(editor, "ArrowLeft", { ctrlKey: true, altKey: true })).toBe(true);
        expect(model(editor)).toBe(block(tab("C", "c[]"), tab("A", "a"), tab("B", "b")));
        expect(activeTitles(editor)).toEqual(["C"]);
    });

    it("adds a tab after or before the current one and selects its title", async () => {
        const editor = await createEditor();
        setModelData(editor.model, block(tab("A", "a"), tab("B", "b[]")));

        expect(press(editor, "Enter", { ctrlKey: true, shiftKey: true })).toBe(true);
        expect(model(editor)).toBe(block(tab("A", "a"), tab("[Tab 2]", ""), tab("B", "b")));

        expect(press(editor, "Enter", { ctrlKey: true })).toBe(true);
        expect(model(editor))
            .toBe(block(tab("A", "a"), tab("Tab 2", ""), tab("[Tab 3]", ""), tab("B", "b")));
        expect(activeTitles(editor)).toEqual(["Tab 3"]);
    });
});

async function createEditor() {
    return createTestEditor([Essentials, Paragraph, Tabs]);
}

function model(editor: ClassicEditor) {
    return getModelData(editor.model);
}

function activeTitles(editor: ClassicEditor) {
    const root = editor.editing.view.getDomRoot();
    return [...root?.querySelectorAll(".trilium-tab-title--active") ?? []]
        .map(title => title.textContent);
}

/** A tabs block in model notation that holds `tabs`. */
function block(...tabs: string[]) {
    return `<tabs>${tabs.join("")}</tabs>`;
}

/** A tab in model notation with the given title and a paragraph for each of `texts`. */
function tab(title: string, ...texts: string[]) {
    const panel = texts.map(text => `<paragraph>${text}</paragraph>`).join("");
    return `<tab><tabTitle>${title}</tabTitle><tabPanel>${panel}</tabPanel></tab>`;
}
