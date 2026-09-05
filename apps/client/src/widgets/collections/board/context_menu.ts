import { useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import NoteColorPicker from "../../../menus/custom-items/NoteColorPicker";
import type { CommandNames } from "../../../components/app_context";
import contextMenu, { ContextMenuEvent, MenuItem } from "../../../menus/context_menu";
import link_context_menu from "../../../menus/link_context_menu";
import branches from "../../../services/branches";
import dialog from "../../../services/dialog";
import { getArchiveMenuItem } from "../../../menus/context_menu_utils";
import { t } from "../../../services/i18n";
import { escapeHtml } from "../../../services/utils";
import ColorPicker from "../../react/ColorPicker";
import Api from "./api";
import { INBOX_COLUMN } from "./columns";

/** What the column menu is opened for: the column itself, and what it can be asked to do. */
interface ColumnMenuTarget {
    value: string;
    /** The columns as drawn, in the order they stand. */
    columns: string[];
    /** Where this column stands among them. */
    index: number;
    color?: string;
    archived?: boolean;
    /** Whether the column is stored as collapsed. */
    collapsed?: boolean;
    /** Whether the column collapses again once it has been opened. */
    keepCollapsed?: boolean;
    /** Whether the column is drawn as a strip right now, which is what the menu offers to do. */
    isCollapsed?: boolean;
    /** Whether the title can be edited, which the strip a collapsed column is drawn as cannot. */
    canRename: boolean;
    /** Whether the inbox also collects notes deeper than the board's direct children. */
    nested?: boolean;
    /** Puts the title into its inline editor, the menu being the only way there besides F2. */
    onEditTitle: () => void;
    /** Opens the column's own new-item editor, the same one its button opens. */
    onNewItem: () => void;
    /** Puts a new column on one side of this one and opens its title editor. */
    onAddColumn: (direction: "before" | "after") => void;
    /** Moves this column to sit before the given position among the columns as drawn. */
    onMoveColumn: (toIndex: number) => void;
    /** Opens the dialog that sets the column's note limit. */
    onSetLimit: () => void;
    /** Collapses the column, the board drawing the change straight away. */
    onCollapse: (collapsed: boolean) => void;
    /** Sets whether the column collapses again once it has been opened. */
    onKeepCollapsed: (keepCollapsed: boolean) => void;
}

export function openColumnContextMenu(api: Api, event: ContextMenuEvent, column: ColumnMenuTarget) {
    const isInbox = column.value === INBOX_COLUMN;

    event.preventDefault();
    event.stopPropagation();

    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [
            ...(column.canRename ? [ {
                title: t("board_view.rename-column"),
                uiIcon: "bx bx-edit-alt",
                shortcut: "F2",
                handler: column.onEditTitle
            } ] : []),
            // Nothing to collapse while the column is already drawn as a strip.
            ...(column.isCollapsed ? [] : [ {
                title: t("board_view.collapse-column"),
                uiIcon: "bx bx-collapse-horizontal",
                handler: () => column.onCollapse(true)
            } ]),
            {
                title: t("board_view.keep-column-collapsed"),
                uiIcon: "bx bx-lock-alt",
                // At the trailing edge, the entry keeping its own icon ahead of it.
                trailingIcon: column.keepCollapsed ? "bx bx-check" : undefined,
                handler: () => column.onKeepCollapsed(!column.keepCollapsed)
            },
            {
                title: t("board_view.set-limit"),
                uiIcon: "bx bx-tachometer",
                handler: column.onSetLimit
            },
            ...(isInbox ? [ {
                title: t("board_view.inbox-nested"),
                uiIcon: "bx bx-subdirectory-right",
                checked: !!column.nested,
                handler: () => api.setInboxNested(!column.nested)
            } ] : []),
            { kind: "separator" },
            {
                title: t("board_view.add-new-item"),
                uiIcon: "bx bx-plus",
                handler: column.onNewItem
            },
            {
                title: t("board_view.add-existing-item"),
                uiIcon: "bx bx-link",
                async handler() {
                    const noteId = await dialog.chooseNote({
                        title: t("board_view.add-existing-item-title"),
                        okLabel: t("board_view.add-existing-item-ok")
                    });
                    if (noteId) {
                        await api.addExistingItem(column.value, noteId);
                    }
                }
            },
            {
                title: t("board_view.add-new-column"),
                uiIcon: "bx bx-columns",
                items: [
                    {
                        title: t("board_view.add-column-before"),
                        shortcut: "Ctrl+Shift+Enter",
                        handler: () => column.onAddColumn("before")
                    },
                    {
                        title: t("board_view.add-column-after"),
                        shortcut: "Ctrl+Enter",
                        handler: () => column.onAddColumn("after")
                    }
                ]
            },
            { kind: "separator" },
            {
                title: t("board_view.move-column"),
                uiIcon: "bx bx-horizontal-left",
                items: buildMoveColumnItems(api, column)
            },
            { kind: "separator" },
            ...(isInbox ? [] : [ column.archived
                ? {
                    title: t("board_view.unarchive-column"),
                    uiIcon: "bx bx-archive-out",
                    handler: () => api.setColumnArchived(column.value, false)
                }
                : {
                    title: t("board_view.archive-column"),
                    uiIcon: "bx bx-archive",
                    handler: () => api.setColumnArchived(column.value, true)
                } ]),
            isInbox
                ? {
                    title: t("board_view.inbox-remove"),
                    uiIcon: "bx bx-trash",
                    shortcut: "Delete",
                    handler: () => api.disableInbox()
                }
                : {
                    title: t("board_view.delete-column"),
                    uiIcon: "bx bx-trash",
                    shortcut: "Delete",
                    handler: () => api.confirmAndRemoveColumn(column.value)
                },
            { kind: "separator" },
            {
                kind: "custom",
                componentFn: () => ColumnColorPicker({ api, ...column })
            }
        ],
        selectMenuItemHandler() {}
    });
}

/** How many columns a card's menu lists before the rest go behind an entry of their own. */
const LISTED_COLUMNS = 7;

/** What the board is, and what it can be asked to do, for a press on the ground its columns stand on. */
interface BoardMenuTarget {
    /** Whether the board renders notes labelled `archived`. */
    archivedShown: boolean;
    /** Opens the column name editor, the same one the button at the end opens. */
    onAddColumn: () => void;
    onCollapseAll: () => void;
    onExpandAll: () => void;
    onShowArchived: (shown: boolean) => void;
    /** Opens `BoardProperties`, which configures the card templates. */
    onOpenProperties: () => void;
}

/** The board's own menu, opened by a right click outside any column. */
export function openBoardContextMenu(event: ContextMenuEvent, board: BoardMenuTarget) {
    event.preventDefault();
    event.stopPropagation();

    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [
            {
                title: t("board_view.add-new-column"),
                uiIcon: "bx bx-columns",
                handler: board.onAddColumn
            },
            { kind: "separator" },
            {
                title: t("board_view.collapse-all-columns"),
                uiIcon: "bx bx-collapse-alt",
                handler: board.onCollapseAll
            },
            {
                title: t("board_view.expand-all-columns"),
                uiIcon: "bx bx-expand-alt",
                handler: board.onExpandAll
            },
            { kind: "separator" },
            {
                title: t("board_view.show-archived-notes"),
                uiIcon: "bx bx-archive",
                trailingIcon: board.archivedShown ? "bx bx-check" : undefined,
                handler: () => board.onShowArchived(!board.archivedShown)
            },
            { kind: "separator" },
            {
                title: t("board_view.properties"),
                uiIcon: "bx bx-cog",
                handler: board.onOpenProperties
            }
        ],
        selectMenuItemHandler() {}
    });
}

/** Offers both ends of a column for the card the button below it is about to create. */
export function openCreateCardMenu(x: number, y: number, create: (atStart: boolean) => void) {
    contextMenu.show({
        x,
        y,
        items: [
            {
                title: t("board_view.create-at-top"),
                uiIcon: "bx bx-vertical-top",
                shortcut: "Shift+Enter",
                handler: () => create(true)
            },
            {
                title: t("board_view.create-at-bottom"),
                uiIcon: "bx bx-vertical-bottom",
                shortcut: "Enter",
                handler: () => create(false)
            }
        ],
        selectMenuItemHandler() {}
    });
}

/**
 * Offers both ends of the board for the column the button beside the field is about to create.
 *
 * Opened leftwards: the button stands at the end of the board, hard against the window's edge,
 * where a menu drawn from the pointer would be pushed back over the button it came from.
 */
export function openCreateColumnMenu(x: number, y: number, create: (atStart: boolean) => void) {
    contextMenu.show({
        x,
        y,
        orientation: "left",
        items: [
            {
                title: t("board_view.create-column-at-start"),
                uiIcon: "bx bx-horizontal-left",
                shortcut: "Shift+Enter",
                handler: () => create(true)
            },
            {
                title: t("board_view.create-column-at-end"),
                uiIcon: "bx bx-horizontal-right",
                shortcut: "Enter",
                handler: () => create(false)
            }
        ],
        selectMenuItemHandler() {}
    });
}

/**
 * Where a column can be sent, each place named by what the column would come to stand after.
 *
 * A place is left out where sending it there would leave the board as it stands: the column itself,
 * the one it already follows, and the head of the board for a column already at the head.
 */
function buildMoveColumnItems(api: Api, column: ColumnMenuTarget): MenuItem<string>[] {
    const head: MenuItem<string>[] = column.index > 0
        ? [ {
            title: t("board_view.move-column-first"),
            uiIcon: "bx bx-chevrons-left",
            handler: () => column.onMoveColumn(0)
        } ]
        : [];

    const after = column.columns.flatMap<MenuItem<string>>((name, index) => {
        if (index === column.index || index === column.index - 1) {
            return [];
        }

        const title = api.getColumnTitle(name);

        return [ {
            // Boxed the way the status list boxes its names, so a long one is cut rather than
            // widening the menu. What `t()` interpolates it has already escaped.
            title: `<span class="board-column-name">`
                + `${t("board_view.move-column-after", { column: title })}</span>`,
            className: "board-column-item",
            uiIcon: api.getColumnIcon(name),
            iconColorClass: api.getColumnColorClass(name),
            badges: api.isColumnArchived(name)
                ? [ { title: t("board_view.archived-badge") } ]
                : undefined,
            // A column is placed before a position, so standing after `name` means the one past it.
            handler: () => column.onMoveColumn(index + 1)
        } ];
    });

    return [ ...head, ...after ];
}

/**
 * The colour a column is tinted with, picked the way a note's is.
 *
 * It holds the pick rather than reading it back from the board, since the menu is rendered once and
 * the board redrawing underneath does not reach it. `note-color-picker` is what the menu styles the
 * row through, so the class is worn here too.
 */
function ColumnColorPicker({ api, value, color }: { api: Api, value: string, color?: string }) {
    const [ currentColor, setCurrentColor ] = useState(color ?? null);

    return ColorPicker({
        className: "note-color-picker",
        currentValue: currentColor,
        onChange: (picked) => {
            setCurrentColor(picked);
            api.setColumnColor(value, picked);
        }
    });
}

/**
 * The columns a card can be filed under, standing in the menu itself rather than behind a submenu:
 * moving a card is what a board is for, and a submenu puts every column a step further away.
 * Past `LISTED_COLUMNS` of them the menu would run off the screen, so what does not fit goes behind
 * one entry, and the column the card is in is listed whether or not it is among the first.
 *
 * Archived columns are offered like any other, since filing a card under one is a fair thing to
 * want; the badge is there so it is not a surprise when the card goes out of sight.
 */
function buildColumnItems(
    api: Api, note: FNote, column: string, onFocusCard: (noteId: string) => void
): MenuItem<CommandNames>[] {
    const items: MenuItem<CommandNames>[] = api.columns.map((name) => ({
        // The menu reads a title as markup, which is what puts the name in a box of its own: a
        // bare run of text inside the item's flex row is an anonymous box, and nothing can be said
        // about its width. What a crafted name would plant there is escaped into the text it is
        // meant to be; every other title the board builds from a name goes through `t()`, which
        // escapes what it interpolates.
        title: `<span class="board-column-name">${escapeHtml(api.getColumnTitle(name))}</span>`,
        uiIcon: api.getColumnIcon(name),
        iconColorClass: api.getColumnColorClass(name),
        // The one it is already under is shown rather than hidden, so the list reads as the whole
        // set of columns and says which of them this card belongs to.
        trailingIcon: name === column ? "bx bx-check" : undefined,
        className: name === column ? "board-column-item board-current-column" : "board-column-item",
        badges: api.isColumnArchived(name)
            ? [ { title: t("board_view.archived-badge") } ]
            : undefined,
        handler: () => {
            // Asked for before the write: the card is drawn afresh under the column
            // it lands in, so the element the menu was opened from will be gone.
            onFocusCard(note.noteId);
            api.changeColumn(note.noteId, name);
        }
    }));

    if (items.length <= LISTED_COLUMNS) {
        return items;
    }

    const listed = items.slice(0, LISTED_COLUMNS);
    const rest = items.slice(LISTED_COLUMNS);

    // The card's own column is listed even where it falls outside: the check beside it is what
    // says which column the card is in, and behind an entry it says nothing.
    const current = api.columns.indexOf(column);
    if (current >= LISTED_COLUMNS) {
        listed.push(...rest.splice(current - LISTED_COLUMNS, 1));
    }

    return [
        ...listed,
        {
            title: t("board_view.more-columns"),
            uiIcon: "bx bx-dots-horizontal-rounded",
            items: rest
        }
    ];
}

export function openNoteContextMenu(
    api: Api, event: ContextMenuEvent, note: FNote, branchId: string, column: string,
    /** Where this card stands among its column's cards, which is what an insert is placed by. */
    index: number,
    /** Puts focus back on the card once a change of column has drawn it under another one. */
    onFocusCard: (noteId: string) => void,
    /** Opens the field a new card is named in at a place in the column, above or below this one. */
    onInsert: (index: number) => void
) {
    event.preventDefault();
    event.stopPropagation();

    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [
            ...link_context_menu.getItems(event),
            {
                title: t("board_view.edit-title"),
                uiIcon: "bx bx-rename",
                shortcut: "F2",
                handler: () => api.startEditing(branchId)
            },
            { kind: "separator" },
            {
                title: t("board_view.insert-above"),
                uiIcon: "bx bx-list-plus",
                shortcut: "Shift+Enter",
                handler: () => onInsert(index)
            },
            {
                title: t("board_view.insert-below"),
                uiIcon: "bx bx-empty",
                shortcut: "Enter",
                handler: () => onInsert(index + 1)
            },
            // Left out for the card already at the head, which has nowhere to go.
            ...(api.isFirstInColumn(branchId, column) ? [] : [ {
                title: t("board_view.move-to-top"),
                uiIcon: "bx bx-vertical-top",
                shortcut: "Ctrl+Home",
                handler: () => {
                    // Asked for before the write: the card is blurred as it is moved in the page,
                    // and the reveal that follows the focus is what shows where it went.
                    onFocusCard(note.noteId);
                    api.moveToColumnStart(note.noteId, branchId, column);
                }
            } ]),
            { kind: "header", title: api.getStatusLabel() },
            ...buildColumnItems(api, note, column, onFocusCard),
            { kind: "separator" },
            {
                title: t("board_view.duplicate-item"),
                uiIcon: "bx bx-outline",
                handler: () => api.duplicateItem(note.noteId, branchId)
            },
            { kind: "separator" },
            getArchiveMenuItem(note),
            {
                title: t("board_view.remove-from-board"),
                uiIcon: "bx bx-task-x",
                shortcut: "Delete",
                handler: () => api.removeFromBoard(note.noteId)
            },
            {
                title: t("board_view.delete-note"),
                uiIcon: "bx bx-trash",
                shortcut: "Shift+Delete",
                handler: () => branches.deleteNotes([ branchId ], false, false)
            },
            { kind: "separator" },
            {
                kind: "custom",
                componentFn: () => NoteColorPicker({note})
            }
        ],
        selectMenuItemHandler: ({ command }) =>  link_context_menu.handleLinkContextMenuItem(command, event, note.noteId),
    });
}

