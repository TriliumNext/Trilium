import { EditorSelection } from "@codemirror/state";
import VanillaCodeMirror from "@triliumnext/codemirror";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    dateFormat: "DD.MM.YY",
    contentLanguage: "tr" as string | null
}));

vi.mock("../services/i18n.js", () => ({ t: (key: string) => key }));
vi.mock("../services/options.js", () => ({
    default: { get: (name: string) => (name === "customDateTimeFormat" ? h.dateFormat : "") }
}));
vi.mock("../utils/formatters.js", () => ({ resolveContentLanguage: () => h.contentLanguage }));

import type { CommandNames } from "../components/app_context.js";
import { buildCodeEditorContextMenuItems } from "./code_editor_context_menu.js";
import type { MenuCommandItem, MenuItem } from "./context_menu.js";

let editors: VanillaCodeMirror[] = [];

afterEach(() => {
    for (const editor of editors) {
        editor.destroy();
    }
    editors = [];
    h.dateFormat = "DD.MM.YY";
    h.contentLanguage = "tr";
});

describe("buildCodeEditorContextMenuItems", () => {
    it("offers nothing outside a code editor or in a read-only one", async () => {
        // An element that only looks like an editor.
        const foreign = document.createElement("div");
        foreign.className = "cm-editor";
        const plain = document.createElement("div");
        await expect(buildCodeEditorContextMenuItems(plain)).resolves.toBeNull();
        await expect(buildCodeEditorContextMenuItems(null)).resolves.toBeNull();
        await expect(buildCodeEditorContextMenuItems(foreign)).resolves.toBeNull();
        const readOnly = createEditor("text", { from: 0, to: 4 }, true);
        await expect(buildCodeEditorContextMenuItems(lineOf(readOnly))).resolves.toBeNull();
    });

    it("lists every tool in one Transform submenu, grouped by what it changes", async () => {
        const items = await buildItems(createEditor("text", { from: 0, to: 4 }));

        expect(titles(items)).toEqual([ "code_editor_context_menu.transform" ]);
        expect(titles(submenu(items, 0))).toEqual([
            "code_editor_context_menu.sort_ascending",
            "code_editor_context_menu.sort_descending",
            "code_editor_context_menu.shuffle_lines",
            "code_editor_context_menu.reverse_lines",
            "code_editor_context_menu.deduplicate_lines",
            "---",
            "code_editor_context_menu.trim_leading",
            "code_editor_context_menu.trim_trailing",
            "code_editor_context_menu.trim_both",
            "code_editor_context_menu.remove_blank_lines",
            "---",
            "code_editor_context_menu.to_uppercase",
            "code_editor_context_menu.to_lowercase",
            "code_editor_context_menu.to_sentence_case",
            "code_editor_context_menu.to_title_case",
            "code_editor_context_menu.remove_diacritics"
        ]);
        expect(rows(submenu(items, 0)).slice(5, 9).map((row) => row.tooltip)).toEqual([
            "code_editor_context_menu.trim_leading_tooltip",
            "code_editor_context_menu.trim_trailing_tooltip",
            "code_editor_context_menu.trim_both_tooltip",
            undefined
        ]);
        expect(allRows(items)).toHaveLength(15);
        expect(allRows(items).every((row) => row.enabled)).toBe(true);
        expect(allRows(items).map((row) => row.uiIcon)).toEqual([
            "bx bx-text",
            ...Array(14).fill(undefined)
        ]);
    });

    it("disables every row while nothing is selected", async () => {
        const items = await buildItems(createEditor("text", { from: 2, to: 2 }));

        expect(allRows(items)).toHaveLength(15);
        expect(allRows(items).some((row) => row.enabled)).toBe(false);
    });

    it("sorts the selected lines by the user's date format, and focuses the editor", async () => {
        const editor = createEditor("01.10.26\n30.09.26\nend", { from: 0, to: 17 });
        const focus = vi.spyOn(editor, "focus");

        run(submenu(await buildItems(editor), 0), "code_editor_context_menu.sort_ascending");

        expect(editor.getText()).toBe("30.09.26\n01.10.26\nend");
        expect(focus).toHaveBeenCalled();
    });

    it("sorts without a date format or a content language of the user's", async () => {
        h.dateFormat = "";
        h.contentLanguage = null;
        const editor = createEditor("01.10.26\n30.09.26\nend", { from: 0, to: 17 });

        run(submenu(await buildItems(editor), 0), "code_editor_context_menu.sort_descending");

        expect(editor.getText()).toBe("30.09.26\n01.10.26\nend");
    });

    it("removes lines and transforms the selected text by the content language", async () => {
        const editor = createEditor("a\n\nb istanbul", { from: 0, to: 12 });
        run(submenu(await buildItems(editor), 0), "code_editor_context_menu.remove_blank_lines");
        expect(editor.getText()).toBe("a\nb istanbul");

        editor.dispatch({ selection: EditorSelection.range(4, 12) });
        const focus = vi.spyOn(editor, "focus");
        run(submenu(await buildItems(editor), 0), "code_editor_context_menu.to_uppercase");
        expect(editor.getText()).toBe("a\nb İSTANBUL");
        expect(focus).toHaveBeenCalled();

        run(submenu(await buildItems(editor), 0), "code_editor_context_menu.remove_diacritics");
        expect(editor.getText()).toBe("a\nb ISTANBUL");
    });
});

function createEditor(text: string, selection: { from: number; to: number }, readOnly = false) {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = new VanillaCodeMirror({ parent, readOnly });
    editor.setText(text);
    editor.dispatch({ selection: EditorSelection.range(selection.from, selection.to) });
    editors.push(editor);
    return editor;
}

/** A line of `editor`, as the right-click target. */
function lineOf(editor: VanillaCodeMirror) {
    return editor.contentDOM.querySelector(".cm-line") ?? editor.contentDOM;
}

async function buildItems(editor: VanillaCodeMirror) {
    const items = await buildCodeEditorContextMenuItems(lineOf(editor));
    if (!items) {
        throw new Error("expected the text tools");
    }
    return items;
}

function rows(items: MenuItem<CommandNames>[]) {
    return items.filter((item): item is MenuCommandItem<CommandNames> => !("kind" in item));
}

function titles(items: MenuItem<CommandNames>[]) {
    return items.map((item) => ("kind" in item ? "---" : item.title));
}

/** Every row of `items` and of their submenus. */
function allRows(items: MenuItem<CommandNames>[]): MenuCommandItem<CommandNames>[] {
    return rows(items).flatMap((row) => [ row, ...allRows(row.items ?? []) ]);
}

function submenu(items: MenuItem<CommandNames>[], index: number) {
    return rows(items)[index]?.items ?? [];
}

function run(items: MenuItem<CommandNames>[], title: string) {
    const row = rows(items).find((item) => item.title === title);
    if (!row?.handler) {
        throw new Error(`expected a row titled ${title}`);
    }
    row.handler(row, new MouseEvent("click"));
}
