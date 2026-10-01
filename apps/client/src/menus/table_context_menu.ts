import type { CKTextEditor } from "@triliumnext/ckeditor5";

import type { CommandNames } from "../components/app_context.js";
import { t } from "../services/i18n.js";
import type { MenuItem } from "./context_menu.js";
import { submenuItem } from "./context_menu_utils.js";
import { getTextEditorContaining } from "./text_editor_context_menu.js";

/**
 * The table sections of the text editor's right-click menu. `clipboard` enables the paste rows.
 *
 * Returns `null` when the click is not on a table cell of the active text editor.
 */
export async function buildTableContextMenuSections(
    element: Element | null | undefined,
    clipboard?: ClipboardAccess
): Promise<TableMenuSections | null> {
    if (!element?.closest("td, th")) {
        return null;
    }

    const editor = await getTextEditorContaining(element);
    return editor && buildTableMenuSections(editor, element, clipboard);
}

/**
 * Builds the sections against a resolved editor. The selection is first moved into the clicked
 * cell (and kept when the cell is already part of it), so the enablement snapshots and the
 * executed commands agree with the cell the menu is opened on.
 */
export function buildTableMenuSections(
    editor: CKTextEditor,
    element: Element,
    clipboard?: ClipboardAccess
): TableMenuSections | null {
    if (!editor.plugins.has("TableContextMenu")
            || !editor.plugins.get("TableContextMenu").syncSelectionToDomTarget(element)) {
        return null;
    }

    const commandItem = (title: string, uiIcon: string, commandName: string) => ({
        title,
        uiIcon,
        enabled: editor.commands.get(commandName)?.isEnabled === true,
        handler: () => {
            editor.execute(commandName);
            editor.editing.view.focus();
        }
    });
    const toggleItem = (title: string, uiIcon: string, commandName: string) => ({
        ...commandItem(title, uiIcon, commandName),
        trailingIcon: editor.commands.get(commandName)?.value === true ? "bx bx-check" : undefined
    });

    // One toggle under two labels: only the item enabled for the selection is shown.
    const headerItem = [
        toggleItem(t("table_context_menu.set_header_row"), "bx bx-dock-top",
            "triliumSetTableHeaderRow"),
        toggleItem(t("table_context_menu.set_header_up_to_row"), "bx bx-arrow-to-top",
            "triliumSetTableHeaderUpToRow")
    ].find((item) => item.enabled);
    const splitItems = [
        commandItem(t("table_context_menu.split_vertically"), "bx bx-reflect-vertical",
            "splitTableCellVertically"),
        commandItem(t("table_context_menu.split_horizontally"), "bx bx-reflect-horizontal",
            "splitTableCellHorizontally")
    ];
    const unmergeItem = commandItem(t("table_context_menu.split_reset"), "bx bx-reset",
        "triliumResetTableCellSpans");
    const sortItems = [
        commandItem(t("table_context_menu.sort_ascending"), "bx bx-sort-up",
            "triliumSortTableRowsAscending"),
        commandItem(t("table_context_menu.sort_descending"), "bx bx-sort-down",
            "triliumSortTableRowsDescending")
    ];
    const selectItems = [
        commandItem(t("table_context_menu.select_row"), "bx bx-grid-horizontal", "selectTableRow"),
        commandItem(t("table_context_menu.select_column"), "bx bx-grid-vertical",
            "selectTableColumn"),
        commandItem(t("table_context_menu.select_table"), "bx bx-table", "triliumSelectTable")
    ];

    return {
        main: [
            commandItem(t("table_context_menu.insert_rows_above"),
                "bx bx-horizontal-left bx-rotate-90", "triliumInsertTableRowsAbove"),
            commandItem(t("table_context_menu.insert_rows_below"),
                "bx bx-horizontal-left bx-rotate-270", "triliumInsertTableRowsBelow"),
            { kind: "separator" },
            commandItem(t("table_context_menu.insert_columns_left"),
                "bx bx-horizontal-left", "triliumInsertTableColumnsLeft"),
            commandItem(t("table_context_menu.insert_columns_right"),
                "bx bx-horizontal-right", "triliumInsertTableColumnsRight"),
            { kind: "separator" },
            ...(headerItem ? [headerItem] : []),
            commandItem(t("table_context_menu.merge_cells"), "bx bx-border-outer",
                "mergeTableCells"),
            submenuItem(
                { title: t("table_context_menu.split_cells"), uiIcon: "bx bx-border-inner" },
                [...splitItems, { kind: "separator" }, unmergeItem]
            ),
            commandItem(t("table_context_menu.distribute_columns"), "bx bx-move-horizontal",
                "triliumDistributeTableColumns")
        ],
        sort: submenuItem(
            { title: t("table_context_menu.sort"), uiIcon: "bx bx-sort-alt-2" },
            sortItems
        ),
        delete: [
            commandItem(t("table_context_menu.delete_rows"), "bx bx-trash", "removeTableRow"),
            commandItem(t("table_context_menu.delete_columns"), "bx bx-trash",
                "removeTableColumn"),
            commandItem(t("table_context_menu.delete_table"), "bx bx-trash", "triliumDeleteTable")
        ],
        select: submenuItem(
            { title: t("table_context_menu.select"), uiIcon: "bx bx-select-multiple" },
            selectItems
        ),
        pasteRows: buildPasteRowsItems(editor, clipboard)
    };
}

/** The part of the menu host's paste support that the paste rows items use. */
export interface ClipboardAccess {
    /** Whether the clipboard has anything to paste. */
    enabled: boolean;
    /** Reads the HTML and plain-text flavors of the clipboard, empty when absent. */
    read(): Promise<{ html: string; text: string }>;
}

/** The table rows of the text editor's right-click menu, in five sections. */
export interface TableMenuSections {
    /**
     * Row and column insertion sized by the selection, the header rows, merging or splitting of
     * the selected cells, and equal widths for the spanned columns. Shown above the clipboard.
     */
    main: MenuItem<CommandNames>[];
    /** Sorting of the rows by the column of the selection. Shown above the deletion rows. */
    sort: MenuItem<CommandNames>;
    /** Deletion of the spanned rows or columns, or of the table. Shown below the clipboard. */
    delete: MenuItem<CommandNames>[];
    /** Selection of the spanned rows or columns, or of the whole table. Shown below deletion. */
    select: MenuItem<CommandNames>;
    /**
     * Pasting the clipboard as new rows, shown in the _Paste_ submenu. Empty unless the selection
     * is in one row and the host can read the clipboard.
     */
    pasteRows: MenuItem<CommandNames>[];
}

/**
 * Whether the active text editor containing `element` holds a multi-cell table selection.
 * A caret or a plain text range inside one cell is not one.
 */
export async function hasTableCellSelection(element: Element | null | undefined): Promise<boolean> {
    if (!element) {
        return false;
    }

    const editor = await getTextEditorContaining(element);
    if (!editor?.plugins.has("TableSelection")) {
        return false;
    }

    return editor.plugins.get("TableSelection").getSelectedTableCells() !== null;
}

/** The paste rows items, for a selection in a single row and a host that reads the clipboard. */
function buildPasteRowsItems(
    editor: CKTextEditor,
    clipboard: ClipboardAccess | undefined
): MenuItem<CommandNames>[] {
    if (!clipboard || editor.commands.get("triliumPasteTableRowsAbove")?.isEnabled !== true) {
        return [];
    }

    const item = (title: string, uiIcon: string, commandName: PasteRowsCommand) => ({
        title,
        uiIcon,
        enabled: clipboard.enabled,
        handler: () => void pasteRows(editor, clipboard, commandName)
    });
    return [
        item(t("table_context_menu.paste_rows_above"), "bx bx-horizontal-left bx-rotate-90",
            "triliumPasteTableRowsAbove"),
        item(t("table_context_menu.paste_rows_below"), "bx bx-horizontal-left bx-rotate-270",
            "triliumPasteTableRowsBelow")
    ];
}

type PasteRowsCommand = "triliumPasteTableRowsAbove" | "triliumPasteTableRowsBelow";

/**
 * Reads the clipboard and pastes it as rows next to the selection the menu was opened on. The
 * selection is pinned before the read, which can wait on a permission prompt.
 */
async function pasteRows(
    editor: CKTextEditor,
    clipboard: ClipboardAccess,
    commandName: PasteRowsCommand
) {
    const target = editor.capturePasteTarget();
    try {
        const { html, text } = await clipboard.read();
        if (target.restore()) {
            editor.execute(commandName, { html, text });
        }
    } catch (error) {
        console.warn("Failed to paste rows from the clipboard:", error);
    } finally {
        target.release();
    }
}
