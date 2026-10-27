import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../entities/fnote";
import type { MenuItem } from "../../menus/context_menu";
import attributes from "../../services/attributes";
import options from "../../services/options";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import {
    type CodeMenu, type CodeSettings, type CodeText, getLineNumbersMenu, getWordWrapMenu,
    useCodeLanguageMenu, useNoteCodeSettings, useTabWidthMenu
} from "./code_menus";

vi.mock("../../services/i18n", () => ({
    t: (key: string, values?: Record<string, unknown>) =>
        values ? `${key} ${Object.values(values).join(" ")}` : key
}));

const container = document.createElement("div");

beforeEach(() => {
    options.set("codeNoteTabWidth", "4");
    options.set("codeNoteIndentWithTabs", "false");
    options.set("codeNotesMimeTypes", JSON.stringify([ "text/x-python" ]));
    options.set("codeNotesMimeTypesSortAlphabetically", "true");
});

afterEach(() => {
    act(() => render(null, container));
    vi.restoreAllMocks();
});

describe("useTabWidthMenu", () => {
    it("shows the global indentation of a note without its own, and sets the note's", async () => {
        const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
        const menu = renderTabWidthMenu(buildCodeNote());

        expect(menu().text).toBe("status_bar.tab_width_spaces_short 4");
        expect([ menu().title, menu().icon ])
            .toEqual([ "status_bar.tab_width_title", "bx bx-right-indent" ]);
        expect(describeItems(menu().items)).toEqual([
            "# status_bar.tab_width_style_header",
            "status_bar.tab_width_style_spaces ✓",
            "status_bar.tab_width_style_tabs ☐",
            "# status_bar.tab_width_display_header",
            "status_bar.tab_width_spaces 1 ☐",
            "status_bar.tab_width_spaces 2 ☐",
            "status_bar.tab_width_spaces 3 ☐",
            "status_bar.tab_width_spaces 4 ✓",
            "status_bar.tab_width_spaces 6 ☐",
            "status_bar.tab_width_spaces 8 ☐",
            "# status_bar.tab_width_reindent_header",
            "status_bar.tab_width_spaces 1",
            "status_bar.tab_width_spaces 2",
            "status_bar.tab_width_spaces 3",
            "status_bar.tab_width_spaces 4 (disabled)",
            "status_bar.tab_width_spaces 6",
            "status_bar.tab_width_spaces 8",
            "status_bar.tab_width_style_tabs"
        ]);

        await act(async () => select(menu().items, "status_bar.tab_width_spaces 2"));
        await act(async () => select(menu().items, "status_bar.tab_width_style_tabs"));
        expect(setLabel.mock.calls.map((call) => call.slice(1, 3)))
            .toEqual([ [ "tabWidth", "2" ], [ "indentWithTabs", "true" ] ]);
    });

    it("offers the global settings back to a note with its own", async () => {
        const remove = vi.spyOn(attributes, "removeOwnedLabelByName").mockResolvedValue(true);
        const note = buildCodeNote({ "#tabWidth": "2", "#indentWithTabs": "true" });
        const menu = renderTabWidthMenu(note);

        expect(menu().text).toBe("status_bar.tab_width_tabs 2");
        const defaultStyle = "status_bar.tab_width_use_default_style "
            + "status_bar.tab_width_style_spaces";
        const defaultWidth = "status_bar.tab_width_use_default 4";
        expect(describeItems(menu().items).filter((item) => item.includes("use_default")))
            .toEqual([ defaultStyle, defaultWidth ]);

        await act(async () => select(menu().items, defaultStyle));
        await act(async () => select(menu().items, defaultWidth));
        expect(remove.mock.calls.map((call) => call[1])).toEqual([ "indentWithTabs", "tabWidth" ]);
    });

    it("re-indents the text of the code editor, then keeps the new indentation", async () => {
        const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
        let text = "a\n    b\n        c";
        const editor = {
            getText: () => text,
            setText: vi.fn((next: string) => {
                text = next;
            })
        };
        const getEditor = vi.fn<() => Promise<CodeText | null>>(async () => editor);
        const menu = renderTabWidthMenu(buildCodeNote(), getEditor);

        const reindentItems = menu().items.slice(-7);
        await act(async () => select(reindentItems, "status_bar.tab_width_spaces 2"));
        expect(text).toBe("a\n  b\n    c");
        expect(setLabel.mock.calls.map((call) => call.slice(1, 3)))
            .toEqual([ [ "tabWidth", "2" ], [ "indentWithTabs", "false" ] ]);

        // Nothing to convert, and no editor to convert: only an editor with changes is written.
        editor.setText.mockClear();
        text = "a";
        await act(async () => select(reindentItems, "status_bar.tab_width_style_tabs"));
        expect(editor.setText).not.toHaveBeenCalled();
        expect(setLabel).toHaveBeenCalledTimes(4);
        getEditor.mockResolvedValue(null);
        await act(async () => select(reindentItems, "status_bar.tab_width_spaces 8"));
        expect(setLabel).toHaveBeenCalledTimes(4);
    });

    it("hands each change to the code settings it shows, a re-indent as one change", async () => {
        const settings: CodeSettings = {
            mime: "text/x-python",
            setMime: vi.fn(),
            tabWidth: 2,
            useTabs: undefined,
            setIndentation: vi.fn()
        };
        let text = "a\n  b";
        const menu = renderTabWidthMenu(settings, async () => ({
            getText: () => text,
            setText: (next: string) => {
                text = next;
            }
        }));
        expect(menu().text).toBe("status_bar.tab_width_spaces_short 2");

        await act(async () => select(menu().items, "status_bar.tab_width_style_tabs"));
        await act(async () => select(menu().items.slice(-7), "status_bar.tab_width_style_tabs"));
        expect(text).toBe("a\n\tb");
        expect(vi.mocked(settings.setIndentation).mock.calls).toEqual([
            [ { useTabs: true } ],
            [ { tabWidth: 2, useTabs: true } ]
        ]);
    });
});

describe("useCodeLanguageMenu", () => {
    it("lists the enabled languages, changes the note's, and opens their options", async () => {
        const put = vi.spyOn(server, "put");
        const note = buildCodeNote();
        let result: ReturnType<typeof useCodeLanguageMenu> | undefined;
        function Harness() {
            result = useCodeLanguageMenu(useNoteCodeSettings(note));
            return result.modal;
        }
        act(() => render(<Harness />, container));
        const menu = () => {
            if (!result) throw new Error("The hook did not render.");
            return result.menu;
        };

        expect([ menu().title, menu().text, menu().filterable ])
            .toEqual([ "status_bar.code_note_switcher", "Python", true ]);
        expect(menu().icon).toMatch(/^bx /);
        expect(describeItems(menu().items)).toEqual([
            "Plain text ☐",
            "Python ✓",
            "---",
            "basic_properties.configure_code_notes"
        ]);

        await act(async () => select(menu().items, "Plain text"));
        expect(put).toHaveBeenCalledWith(`notes/${note.noteId}/type`, {
            type: "code", mime: "text/plain"
        });

        expect(document.querySelector(".code-mime-types-modal .modal-dialog")).toBeNull();
        await act(async () => select(menu().items, "basic_properties.configure_code_notes"));
        expect(document.querySelector(".code-mime-types-modal .modal-dialog")).not.toBeNull();
    });

    it("lists the languages in the stored order, or by name", () => {
        options.set("codeNotesMimeTypes",
            JSON.stringify([ "text/x-python", "text/plain", "text/css" ]));
        const note = buildCodeNote();
        const languages = (isSortedAlphabetically: boolean) => {
            options.set("codeNotesMimeTypesSortAlphabetically", String(isSortedAlphabetically));
            let items: MenuItem<unknown>[] = [];
            function Harness() {
                items = useCodeLanguageMenu(useNoteCodeSettings(note)).menu.items;
                return null;
            }
            act(() => render(<Harness />, container));
            act(() => render(null, container));
            return describeItems(items).slice(0, 3);
        };

        expect(languages(false)).toEqual([ "Python ✓", "Plain text ☐", "CSS ☐" ]);
        expect(languages(true)).toEqual([ "Plain text ☐", "CSS ☐", "Python ✓" ]);
    });
});

describe("getWordWrapMenu and getLineNumbersMenu", () => {
    it("check the current setting, and set it or follow the default again", async () => {
        const setValue = vi.fn();
        const wordWrap = getWordWrapMenu(undefined, setValue);
        expect([ wordWrap.title, wordWrap.uiIcon ])
            .toEqual([ "note_actions.word_wrap", "bx bx-align-justify" ]);
        expect(describeItems(wordWrap.items ?? [])).toEqual([
            "note_actions.word_wrap_auto ✓",
            "note_actions.word_wrap_on ☐",
            "note_actions.word_wrap_off ☐"
        ]);
        expect(wordWrap.items?.[0])
            .toMatchObject({ description: "note_actions.word_wrap_auto_description" });

        const lineNumbers = getLineNumbersMenu(false, setValue);
        expect([ lineNumbers.title, lineNumbers.uiIcon ])
            .toEqual([ "link_context_menu.line_numbers", "bx bx-list-ol" ]);
        expect(describeItems(lineNumbers.items ?? [])).toEqual([
            "link_context_menu.line_numbers_auto ☐",
            "link_context_menu.line_numbers_on ☐",
            "link_context_menu.line_numbers_off ✓"
        ]);
        expect(lineNumbers.items?.[0])
            .toMatchObject({ description: "link_context_menu.line_numbers_auto_description" });

        for (const title of [ "link_context_menu.line_numbers_auto",
            "link_context_menu.line_numbers_on", "link_context_menu.line_numbers_off" ]) {
            await select(lineNumbers.items ?? [], title);
        }
        expect(setValue.mock.calls).toEqual([ [ null ], [ true ], [ false ] ]);
    });
});

function buildCodeNote(labels: Record<`#${string}`, string> = {}) {
    return buildNote({ title: "Script", type: "code", mime: "text/x-python", ...labels });
}

/**
 * Renders `useTabWidthMenu()` for the settings of a note, or for `source` itself, and returns a
 * function reading its latest result.
 */
function renderTabWidthMenu(
    source: FNote | CodeSettings,
    getEditor: () => Promise<CodeText | null> = async () => null
) {
    let menu: CodeMenu | undefined;
    const note = "noteId" in source ? source : null;
    function Harness() {
        const noteSettings = useNoteCodeSettings(note);
        menu = useTabWidthMenu("noteId" in source ? noteSettings : source, getEditor);
        return null;
    }
    act(() => render(<Harness />, container));

    return () => {
        if (!menu) throw new Error("The hook did not render.");
        return menu;
    };
}

/** Each item as its title, `#` for a header, `---` for a separator, then its state. */
function describeItems(items: MenuItem<unknown>[]) {
    return items.map((item) => {
        if ("kind" in item) {
            return item.kind === "header" ? `# ${item.title}` : "---";
        }
        const check = item.checked === undefined ? "" : item.checked ? " ✓" : " ☐";
        return `${item.title}${check}${item.enabled === false ? " (disabled)" : ""}`;
    });
}

/** Runs the handler of the first item titled `title`. */
async function select(items: MenuItem<unknown>[], title: string) {
    const item = items.find((candidate) => "title" in candidate && candidate.title === title);
    if (!item || "kind" in item) throw new Error(`No item titled ${title}.`);
    await item.handler?.(item, new MouseEvent("click"));
}
