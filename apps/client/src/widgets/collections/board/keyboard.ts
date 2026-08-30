import { RefObject } from "preact";
import { useCallback, useLayoutEffect, useRef } from "preact/hooks";

import BoardApi from "./api";
import { ColumnMap } from "./data";

/** Plain, these walk the board. */
const NAVIGATION_KEYS = [ "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End" ];

/** With Ctrl, these carry the focused card: a step, a column across, or all the way to an end. */
const ITEM_MOVE_KEYS = [ "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown" ];

/** With Ctrl and Alt, these carry the column focus is in, from wherever inside it focus sits. */
const COLUMN_MOVE_KEYS = [ "ArrowLeft", "ArrowRight", "PageUp", "PageDown" ];

/**
 * A place on the board that can hold focus.
 *
 * Columns and items are named by position rather than by value, since that is what the arrows walk
 * and what the DOM can be asked for; the value is looked up only when something has to be moved.
 */
type Spot =
    | { kind: "header"; column: number }
    | { kind: "item"; column: number; item: number }
    | { kind: "add-item"; column: number }
    | { kind: "add-column" };

/**
 * What to put focus back on once the board has redrawn around a move. A card is named by the note
 * it stands for and everything else by its column, since only a card is drawn anywhere else.
 */
type FocusIntent =
    | { noteId: string }
    | { column: string; part: "header" | "add-item" };

/**
 * What focus belongs to while a move is under way.
 *
 * Held rather than restored once, because a move takes focus away more than once and at times the
 * board cannot foresee. A card crossing columns is drawn afresh under its new one; a card merely
 * reordered keeps its element, but the browser moves that element, and moving a focused one blurs
 * it. Both leave focus on nothing at all, which is the one state worth stepping into.
 *
 * So it is given up not on any sign of having landed, but when the reader has plainly gone
 * elsewhere: another key, or focus resting on something other than the card.
 */
interface PendingFocus {
    intent: FocusIntent;
}

export interface BoardKeyboardOptions {
    containerRef: RefObject<HTMLDivElement>;
    /** The columns as shown, which is what the arrows count and what `moveColumn` is told about. */
    columns: string[];
    byColumn: ColumnMap | undefined;
    api: BoardApi;
    /** Moves a column to sit before the given position, as a drag onto that position would. */
    moveColumn: (fromIndex: number, toIndex: number) => void;
}

/**
 * The board's keyboard: the arrows, Home and End walk it, Ctrl with them carries the focused card,
 * Ctrl and Alt together carry its column, and Space opens the card under the cursor.
 *
 * Alt on its own is left alone throughout, since that is how a reader goes back and forward through
 * notes and a board is no reason for it to stop working.
 *
 * One handler on the board rather than one per element, because every key here is about the board
 * as a whole: where the next thing is, and where what is focused should go. The per-element
 * handlers keep what is theirs (F2 to rename, Enter to open, typing to start a card).
 *
 * Focus follows what is under it rather than where it sits: a card moved to another column is
 * drawn as a new element, and columns are drawn unkeyed, so a header would otherwise be left
 * focused on whichever column took its place.
 */
export function useBoardKeyboard({
    containerRef, columns, byColumn, api, moveColumn
}: BoardKeyboardOptions) {
    const pendingFocus = useRef<PendingFocus | null>(null);

    // Every render, since a redraw is the only thing that takes focus away here and more than one
    // of them follows a move.
    useLayoutEffect(() => {
        const pending = pendingFocus.current;
        const container = containerRef.current;
        if (!pending || !container) return;

        if (!("noteId" in pending.intent)) {
            // The columns are drawn unkeyed, so what was focused is now over whichever column took
            // the old one's place. Focus is pointed at the right one and the hold is done with.
            const element = findInColumn(container, pending.intent.column, pending.intent.part);
            if (element) {
                element.focus();
                pendingFocus.current = null;
            }
            return;
        }

        // Focus is resting somewhere of the reader's choosing, so it is not this move's to take
        // back. Only what a redraw leaves behind is, which is nothing holding focus at all.
        const element = findCard(container, pending.intent.noteId);
        const active = document.activeElement;
        if (active && active !== document.body && active !== element) {
            pendingFocus.current = null;
            return;
        }

        element?.focus();
    });

    return useCallback((e: KeyboardEvent) => {
        const container = containerRef.current;
        const target = e.target as HTMLElement | null;
        if (!container || e.metaKey || e.shiftKey) return;

        // An editor is open on the thing that is focused, and every key belongs to it.
        if (target?.closest("input, textarea")) return;

        // Alt on its own is how a reader goes back and forward through notes, which is expected to
        // work over a board as over anything else.
        if (e.altKey && !e.ctrlKey) return;

        const spot = spotOf(container, document.activeElement);
        if (!spot) return;

        if (e.ctrlKey) {
            // A header holds no card, so the key carries the column it heads. Alt says so from
            // anywhere within a column, for a reader who is standing on one of its cards.
            const carriesColumn = e.altKey || spot.kind === "header";

            // Taken whether or not it leads anywhere: a card already at the end of its column is no
            // reason to let the key mean something else instead.
            if (!(carriesColumn ? COLUMN_MOVE_KEYS : ITEM_MOVE_KEYS).includes(e.key)) return;
            take(e);

            if (carriesColumn) {
                const shifted = shiftColumn(spot, e.key, { columns, byColumn, moveColumn });
                if (shifted) {
                    pendingFocus.current = { intent: shifted };
                }
                return;
            }

            const moved = move(spot, e.key, { columns, byColumn, api });
            if (moved) {
                const pending: PendingFocus = { intent: moved.intent };
                pendingFocus.current = pending;

                // Nothing is going to arrive, so focus is not held for it any longer.
                moved.done.catch(() => {
                    if (pendingFocus.current === pending) {
                        pendingFocus.current = null;
                    }
                });
            }
            return;
        }

        // Every other key says the reader has moved on, so a move still settling stops holding
        // focus: it would otherwise pull it back out of whatever the key opened.
        pendingFocus.current = null;

        if (NAVIGATION_KEYS.includes(e.key)) {
            // The plain arrows would otherwise scroll the page past the end of a column.
            take(e);
            walk(container, spot, e.key);
            return;
        }

        if (e.key === " " && spot.kind === "item") {
            const item = itemAt(columns, byColumn, spot);
            if (item) {
                take(e);
                api.openNote(item.note.noteId);
            }
        }
    }, [ containerRef, columns, byColumn, api, moveColumn ]);
}

/** Keeps a key the board has answered from also reaching whatever else is bound to it. */
function take(e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
}

/** Where the board is focused, or null where the keyboard has nothing to say about it. */
function spotOf(container: HTMLElement, element: Element | null): Spot | null {
    if (!element || !container.contains(element)) return null;
    if (element.closest(".board-add-column")) return { kind: "add-column" };

    const columnElement = element.closest(".board-column");
    if (!columnElement) return null;

    const column = columnsOf(container).indexOf(columnElement as HTMLElement);
    if (element.closest("h3")) return { kind: "header", column };
    if (element.closest(".board-new-item")) return { kind: "add-item", column };

    const card = element.closest(".board-note");
    if (!card) return null;

    return { kind: "item", column, item: cardsOf(columnElement).indexOf(card as HTMLElement) };
}

/**
 * Moves focus, answering with whether the key led anywhere.
 *
 * Up and down walk one column, from its header through its cards to the button under them. Left and
 * right cross to the next column's first card, or to its button where it holds none: its header is
 * reached by pressing up from there, which is the only way a header is reached at all.
 */
function walk(container: HTMLElement, from: Spot, key: string) {
    const next = destination(container, from, key);
    if (!next) return false;

    elementAt(container, next)?.focus();
    return true;
}

function destination(container: HTMLElement, from: Spot, key: string): Spot | null {
    const columnCount = columnsOf(container).length;

    if (key === "ArrowLeft" || key === "ArrowRight") {
        const step = key === "ArrowRight" ? 1 : -1;
        const column = (from.kind === "add-column" ? columnCount : from.column) + step;

        if (column < 0) return null;
        if (column >= columnCount) {
            return from.kind === "add-column" ? null : { kind: "add-column" };
        }
        return entryOf(container, column);
    }

    if (from.kind === "add-column") return null;

    const items = cardsOf(columnsOf(container)[from.column]).length;
    if (key === "Home") return entryOf(container, from.column);
    if (key === "End") {
        return items
            ? { kind: "item", column: from.column, item: items - 1 }
            : entryOf(container, from.column);
    }

    // Down the column: its header, then each card, then the button under them.
    const row = from.kind === "header" ? 0 : from.kind === "item" ? from.item + 1 : items + 1;
    const next = row + (key === "ArrowDown" ? 1 : -1);
    if (next < 0 || next > items + 1) return null;

    if (next === 0) return { kind: "header", column: from.column };
    if (next === items + 1) return { kind: "add-item", column: from.column };
    return { kind: "item", column: from.column, item: next - 1 };
}

/** The first thing a column offers on the way in, which is never its header. */
function entryOf(container: HTMLElement, column: number): Spot {
    return cardsOf(columnsOf(container)[column]).length
        ? { kind: "item", column, item: 0 }
        : { kind: "add-item", column };
}

/**
 * Moves the focused card, answering with what to focus once the board has redrawn, or false where
 * the key led nowhere. A header and the button under a column hold no card, so nothing moves from
 * either: the column itself is moved with Alt held as well.
 */
function move(
    spot: Spot,
    key: string,
    { columns, byColumn, api }: Pick<BoardKeyboardOptions, "columns" | "byColumn" | "api">
): { intent: FocusIntent; done: Promise<unknown> } | false {
    const item = itemAt(columns, byColumn, spot);
    if (!item || spot.kind !== "item") return false;

    const column = columns[spot.column];
    const items = byColumn?.get(column) ?? [];
    const { noteId } = item.note;
    const { branchId } = item.branch;

    if (key === "ArrowLeft" || key === "ArrowRight") {
        const target = columns[spot.column + (key === "ArrowRight" ? 1 : -1)];
        if (!target) return false;

        return { intent: { noteId }, done: api.moveToColumnEnd(noteId, branchId, target) };
    }

    const last = items.length - 1;
    // A card is placed before a position too, so moving one down means passing the one below it.
    const to = key === "ArrowUp" && spot.item > 0 ? spot.item - 1
        : key === "ArrowDown" && spot.item < last ? spot.item + 2
        : key === "PageUp" && spot.item > 0 ? 0
        : key === "PageDown" && spot.item < last ? items.length
        : null;

    if (to === null) return false;

    return {
        intent: { noteId },
        done: api.moveWithinBoard(noteId, branchId, spot.item, to, column, column)
    };
}

/**
 * Moves the column focus is in, answering with what to put focus back on. Whatever was focused
 * stays focused: the columns are drawn unkeyed, so the element would otherwise be left standing
 * over whichever column took the old one's place.
 */
function shiftColumn(
    spot: Spot,
    key: string,
    { columns, byColumn, moveColumn }:
        Pick<BoardKeyboardOptions, "columns" | "byColumn" | "moveColumn">
): FocusIntent | false {
    if (spot.kind === "add-column") return false;

    const last = columns.length - 1;
    // A column is placed before a position, so passing one to the right means passing two.
    const to = key === "ArrowRight" && spot.column < last ? spot.column + 2
        : key === "ArrowLeft" && spot.column > 0 ? spot.column - 1
        : key === "PageDown" && spot.column < last ? columns.length
        : key === "PageUp" && spot.column > 0 ? 0
        : null;

    if (to === null) return false;

    const card = itemAt(columns, byColumn, spot);
    moveColumn(spot.column, to);

    if (card) return { noteId: card.note.noteId };
    return {
        column: columns[spot.column],
        part: spot.kind === "header" ? "header" : "add-item"
    };
}

function itemAt(columns: string[], byColumn: ColumnMap | undefined, spot: Spot) {
    if (spot.kind !== "item") return undefined;
    return byColumn?.get(columns[spot.column])?.[spot.item];
}

function elementAt(container: HTMLElement, spot: Spot): HTMLElement | null {
    if (spot.kind === "add-column") return container.querySelector(".board-add-column");

    const column = columnsOf(container)[spot.column];
    if (!column) return null;

    if (spot.kind === "header") return column.querySelector("h3");
    if (spot.kind === "add-item") return column.querySelector(".board-new-item");
    return cardsOf(column)[spot.item] ?? null;
}

/** Found by what it stands for rather than by where it sits, which a move is about to change. */
function findCard(container: HTMLElement, noteId: string) {
    return container.querySelector<HTMLElement>(`.board-note[data-note-id="${noteId}"]`);
}

function findInColumn(container: HTMLElement, column: string, part: "header" | "add-item") {
    const element = columnsOf(container).find(candidate => candidate.dataset.column === column);
    return element?.querySelector<HTMLElement>(
        part === "header" ? "h3" : ".board-new-item") ?? null;
}

function columnsOf(container: HTMLElement) {
    return [ ...container.querySelectorAll<HTMLElement>(".board-column") ];
}

function cardsOf(column: Element | undefined) {
    return column ? [ ...column.querySelectorAll<HTMLElement>(".board-note") ] : [];
}
