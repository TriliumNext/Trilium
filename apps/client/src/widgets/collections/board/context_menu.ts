import { useState } from "preact/hooks";

import type { CommandNames } from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import contextMenu, { ContextMenuEvent, MenuItem } from "../../../menus/context_menu";
import { getArchiveMenuItems, menuName } from "../../../menus/context_menu_utils";
import NoteColorPicker from "../../../menus/custom-items/NoteColorPicker";
import link_context_menu from "../../../menus/link_context_menu";
import attributes from "../../../services/attributes";
import branches from "../../../services/branches";
import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import { shared } from "../../../services/note_set";
import ColorPicker from "../../react/ColorPicker";
import { buildAttributeMenuItems } from "../attribute_menu";
import { buildSortMenuItems, type SortMenuOptions } from "../sort_menu";
import Api from "./api";
import { INBOX_COLUMN } from "./columns";

/** The column a menu was opened on, and what the menu can ask of it. */
interface ColumnMenuTarget {
    value: string;
    /** Every column, in display order. */
    columns: string[];
    /** This column's index in `columns`. */
    index: number;
    color?: string;
    archived?: boolean;
    /** Whether the column is stored as collapsed. */
    collapsed?: boolean;
    /** Whether the column collapses again once it has been opened. */
    keepCollapsed?: boolean;
    /** Whether the column is currently rendered as a strip, which the menu toggles. */
    isCollapsed?: boolean;
    /** Whether the title can be edited. False for a collapsed column, rendered as a strip. */
    canRename: boolean;
    /** Whether the inbox also collects notes deeper than the board's direct children. */
    nested?: boolean;
    /** Opens the inline title editor, which F2 also opens. */
    onEditTitle: () => void;
    /** Opens the column's new-item editor, the same one its button opens. */
    onNewItem: () => void;
    /** Adds a column beside this one and opens its title editor. */
    onAddColumn: (direction: "before" | "after") => void;
    /** Moves this column before the given index in `columns`. */
    onMoveColumn: (toIndex: number) => void;
    /** Opens the dialog that sets the column's note limit. */
    onSetLimit: () => void;
    /** Collapses or expands the column, which the board redraws at once. */
    onCollapse: (collapsed: boolean) => void;
    /** Sets whether the column collapses again once it has been opened. */
    onKeepCollapsed: (keepCollapsed: boolean) => void;
}

export function openColumnContextMenu(api: Api, event: ContextMenuEvent, column: ColumnMenuTarget) {
    const isInbox = column.value === INBOX_COLUMN;

    event.preventDefault();
    event.stopPropagation();

    // What the column is, which a collapsed column that is not the inbox has nothing of. Kept in
    // a group of its own only while it holds something, or the menu opens on a divider.
    const identity: MenuItem<string>[] = [
        ...(column.canRename ? [ {
            title: t("board_view.rename-column"),
            uiIcon: "bx bx-edit-alt",
            shortcut: "F2",
            handler: column.onEditTitle
        } ] : []),
        ...(isInbox ? [ {
            title: t("board_view.inbox-nested"),
            uiIcon: "bx bx-subdirectory-right",
            checked: !!column.nested,
            handler: () => api.setInboxNested(!column.nested)
        } ] : [])
    ];

    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [
            ...identity,
            ...(identity.length ? [ { kind: "separator" } as MenuItem<string> ] : []),
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
            // Already a strip, so there is nothing to collapse.
            ...(column.isCollapsed ? [] : [ {
                title: t("board_view.collapse-column"),
                uiIcon: "bx bx-collapse-horizontal",
                handler: () => column.onCollapse(true)
            } ]),
            {
                title: t("board_view.keep-column-collapsed"),
                uiIcon: "bx bx-lock-alt",
                // At the trailing edge, so the entry keeps its own icon in front.
                trailingIcon: column.keepCollapsed ? "bx bx-check" : undefined,
                handler: () => column.onKeepCollapsed(!column.keepCollapsed)
            },
            {
                title: t("board_view.sort"),
                uiIcon: "bx bx-sort-alt-2",
                items: buildSortMenuItems<string>(sortMenuOptions(api, column.value))
            },
            {
                title: t("board_view.set-limit"),
                uiIcon: "bx bx-tachometer",
                handler: column.onSetLimit
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

/** How many columns a card's menu lists before the rest move into a submenu. */
const LISTED_COLUMNS = 7;

/** The board a menu was opened on, and what the menu can ask of it. */
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

/**
 * The sort menu on its own, for the button a sorted column shows in its heading.
 *
 * Opened leftwards, since the button sits at the trailing edge of a column that can stand against
 * the window edge.
 */
export function openColumnSortMenu(api: Api, x: number, y: number, column: string) {
    contextMenu.show({
        x,
        y,
        orientation: "left",
        items: buildSortMenuItems<string>(sortMenuOptions(api, column)),
        selectMenuItemHandler() {}
    });
}

/** What the board asks the shared sort menu for, wherever it is opened. */
function sortMenuOptions(api: Api, column: string): SortMenuOptions {
    return {
        orderBy: api.getColumnSort(column).orderBy,
        // The direction the column is drawn in, which the board decides for a column taking its
        // order.
        isDescending: api.getEffectiveColumnSort(column).isDescending,
        attributes: api.getPromotedAttributes(),
        // A board arranges its cards by hand rather than leaving them unsorted.
        noneTitle: t("board_view.sort-manually"),
        defaultTitle: t("board_view.sort-board-default"),
        onSelect: (orderBy) => api.setColumnSort(column, orderBy),
        onDirectionChange: (isDescending) => api.setColumnSortDirection(column, isDescending)
    };
}

/** Offers both ends of a column for the card its button is about to create. */
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
 * Offers both ends of the board for the column its button is about to create.
 *
 * Opened leftwards: the button sits at the end of the board, against the window edge, where a menu
 * placed at the pointer would be pushed back over the button itself.
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
 * Where a column can be moved, each entry named by the column it would follow.
 *
 * An entry is left out when moving there changes nothing: the column itself, the one it already
 * follows, and the head of the board for a column already first.
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
            // `t()` escapes what it interpolates, so the sentence it builds is boxed as it stands.
            title: `<span class="tn-menu-name">`
                + `${t("board_view.move-column-after", { column: title })}</span>`,
            uiIcon: api.getColumnIcon(name),
            iconColorClass: api.getColumnColorClass(name),
            badges: api.isColumnArchived(name)
                ? [ { title: t("board_view.archived-badge") } ]
                : undefined,
            // A column is placed before an index, so following `name` means the index after it.
            handler: () => column.onMoveColumn(index + 1)
        } ];
    });

    return [ ...head, ...after ];
}

/**
 * The colour a column is tinted with, picked as a note's colour is.
 *
 * Keeps the picked value rather than re-reading it from the board: the menu renders once, and a
 * redraw underneath never reaches it. Carries `note-color-picker`, which the menu styles the row
 * by.
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

/** What a card's menu acts on: the card it was opened from, and the notes it writes to. */
export interface NoteMenuTarget {
    /** The card the menu was opened on. */
    note: FNote;
    branchId: string;
    column: string;
    /** This card's index in its column, which an insert is placed against. */
    index: number;
    /**
     * Every note the menu writes to: this card alone, or the whole selection it belongs to. Always
     * holds the card the menu was opened on.
     */
    notes: FNote[];
    /** The branches those notes have on this board, in the order `notes` lists them. */
    branchIds: string[];
    /** Refocuses the card after a column change has redrawn it elsewhere. */
    onFocusCard: (noteId: string) => void;
    /** Opens the new-card editor at an index in the column, above or below this card. */
    onInsert: (index: number) => void;
    /** Opens the editor at the foot of the column, which a sorted column offers instead. */
    onNewItem: () => void;
}

/**
 * The columns the cards can be moved to, listed in the menu rather than in a submenu, which would
 * put every column a step further away. Past `LISTED_COLUMNS`, the rest move into one submenu
 * entry, and the column the cards are in is always listed.
 *
 * An archived column is offered like any other, with a badge, since the cards then leave the
 * board's default view.
 */
function buildColumnItems(api: Api, target: NoteMenuTarget): MenuItem<CommandNames>[] {
    // Marked only while every card stands in the same column: one check on a selection spanning
    // several would name one column as the state of all of them.
    const standing = shared(target.notes, (note) => api.getCardColumn(note.noteId));
    const current = standing.agreed ? standing.value : undefined;

    const items: MenuItem<CommandNames>[] = api.columns.map((name) => ({
        title: menuName(api.getColumnTitle(name)),
        uiIcon: api.getColumnIcon(name),
        iconColorClass: api.getColumnColorClass(name),
        // The one they are already under is shown rather than hidden, so the list reads as the
        // whole set of columns and says which of them the cards belong to.
        trailingIcon: name === current ? "bx bx-check" : undefined,
        className: name === current ? "board-current-column" : undefined,
        badges: api.isColumnArchived(name)
            ? [ { title: t("board_view.archived-badge") } ]
            : undefined,
        handler: () => {
            // Asked for before the write: the cards are drawn afresh under the column they land
            // in, so the element the menu was opened from will be gone.
            target.onFocusCard(target.note.noteId);
            return Promise.all(
                target.notes.map((note) => api.changeColumn(note.noteId, name)));
        }
    }));

    if (items.length <= LISTED_COLUMNS) {
        return items;
    }

    const listed = items.slice(0, LISTED_COLUMNS);
    const rest = items.slice(LISTED_COLUMNS);

    // The cards' own column is listed even where it falls outside: the check beside it is what
    // says which column they are in, and behind an entry it says nothing.
    const at = current === undefined ? -1 : api.columns.indexOf(current);
    if (at >= LISTED_COLUMNS) {
        listed.push(...rest.splice(at - LISTED_COLUMNS, 1));
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

export function openNoteContextMenu(api: Api, event: ContextMenuEvent, target: NoteMenuTarget) {
    const { note, branchId, column, index, notes, branchIds } = target;

    event.preventDefault();
    event.stopPropagation();

    // A sorted column decides where its cards go, so the entries naming a place are left out.
    const isSorted = api.isColumnSorted(column);
    // What only makes sense for one card: a place to insert at, a title to edit, a note to open.
    // Everything below writes to every selected note instead.
    const isSingle = notes.length === 1;

    // What the card is placed beside, and the copy made below it.
    const placement: MenuItem<CommandNames>[] = !isSingle ? [] : [
        // A sorted column takes its new cards at the foot, where its own button makes them.
        ...(isSorted ? [ {
            title: t("board_view.insert-new"),
            uiIcon: "bx bx-plus",
            handler: target.onNewItem
        } ] : [
            {
                title: t("board_view.insert-above"),
                uiIcon: "bx bx-list-plus",
                shortcut: "Shift+Enter",
                handler: () => target.onInsert(index)
            },
            {
                title: t("board_view.insert-below"),
                uiIcon: "bx bx-empty",
                shortcut: "Enter",
                handler: () => target.onInsert(index + 1)
            }
        ]),
        {
            title: t("board_view.duplicate-item"),
            uiIcon: "bx bx-outline",
            handler: () => api.duplicateItem(note.noteId, branchId)
        },
        // Left out for the card already at the head, which has nowhere to go.
        ...(isSorted || api.isFirstInColumn(branchId, column) ? [] : [ {
            title: t("board_view.move-to-top"),
            uiIcon: "bx bx-vertical-top",
            shortcut: "Ctrl+Home",
            handler: () => {
                // Asked for before the write: the card is blurred as it is moved in the page, and
                // the reveal that follows the focus is what shows where it went.
                target.onFocusCard(note.noteId);
                api.moveToColumnStart(note.noteId, branchId, column);
            }
        } ])
    ];

    // What is done to the card itself, which a selection has none of: the menu it opens leads with
    // the columns instead.
    const identity: MenuItem<CommandNames>[] = !isSingle ? [] : [
        // Space opens the same popup for the card the cursor stands on.
        { ...link_context_menu.getQuickEditItem(), shortcut: "Space" },
        {
            title: t("board_view.edit-title"),
            uiIcon: "bx bx-rename",
            shortcut: "F2",
            handler: () => api.startEditing(branchId)
        },
        link_context_menu.getOpenNoteItem(event),
        { kind: "separator" }
    ];

    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [
            ...identity,
            ...placement,
            { kind: "header", title: api.getStatusLabel() },
            ...buildColumnItems(api, target),
            ...buildAttributeMenuItems<CommandNames>({
                notes,
                attributes: api.getPromotedAttributes()
            }),
            { kind: "separator" },
            ...getArchiveMenuItems<CommandNames>(notes),
            // The inbox holds the cards with no grouping value, so clearing that value keeps a
            // card on the board. Deleting the note is what takes it off.
            ...(api.isInboxEnabled ? [] : [ {
                title: t("board_view.remove-from-board"),
                uiIcon: "bx bx-task-x",
                shortcut: "Delete",
                handler: () => api.removeFromBoard(notes.map((selected) => selected.noteId))
            } ]),
            {
                title: t("board_view.delete-note"),
                uiIcon: "bx bx-trash",
                shortcut: "Shift+Delete",
                handler: () => branches.deleteNotes(branchIds, false, false)
            },
            { kind: "separator" },
            {
                kind: "custom",
                componentFn: () => isSingle
                    ? NoteColorPicker({ note })
                    : CardsColorPicker({ notes })
            }
        ],
        selectMenuItemHandler: ({ command }) =>  link_context_menu.handleLinkContextMenuItem(command, event, note.noteId),
    });
}

/**
 * The colour of several cards at once, shown as their colour only while they agree on one.
 *
 * `NoteColorPicker` reads and writes one note, so a selection is painted through the plain picker,
 * as a column's colour is. Keeps the picked value rather than re-reading it: the menu renders once,
 * and a redraw underneath never reaches it.
 */
function CardsColorPicker({ notes }: { notes: FNote[] }) {
    const agreed = shared(notes, (note) => note.getLabelValue("color") ?? null);
    const [ currentColor, setCurrentColor ] = useState(agreed.agreed ? agreed.value : null);

    return ColorPicker({
        className: "note-color-picker",
        currentValue: currentColor,
        onChange: async (picked) => {
            setCurrentColor(picked);
            await Promise.all(notes.map((note) => picked !== null
                ? attributes.setLabel(note.noteId, "color", picked)
                : attributes.removeOwnedLabelByName(note, "color")));
        },
        tooltips: {
            clear: t("note-color.clear-color"),
            set: t("note-color.set-color"),
            setCustom: t("note-color.set-custom-color")
        }
    });
}
