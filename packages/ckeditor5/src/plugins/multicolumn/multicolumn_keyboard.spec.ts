import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor,
    Command,
    type Editor,
    env,
    Essentials,
    LinkEditing,
    List,
    Paragraph,
    TodoList
} from "ckeditor5";
import { describe, expect, it, onTestFinished } from "vitest";

import { createTestEditor, pressKey as press } from "../../../test/editor-kit.js";
import Multicolumn from "./multicolumn.js";

describe("multicolumn keyboard shortcuts", () => {

    it("lists the shortcuts in the accessibility help", async () => {
        const editor = await createEditor();
        const group = editor.accessibility.keystrokeInfos.get("contentEditing")
            ?.groups.get("multicolumnLayout");

        expect(group?.label).toBe("Keystrokes that can be used in a multicolumn layout");
        expect(group?.keystrokes.map(({ keystroke }) => keystroke)).toEqual([
            "Ctrl+ArrowLeft", "Ctrl+ArrowRight", "Ctrl+Shift+Home", "Ctrl+Shift+End",
            "Ctrl+Alt+ArrowLeft", "Ctrl+Alt+ArrowRight", "Ctrl+Alt+Home", "Ctrl+Alt+End",
            "Ctrl+Enter", "Ctrl+Shift+Enter"
        ]);
    });

    it("moves the selected content between columns, and leaves a caret to the editor", async () => {
        const editor = await createEditor();
        setModelData(editor.model, columns("1-1-1", p("A"), p("[B]"), p("C")));

        expect(press(editor, "ArrowRight", { ctrlKey: true })).toBe(true);
        expect(model(editor)).toBe(columns("1-1-1", p("A"), p(""), p("[B]", "C")));

        expect(press(editor, "Home", { ctrlKey: true, shiftKey: true })).toBe(true);
        expect(model(editor)).toBe(columns("1-1-1", p("A", "[B]"), p(""), p("C")));

        expect(press(editor, "ArrowLeft", { ctrlKey: true })).toBe(true);
        expect(model(editor)).toBe(columns("1-1-1", p("A", "[B]"), p(""), p("C")));

        expect(press(editor, "End", { ctrlKey: true, shiftKey: true })).toBe(true);
        expect(model(editor)).toBe(columns("1-1-1", p("A"), p(""), p("[B]", "C")));

        setModelData(editor.model, columns("1-1", p("A[]"), p("B")));
        expect(press(editor, "ArrowRight", { ctrlKey: true })).toBe(false);
        expect(press(editor, "End", { ctrlKey: true, shiftKey: true })).toBe(false);
        expect(model(editor)).toBe(columns("1-1", p("A[]"), p("B")));
    });

    it("moves the current column", async () => {
        const editor = await createEditor();
        setModelData(editor.model, columns("1-1-1", p("A[]"), p("B"), p("C")));

        expect(press(editor, "ArrowRight", { ctrlKey: true, altKey: true })).toBe(true);
        expect(model(editor)).toBe(columns("1-1-1", p("B"), p("A[]"), p("C")));

        expect(press(editor, "End", { ctrlKey: true, altKey: true })).toBe(true);
        expect(model(editor)).toBe(columns("1-1-1", p("B"), p("C"), p("A[]")));

        expect(press(editor, "ArrowRight", { ctrlKey: true, altKey: true })).toBe(true);
        expect(model(editor)).toBe(columns("1-1-1", p("B"), p("C"), p("A[]")));

        expect(press(editor, "Home", { ctrlKey: true, altKey: true })).toBe(true);
        expect(model(editor)).toBe(columns("1-1-1", p("A[]"), p("B"), p("C")));

        expect(press(editor, "ArrowLeft", { ctrlKey: true, altKey: true })).toBe(true);
        expect(model(editor)).toBe(columns("1-1-1", p("A[]"), p("B"), p("C")));
    });

    it("follows the screen in right-to-left content", async () => {
        const editor = await createEditor({ language: { content: "ar" } });
        setModelData(editor.model, columns("1-1", p("A"), p("[B]")));

        press(editor, "ArrowRight", { ctrlKey: true });
        expect(model(editor)).toBe(columns("1-1", p("A", "[B]"), p("")));

        press(editor, "ArrowLeft", { ctrlKey: true, altKey: true });
        expect(model(editor)).toBe(columns("1-1", p(""), p("A", "[B]")));
    });

    it("adds a column after or before the current one, up to four columns", async () => {
        const editor = await createEditor();
        setModelData(editor.model, columns("1-3", p("A[]"), p("B")));

        expect(press(editor, "Enter", { ctrlKey: true })).toBe(true);
        expect(model(editor)).toBe(columns("1-1-1", p("A"), p("[]"), p("B")));

        expect(press(editor, "Enter", { ctrlKey: true, shiftKey: true })).toBe(true);
        expect(model(editor)).toBe(columns("1-1-1-1", p("A"), p("[]"), p(""), p("B")));

        expect(press(editor, "Enter", { ctrlKey: true })).toBe(true);
        expect(model(editor)).toBe(columns("1-1-1-1", p("A"), p("[]"), p(""), p("B")));
    });

    it("leaves Ctrl+Enter to links, to-do items, collapsible titles and references", async () => {
        const editor = await createEditor();
        const contents = [
            "<paragraph><$text linkHref=\"x\">Li[]nk</$text></paragraph>",
            "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"todo\">X[]</paragraph>",
            "<summary>Ti[]tle</summary>",
            "<paragraph>[<reference></reference>]</paragraph>"
        ];
        for (const content of contents) {
            setModelData(editor.model, columns("1-1", content, p("")));
            expect(press(editor, "Enter", { ctrlKey: true }), content).toBe(false);
            expect(model(editor).match(/<multicolumnColumn>/g), content).toHaveLength(2);
        }
    });

    it("leaves Ctrl+Shift+Enter to the states of to-do items", async () => {
        const editor = await createEditor();
        editor.commands.add("setTaskState", new Command(editor));
        setModelData(editor.model, columns("1-1", p("A[]"), p("B")));

        expect(press(editor, "Enter", { ctrlKey: true, shiftKey: true })).toBe(false);
        expect(model(editor)).toBe(columns("1-1", p("A[]"), p("B")));
    });

    it("leaves other keys and the keys outside a layout alone", async () => {
        const editor = await createEditor();
        setModelData(editor.model, columns("1-1", p("[A]"), p("B")));
        const presses: Array<[string, KeyboardEventInit]> = [
            ["ArrowRight", {}],
            ["ArrowRight", { ctrlKey: true, shiftKey: true }],
            ["ArrowRight", { ctrlKey: true, metaKey: true }],
            ["Home", { ctrlKey: true }],
            ["End", { ctrlKey: true, altKey: true, shiftKey: true }],
            ["Enter", { ctrlKey: true, altKey: true }],
            ["a", { ctrlKey: true }]
        ];
        for (const [key, modifiers] of presses) {
            expect(press(editor, key, modifiers), `${key} ${JSON.stringify(modifiers)}`)
                .toBe(false);
        }
        expect(model(editor)).toBe(columns("1-1", p("[A]"), p("B")));

        setModelData(editor.model, "<paragraph>[A]</paragraph>");
        expect(press(editor, "ArrowRight", { ctrlKey: true })).toBe(false);
        expect(press(editor, "Enter", { ctrlKey: true })).toBe(false);
    });

    it("uses Cmd instead of Ctrl on macOS", async () => {
        const isMac = env.isMac;
        env.isMac = true;
        onTestFinished(() => {
            env.isMac = isMac;
        });
        const editor = await createEditor();
        setModelData(editor.model, columns("1-1", p("A[]"), p("B")));

        expect(press(editor, "ArrowRight", { ctrlKey: true, altKey: true })).toBe(false);
        expect(press(editor, "ArrowRight", { metaKey: true, altKey: true })).toBe(true);
        expect(model(editor)).toBe(columns("1-1", p("B"), p("A[]")));
    });
});

async function createEditor(config: Parameters<typeof createTestEditor>[1] = {}) {
    return createTestEditor(
        [Essentials, Paragraph, List, TodoList, LinkEditing, StandIns, Multicolumn], config);
}

/** Stands in for the title of a collapsible block and for a note reference. */
function StandIns(editor: Editor) {
    const schema = editor.model.schema;
    schema.register("summary", { allowWhere: "$block", allowContentOf: "$block", isBlock: true });
    schema.register("reference", { inheritAllFrom: "$inlineObject" });
    editor.conversion.elementToElement({ model: "summary", view: "summary" });
    editor.conversion.elementToElement({ model: "reference", view: "span" });
}

function model(editor: ClassicEditor) {
    return getModelData(editor.model);
}

/** A paragraph for each of `texts`, in model notation. */
function p(...texts: string[]) {
    return texts.map(text => `<paragraph>${text}</paragraph>`).join("");
}

/** A layout with the given weights whose columns hold the given model content. */
function columns(ratios: string, ...contents: string[]) {
    const content = contents.map(inner => `<multicolumnColumn>${inner}</multicolumnColumn>`);
    return `<multicolumnLayout columnRatios="${ratios}">${content.join("")}</multicolumnLayout>`;
}
