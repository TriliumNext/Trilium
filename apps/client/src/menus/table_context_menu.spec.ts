import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/i18n.js", () => ({ t: (key: string) => key }));
vi.mock("./text_editor_context_menu.js", () => ({ getTextEditorContaining: vi.fn() }));

import type { CKTextEditor } from "@triliumnext/ckeditor5";

import type { MenuCommandItem, MenuItem } from "./context_menu.js";
import {
    buildTableContextMenuSections,
    buildTableMenuSections,
    hasTableCellSelection,
    type TableMenuSections
} from "./table_context_menu.js";
import { getTextEditorContaining } from "./text_editor_context_menu.js";

const MAIN_TITLES = [
    "table_context_menu.insert_rows_above",
    "table_context_menu.insert_rows_below",
    "---",
    "table_context_menu.insert_columns_left",
    "table_context_menu.insert_columns_right",
    "---",
    "table_context_menu.set_header_row",
    "table_context_menu.merge_cells",
    "table_context_menu.split_cells",
    "table_context_menu.distribute_columns"
];

const SORT_TITLES = [
    "table_context_menu.sort_ascending",
    "table_context_menu.sort_descending"
];

const DELETE_TITLES = [
    "table_context_menu.delete_rows",
    "table_context_menu.delete_columns",
    "table_context_menu.delete_table"
];

const SELECT_TITLES = [
    "table_context_menu.select_row",
    "table_context_menu.select_column",
    "table_context_menu.select_table"
];

const SELECT_COMMANDS = ["selectTableRow", "selectTableColumn", "triliumSelectTable"];

describe("buildTableMenuSections", () => {
    it("returns the sections in order, with a split submenu", () => {
        const { editor, syncSelectionToDomTarget } = stubEditor();
        const element = cellElement();

        const sections = buildTableMenuSections(editor, element);

        expect(syncSelectionToDomTarget).toHaveBeenCalledWith(element);
        expect(titles(sections?.main ?? [])).toEqual(MAIN_TITLES);
        expect(sections?.pasteRows).toEqual([]);
        expect(titles(sections?.delete ?? [])).toEqual(DELETE_TITLES);
        expect(titles(sections ? [sections.sort] : [])).toEqual(["table_context_menu.sort"]);
        expect(titles(sortSubmenu(sections))).toEqual(SORT_TITLES);
        const sortRow = sections?.sort as MenuCommandItem<any> | undefined;
        expect(sortRow?.uiIcon).toBe("bx bx-sort-alt-2");
        expect(sortSubmenu(sections).map((item) => (item as MenuCommandItem<any>).uiIcon))
            .toEqual(["bx bx-sort-up", "bx bx-sort-down"]);
        expect(titles(sections ? [sections.select] : [])).toEqual(["table_context_menu.select"]);
        expect(titles(selectSubmenu(sections))).toEqual(SELECT_TITLES);
        const selectRow = sections?.select as MenuCommandItem<any> | undefined;
        expect(selectRow?.uiIcon).toBe("bx bx-select-multiple");
        expect(selectSubmenu(sections).map((item) => (item as MenuCommandItem<any>).uiIcon))
            .toEqual(["bx bx-grid-horizontal", "bx bx-grid-vertical", "bx bx-table"]);

        const splitRow = findItem(sections?.main ?? [], "table_context_menu.split_cells");
        const submenu = splitRow?.items ?? [];
        expect(titles(submenu)).toEqual([
            "table_context_menu.split_vertically",
            "table_context_menu.split_horizontally",
            "---",
            "table_context_menu.split_reset"
        ]);
    });

    it("executes the mapped command and refocuses the editor", () => {
        const { editor, executed, focus } = stubEditor();
        const sections = buildTableMenuSections(editor, cellElement());
        const items = allItems(sections);
        const submenu = findItem(items, "table_context_menu.split_cells")?.items ?? [];

        for (const title of titles(items).filter((t) => t !== "---")) {
            run(items, title);
        }
        run(submenu, "table_context_menu.split_vertically");
        run(submenu, "table_context_menu.split_horizontally");
        run(submenu, "table_context_menu.split_reset");
        for (const title of SORT_TITLES) {
            run(sortSubmenu(sections), title);
        }
        for (const title of SELECT_TITLES) {
            run(selectSubmenu(sections), title);
        }

        expect(executed).toEqual([
            "triliumInsertTableRowsAbove",
            "triliumInsertTableRowsBelow",
            "triliumInsertTableColumnsLeft",
            "triliumInsertTableColumnsRight",
            "triliumSetTableHeaderRow",
            "mergeTableCells",
            "triliumDistributeTableColumns",
            "removeTableRow",
            "removeTableColumn",
            "triliumDeleteTable",
            "splitTableCellVertically",
            "splitTableCellHorizontally",
            "triliumResetTableCellSpans",
            "triliumSortTableRowsAscending",
            "triliumSortTableRowsDescending",
            ...SELECT_COMMANDS
        ]);
        expect(focus).toHaveBeenCalledTimes(executed.length);
    });

    it("snapshots each row's enablement from its command", () => {
        const { editor } = stubEditor([
            "mergeTableCells",
            "splitTableCellVertically",
            "removeTableRow",
            "triliumDistributeTableColumns"
        ]);
        const items = allItems(buildTableMenuSections(editor, cellElement()));

        expect(findItem(items, "table_context_menu.distribute_columns")?.enabled).toBe(false);
        expect(findItem(items, "table_context_menu.merge_cells")?.enabled).toBe(false);
        expect(findItem(items, "table_context_menu.split_cells")?.enabled).toBe(true);
        expect(findItem(items, "table_context_menu.delete_rows")?.enabled).toBe(false);
        expect(findItem(items, "table_context_menu.delete_columns")?.enabled).toBe(true);
        expect(findItem(items, "table_context_menu.insert_rows_above")?.enabled).toBe(true);
    });

    it("shows only the header item that applies, with a trailing check while it is on", () => {
        const FIRST_ROWS = "triliumSetTableHeaderRow";
        const LATER_ROW = "triliumSetTableHeaderUpToRow";
        const FIRST_ROWS_TITLE = "table_context_menu.set_header_row";
        const LATER_ROW_TITLE = "table_context_menu.set_header_up_to_row";
        const build = (disabled: string[], checkedCommands: string[] = []) => {
            const stub = stubEditor(disabled, { checkedCommands });
            const main = buildTableMenuSections(stub.editor, cellElement())?.main ?? [];
            return { ...stub, main };
        };

        const firstRows = build([LATER_ROW]);
        expect(titles(firstRows.main)).toEqual(MAIN_TITLES);
        expect(findItem(firstRows.main, FIRST_ROWS_TITLE))
            .toMatchObject({ uiIcon: "bx bx-dock-top", checked: false });

        const laterRow = build([FIRST_ROWS], [LATER_ROW]);
        expect(titles(laterRow.main)).toEqual(MAIN_TITLES
            .map((title) => (title === FIRST_ROWS_TITLE ? LATER_ROW_TITLE : title)));
        expect(findItem(laterRow.main, LATER_ROW_TITLE))
            .toMatchObject({ uiIcon: "bx bx-arrow-to-top", checked: true });
        run(laterRow.main, LATER_ROW_TITLE);
        expect(laterRow.executed).toEqual([LATER_ROW]);

        // A selection of several rows below the first shows neither item.
        expect(titles(build([FIRST_ROWS, LATER_ROW]).main))
            .toEqual(MAIN_TITLES.filter((title) => title !== FIRST_ROWS_TITLE));
    });

    it("enables the split submenu while any of its rows is enabled", () => {
        const SPLIT_COMMANDS = [
            "splitTableCellVertically",
            "splitTableCellHorizontally",
            "triliumResetTableCellSpans"
        ];
        const splitRow = (disabled: string[]) => {
            const { editor } = stubEditor(disabled);
            const main = buildTableMenuSections(editor, cellElement())?.main ?? [];
            return findItem(main, "table_context_menu.split_cells")?.enabled;
        };

        for (const enabled of SPLIT_COMMANDS) {
            const disabled = SPLIT_COMMANDS.filter((command) => command !== enabled);
            expect(splitRow(disabled), enabled).toBe(true);
        }
        expect(splitRow(SPLIT_COMMANDS)).toBe(false);
    });

    it("enables the sort submenu while either direction is enabled", () => {
        const SORT_COMMANDS = ["triliumSortTableRowsAscending", "triliumSortTableRowsDescending"];
        const sortRow = (disabled: string[]) => {
            const { editor } = stubEditor(disabled);
            const sections = buildTableMenuSections(editor, cellElement());
            return (sections?.sort as MenuCommandItem<any> | undefined)?.enabled;
        };

        expect(sortRow([])).toBe(true);
        expect(sortRow([SORT_COMMANDS[0]])).toBe(true);
        expect(sortRow(SORT_COMMANDS)).toBe(false);

        const { editor } = stubEditor([SORT_COMMANDS[1]]);
        const submenu = sortSubmenu(buildTableMenuSections(editor, cellElement()));
        expect(findItem(submenu, SORT_TITLES[0])?.enabled).toBe(true);
        expect(findItem(submenu, SORT_TITLES[1])?.enabled).toBe(false);
    });

    it("enables the select submenu while any of its rows is enabled", () => {
        const selectSections = (disabled: string[]) => {
            const { editor } = stubEditor(disabled);
            return buildTableMenuSections(editor, cellElement());
        };
        const selectRowEnabled = (disabled: string[]) =>
            (selectSections(disabled)?.select as MenuCommandItem<any> | undefined)?.enabled;

        for (const enabled of SELECT_COMMANDS) {
            const disabled = SELECT_COMMANDS.filter((command) => command !== enabled);
            expect(selectRowEnabled(disabled), enabled).toBe(true);
        }
        expect(selectRowEnabled(SELECT_COMMANDS)).toBe(false);

        const submenu = selectSubmenu(selectSections([SELECT_COMMANDS[2]]));
        expect(submenu.map((item) => (item as MenuCommandItem<any>).enabled))
            .toEqual([true, true, false]);
    });

    it("returns null without the plugin or a table cell at the target", () => {
        const { editor: withoutPlugin } = stubEditor([], { hasPlugin: false });
        expect(buildTableMenuSections(withoutPlugin, cellElement())).toBeNull();

        const { editor } = stubEditor([], { syncResult: false });
        expect(buildTableMenuSections(editor, cellElement())).toBeNull();
    });
});

describe("paste rows", () => {
    const TITLES = ["table_context_menu.paste_rows_above", "table_context_menu.paste_rows_below"];

    it("shows the items only for a single-row selection and a readable clipboard", () => {
        const pasteRows = (disabled: string[], clipboard?: ReturnType<typeof clipboardAccess>) => {
            const { editor } = stubEditor(disabled);
            return buildTableMenuSections(editor, cellElement(), clipboard)?.pasteRows ?? [];
        };

        expect(pasteRows([])).toEqual([]);
        expect(pasteRows(["triliumPasteTableRowsAbove"], clipboardAccess())).toEqual([]);

        const shown = pasteRows([], clipboardAccess());
        expect(titles(shown)).toEqual(TITLES);
        expect(shown.map((item) => (item as MenuCommandItem<any>).uiIcon)).toEqual([
            "bx bx-horizontal-left bx-rotate-90",
            "bx bx-horizontal-left bx-rotate-270"
        ]);
        expect(shown.map((item) => (item as MenuCommandItem<any>).enabled)).toEqual([true, true]);

        const unavailable = pasteRows([], clipboardAccess(false));
        expect(unavailable.map((item) => (item as MenuCommandItem<any>).enabled))
            .toEqual([false, false]);
    });

    it("reads the clipboard and pastes it as rows at the selection pinned beforehand", async () => {
        const { editor, execute, capturePasteTarget, pasteTarget } = stubEditor();
        const clipboard = clipboardAccess();
        const items = buildTableMenuSections(editor, cellElement(), clipboard)?.pasteRows ?? [];

        run(items, TITLES[1]);
        await vi.waitFor(() => expect(pasteTarget.release).toHaveBeenCalled());

        expect(capturePasteTarget.mock.invocationCallOrder[0])
            .toBeLessThan(clipboard.read.mock.invocationCallOrder[0]);
        expect(pasteTarget.restore).toHaveBeenCalled();
        expect(execute).toHaveBeenCalledWith("triliumPasteTableRowsBelow",
            { html: "<table></table>", text: "t" });
    });

    it("drops the paste when the pinned selection is gone or the read fails", async () => {
        const gone = stubEditor([], { restoreResult: false });
        run(buildTableMenuSections(gone.editor, cellElement(), clipboardAccess())?.pasteRows ?? [],
            TITLES[0]);
        await vi.waitFor(() => expect(gone.pasteTarget.release).toHaveBeenCalled());
        expect(gone.execute).not.toHaveBeenCalled();

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const failing = stubEditor();
            const clipboard = clipboardAccess();
            clipboard.read.mockRejectedValueOnce(new Error("denied"));
            run(buildTableMenuSections(failing.editor, cellElement(), clipboard)?.pasteRows ?? [],
                TITLES[0]);
            await vi.waitFor(() => expect(failing.pasteTarget.release).toHaveBeenCalled());

            expect(failing.pasteTarget.restore).not.toHaveBeenCalled();
            expect(failing.execute).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });
});

describe("buildTableContextMenuSections", () => {
    const resolveEditor = vi.mocked(getTextEditorContaining);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("ignores targets outside a table cell without resolving the editor", async () => {
        expect(await buildTableContextMenuSections(null)).toBeNull();
        expect(await buildTableContextMenuSections(document.createElement("div"))).toBeNull();
        expect(resolveEditor).not.toHaveBeenCalled();
    });

    it("builds the sections for a cell target inside the active text editor", async () => {
        const { editor } = stubEditor();
        resolveEditor.mockResolvedValue(editor);
        const element = cellElement();

        const sections = await buildTableContextMenuSections(element, clipboardAccess());

        expect(resolveEditor).toHaveBeenCalledWith(element);
        expect(titles(sections?.main ?? [])).toEqual(MAIN_TITLES);
        expect(titles(sections?.delete ?? [])).toEqual(DELETE_TITLES);
        expect(titles(sections?.pasteRows ?? [])).toEqual([
            "table_context_menu.paste_rows_above",
            "table_context_menu.paste_rows_below"
        ]);
    });

    it("returns null when no text editor contains the target", async () => {
        resolveEditor.mockResolvedValue(null);
        expect(await buildTableContextMenuSections(cellElement())).toBeNull();
    });
});

describe("hasTableCellSelection", () => {
    const resolveEditor = vi.mocked(getTextEditorContaining);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("reports the resolved editor's multi-cell selection", async () => {
        let selected: unknown[] | null = [ {}, {} ];
        resolveEditor.mockResolvedValue({
            plugins: {
                has: (name: string) => name === "TableSelection",
                get: () => ({ getSelectedTableCells: () => selected })
            }
        } as unknown as CKTextEditor);

        expect(await hasTableCellSelection(cellElement())).toBe(true);

        // A caret or a plain text range inside one cell reports null.
        selected = null;
        expect(await hasTableCellSelection(cellElement())).toBe(false);
    });

    it("reports false without an element, an editor, or the plugin", async () => {
        expect(await hasTableCellSelection(null)).toBe(false);
        expect(resolveEditor).not.toHaveBeenCalled();

        resolveEditor.mockResolvedValue(null);
        expect(await hasTableCellSelection(cellElement())).toBe(false);

        resolveEditor.mockResolvedValue(
            { plugins: { has: () => false } } as unknown as CKTextEditor
        );
        expect(await hasTableCellSelection(cellElement())).toBe(false);
    });
});

/**
 * A minimal editor double: `TableContextMenu` is present unless `hasPlugin` says otherwise, and
 * every command is enabled except the ones in `disabledCommands`.
 */
function stubEditor(
    disabledCommands: string[] = [],
    {
        hasPlugin = true,
        syncResult = true,
        checkedCommands = [] as string[],
        restoreResult = true
    } = {}
) {
    const executed: string[] = [];
    const focus = vi.fn();
    const syncSelectionToDomTarget = vi.fn(() => syncResult);
    const pasteTarget = { restore: vi.fn(() => restoreResult), release: vi.fn() };
    const capturePasteTarget = vi.fn(() => pasteTarget);
    const execute = vi.fn((name: string, ..._args: unknown[]) => {
        executed.push(name);
    });
    const editor = {
        plugins: {
            has: (name: string) => hasPlugin && name === "TableContextMenu",
            get: () => ({ syncSelectionToDomTarget })
        },
        commands: {
            get: (name: string) => ({
                isEnabled: !disabledCommands.includes(name),
                value: checkedCommands.includes(name)
            })
        },
        execute,
        capturePasteTarget,
        editing: { view: { focus } }
    };

    return {
        editor: editor as unknown as CKTextEditor,
        executed,
        execute,
        focus,
        capturePasteTarget,
        pasteTarget,
        syncSelectionToDomTarget
    };
}

/** A host's clipboard access, whose `read()` resolves with a one-cell table. */
function clipboardAccess(enabled = true) {
    return {
        enabled,
        read: vi.fn(() => Promise.resolve({ html: "<table></table>", text: "t" }))
    };
}

/** A node nested inside a detached `<td>`, standing in for the right-click target. */
function cellElement(): Element {
    const cell = document.createElement("td");
    const inner = document.createElement("span");
    cell.appendChild(inner);
    return inner;
}

/** Both sections as one list, main first. */
function allItems(sections: TableMenuSections | null) {
    return [...(sections?.main ?? []), ...(sections?.delete ?? [])];
}

function sortSubmenu(sections: TableMenuSections | null): MenuItem<any>[] {
    return (sections?.sort as MenuCommandItem<any> | undefined)?.items ?? [];
}

function selectSubmenu(sections: TableMenuSections | null): MenuItem<any>[] {
    return (sections?.select as MenuCommandItem<any> | undefined)?.items ?? [];
}

/** The titles of `items`, with separators rendered as "---" so ordering stays readable. */
function titles(items: MenuItem<any>[]) {
    return items.map((item) => ("kind" in item && item.kind === "separator"
        ? "---"
        : (item as MenuCommandItem<any>).title));
}

function findItem(items: MenuItem<any>[], title: string) {
    const found = items.find((item) => !("kind" in item) && item.title === title);
    return found as MenuCommandItem<any> | undefined;
}

function run(items: MenuItem<any>[], title: string) {
    findItem(items, title)?.handler?.({} as never, {} as never);
}
