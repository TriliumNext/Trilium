import { askForCard } from "./windowing";
import { cardFollows } from "./columns";
import { RefObject } from "preact";
import { useCallback, useLayoutEffect, useRef } from "preact/hooks";

import branches from "../../../services/branches";
import { FLIP_SETTLE_MS } from "../../react/flip";
import { SelectionStore } from "../../react/selection";
import BoardApi from "./api";
import { ColumnItem, ColumnMap } from "./data";

/** Sideways, and with Ctrl, these carry the focused card the whole way rather than one column. */
const CARD_END_KEYS = [ "ArrowLeft", "ArrowRight" ];

/** Plain, these walk the board. */
const NAVIGATION_KEYS = [ "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End" ];

/** With Ctrl, these carry the focused card: a step, a column across, or to an end of its own. */
const ITEM_MOVE_KEYS = [ "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End" ];

/** With Ctrl and Alt, these carry the column focus is in, from wherever inside it focus sits. */
const COLUMN_MOVE_KEYS = [ "ArrowLeft", "ArrowRight", "Home", "End" ];

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
    /** Puts a new column beside the given one and opens its title editor, as the menu does. */
    insertColumn: (relativeTo: string, direction: "before" | "after") => void;
    /**
     * Names the column being worked in, which opens it while it is collapsed. A card carried into
     * a collapsed column has to say so here: the column draws no cards, so there would be nothing
     * for the focus to land on.
     */
    setActiveColumn: (column: string) => void;
    /** Which cards are picked out, which Ctrl+A fills with the focused column. */
    selection: SelectionStore;
    /**
     * Sends cards to the end of another column, drawing them there while the writes are made. The
     * board draws the outcome itself, so a move's two writes are not two redraws.
     */
    sendCardsToColumn: (
        cards: { noteId: string, branchId: string }[], targetColumn: string
    ) => Promise<unknown>;
    /** As {@link sendCardsToColumn}, for a move to a place among the cards already in a column. */
    moveCardsWithin: (
        cards: { noteId: string, branchId: string }[], column: string, index: number
    ) => Promise<unknown>;
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
 * handlers keep what is theirs (F2 to rename, Enter to add a card, typing to start one).
 *
 * Focus follows what is under it rather than where it sits: a card moved to another column is
 * drawn as a new element, and a column moved in the page is blurred by the browser, so a header
 * would otherwise be left focused on nothing.
 */
export function useBoardKeyboard({
    containerRef, columns, byColumn, api, moveColumn, insertColumn, setActiveColumn, selection,
    sendCardsToColumn, moveCardsWithin
}: BoardKeyboardOptions) {
    const pendingFocus = useRef<PendingFocus | null>(null);
    /** The card `askForCard` has already run for, so it does not run again on every render. */
    const asked = useRef<string | null>(null);
    /** The last spot walked to, for a key pressed while focus is between two renders. */
    const lastSpot = useRef<Spot | null>(null);

    // Every render, since a redraw is the only thing that takes focus away here and more than one
    // of them follows a move.
    useLayoutEffect(() => {
        const pending = pendingFocus.current;
        const container = containerRef.current;
        if (!pending || !container) return;

        if (!("noteId" in pending.intent)) {
            // Moving a focused element blurs it, so the header is focused again by name once the
            // board has drawn it in its new place, and the hold is done with.
            const element = findInColumn(container, pending.intent.column, pending.intent.part);
            if (element) {
                reveal(element);
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

        if (element) {
            reveal(element);
            return;
        }

        // The card has landed in a windowed column that is not drawing it, so there is nothing to
        // focus yet. `askForCard` scrolls that column, which draws the card.
        //
        // Waited for here rather than left to this effect running again: the scroll re-renders the
        // column alone, and the board this effect belongs to is not drawn again by it.
        const { noteId } = pending.intent;
        if (asked.current === noteId) return;

        const place = placeOf(byColumn, noteId);
        if (!place) return;

        asked.current = noteId;
        askForCard(container, place.column, place.index);
        waitForCard(container, noteId, (card) => {
            asked.current = null;
            if (pendingFocus.current === pending && document.activeElement === document.body) {
                reveal(card);
            }
        });
    });

    /**
     * Puts focus on a column's heading once the board has drawn it again, for a move made from
     * somewhere other than the keyboard. The browser blurs an element it moves, so an element
     * held onto across the move would be left focused on nothing.
     */
    const focusColumn = useCallback((column: string) => {
        pendingFocus.current = { intent: { column, part: "header" } };
    }, []);

    /**
     * Puts focus back on a card once the board has drawn it again, for a move made from somewhere
     * other than the keyboard. A card crossing columns is drawn afresh under the new one, so the
     * element it was is gone by the time the move lands.
     */
    const focusCard = useCallback((noteId: string) => {
        pendingFocus.current = { intent: { noteId } };
    }, []);

    const onKeyDown = useCallback((e: KeyboardEvent) => {
        const container = containerRef.current;
        const target = e.target as HTMLElement | null;
        if (!container || e.metaKey) return;

        // Shift is left to whatever else answers for it, bar the keys where it names the other
        // direction, the harder form, or the further reach of something the board already does.
        if (e.shiftKey && !shiftIsOurs(e)) return;

        // An editor is open on the thing that is focused, and every key belongs to it.
        if (target?.closest("input, textarea")) return;

        // Alt on its own is how a reader goes back and forward through notes, which is expected to
        // work over a board as over anything else.
        if (e.altKey && !e.ctrlKey) return;

        const spot = spotOf(container, document.activeElement)
            // Focus can be left on nothing by a redraw that took the card it was on out of the
            // page. Fall back to the previous spot rather than letting the key through, which
            // would scroll the board instead of moving along it.
            ?? (NAVIGATION_KEYS.includes(e.key) ? lastSpot.current : null);
        if (!spot) return;

        if (e.ctrlKey) {
            // Every card of the column focus is in, wherever inside it focus sits. The button that
            // adds a column stands in none, and Ctrl+A there is the page's own.
            if (e.key === "a" && !e.altKey && !e.shiftKey && spot.kind !== "add-column") {
                take(e);
                selection.selectAll(api.getColumnNoteIds(columns[spot.column]));
                return;
            }

            // A column beside the one focus is in, wherever inside it focus sits. The button that
            // adds a column stands beside none, and is the plain way to add one at the end anyway.
            if (e.key === "Enter" && !e.altKey && spot.kind !== "add-column") {
                take(e);
                insertColumn(columns[spot.column], e.shiftKey ? "before" : "after");
                return;
            }

            // A header holds no card, so the key carries the column it heads. Alt says so from
            // anywhere within a column, for a reader who is standing on one of its cards.
            const carriesColumn = e.altKey || spot.kind === "header";

            // Shift says how far a card goes, and a column has no such reach of its own.
            if (e.shiftKey && carriesColumn) return;

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

            const moved = move(
                spot,
                e.key,
                {
                    columns, byColumn, api, setActiveColumn, selection, sendCardsToColumn,
                    moveCardsWithin
                },
                e.shiftKey);
            if (moved) {
                const pending: PendingFocus = { intent: moved.intent };
                pendingFocus.current = pending;

                // Taken now rather than left to the redraw, which gives the intent up when focus
                // rests anywhere but where it names: a set of cards is sent from one of its own
                // members, and the card it names is another of them. Scrolling is left to
                // `reveal`, which waits for the card to stop moving.
                if ("noteId" in moved.intent) {
                    findCard(container, moved.intent.noteId)?.focus({ preventScroll: true });
                }

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
            lastSpot.current = walk(container, spot, e.key) ?? spot;
            return;
        }

        // Both keys, the collapsed header answering for a button and being announced as one.
        if ((e.key === " " || e.key === "Enter") && spot.kind === "header") {
            const column = columns[spot.column];
            if (!columnsOf(container)[spot.column]?.classList.contains("collapsed")) return;

            take(e);
            setActiveColumn(column);

            // Opening the strip by hand opens the column for good, as a click on it does.
            if (!api.isColumnKeptCollapsed(column)) {
                api.setColumnCollapsed(column, false);
            }

            // The cards are drawn only once the column opens, so the first of them is asked for
            // rather than focused here; the effect above puts focus on it as it appears. The
            // header gives focus up for that, the effect leaving alone anything the reader is
            // resting on. A column with no cards keeps it, there being nothing to step onto.
            const first = byColumn?.get(column)?.[0];
            if (first) {
                pendingFocus.current = { intent: { noteId: first.note.noteId } };
                (document.activeElement as HTMLElement | null)?.blur();
            }
            return;
        }

        if (e.key === " " && spot.kind === "item") {
            const item = itemAt(columns, byColumn, spot);
            if (item) {
                take(e);
                api.openCard(item.note);
            }
            return;
        }

        if (e.key === "ContextMenu" && (spot.kind === "item" || spot.kind === "header")) {
            const element = document.activeElement;
            if (!(element instanceof HTMLElement)) return;

            take(e);
            askForMenu(element);
            return;
        }

        if (e.key === "Delete" && spot.kind === "header" && !e.shiftKey) {
            take(e);

            // Where focus goes once the column is gone, taken up only if it does go. Shift is left
            // unanswered here: escalating a column would take every note in it, which nothing else
            // on the board offers.
            const neighbour = columns[spot.column + 1] ?? columns[spot.column - 1];
            api.confirmAndRemoveColumn(columns[spot.column]).then((removed) => {
                if (removed && neighbour) {
                    pendingFocus.current = { intent: { column: neighbour, part: "header" } };
                }
            });
            return;
        }

        if (e.key === "Delete" && spot.kind === "item") {
            const item = itemAt(columns, byColumn, spot);
            if (!item) return;
            // Plain Delete clears the grouping value, which with the inbox drawn moves the card
            // there rather than off the board. Shift+Delete still deletes the note.
            if (!e.shiftKey && api.isInboxEnabled) return;
            take(e);

            // The whole selection while the focused card belongs to it, and that card alone
            // otherwise, which is the question the card's own menu answers the same way.
            if (!selection.has(item.note.noteId)) {
                selection.clear();
            }
            const selected = api.getCards(selection.keys);
            const going = selected.length ? selected : [ item ];

            // Straight away rather than through `pendingFocus`, which waits for a redraw: until the
            // card goes, focus is still on it, and a redraw arriving first would read that as the
            // reader having chosen where to be and let the intent go. The cards on their way out
            // are passed over, since focus would land on one about to be drawn no more.
            neighbourOf(container, columns, byColumn, spot,
                new Set(going.map((card) => card.note.noteId)))?.focus();

            if (e.shiftKey) {
                // The notes themselves, with the confirmation deleting one anywhere else asks for.
                branches.deleteNotes(going.map((card) => card.branch.branchId), false, false);
            } else {
                void api.removeFromBoard(going.map((card) => card.note.noteId));
            }
        }
    }, [
        containerRef, columns, byColumn, api, moveColumn, insertColumn, setActiveColumn, selection
    ]);

    return { onKeyDown, focusColumn, focusCard };
}

/**
 * What to put focus on once a card goes: the one under it, the one over it, or the column.
 *
 * @param going the cards leaving with it, which are passed over: a whole selection can be deleted
 * at once, and the card beside the focused one can be on its way out too.
 */
function neighbourOf(
    container: HTMLElement,
    columns: string[],
    byColumn: ColumnMap | undefined,
    spot: Extract<Spot, { kind: "item" }>,
    going: ReadonlySet<string> = new Set()
) {
    const column = columns[spot.column];
    const items = byColumn?.get(column) ?? [];
    const stays = (item: ColumnItem) => !going.has(item.note.noteId);
    const next = items.slice(spot.item + 1).find(stays)
        ?? items.slice(0, spot.item).findLast(stays);

    return next
        ? findCard(container, next.note.noteId)
        : findInColumn(container, column, "add-item");
}

/**
 * Asks the focused card or header for its menu the way a right click does, rather than by opening
 * one here: both already answer for `contextmenu`, and what each menu offers is theirs to say.
 *
 * The press is taken first, so the browser sends no `contextmenu` of its own and the menu is not
 * opened twice. Where it opens is named here, a key press carrying no position of its own.
 */
function askForMenu(element: HTMLElement) {
    const { left, bottom } = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: left,
        clientY: bottom
    }));
}

/** Whether Shift on this press is the board's to answer for, rather than the application's. */
function shiftIsOurs(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === "Delete") {
        return true;
    }

    return e.ctrlKey && CARD_END_KEYS.includes(e.key);
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

    return { kind: "item", column, item: indexOfCard(card as HTMLElement, columnElement) };
}

/**
 * Moves focus, answering with whether the key led anywhere.
 *
 * Up and down walk one column, from its header through its cards to the button under them. Left and
 * right cross to the next column's first card, or to its button where it holds none: its header is
 * reached by pressing up from there, which is the only way a header is reached at all.
 */
function walk(container: HTMLElement, from: Spot, key: string): Spot | null {
    const next = destination(container, from, key);
    if (!next) return null;

    const element = elementAt(container, next);
    if (element) {
        reveal(element);
        return next;
    }

    // A windowed column draws a slice of its cards, and the walk has stepped onto one outside it.
    // `askForCard` scrolls that column, which puts the card in the page so it can be focused.
    if (next.kind === "item") {
        const column = columnsOf(container)[next.column];
        const value = column?.dataset.column;
        if (!column || value === undefined) return null;

        // `immediate` draws the card before this returns, so it is focused in this keystroke.
        // Deferred to a later frame, the scroll can unmount the card being walked from, leaving
        // `document.activeElement` on the body: `spotOf` then finds no spot and the browser
        // scrolls the board instead.
        askForCard(container, value, next.item, true);
        const arrived = cardAt(column, next.item);
        if (arrived) {
            reveal(arrived);
            return next;
        }
    }

    return null;
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

    const items = cardCountOf(columnsOf(container)[from.column]);
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

/** The first thing a column offers on the way in, which is its header only where it is collapsed. */
function entryOf(container: HTMLElement, column: number): Spot {
    const element = columnsOf(container)[column];
    // A collapsed column draws neither cards nor the button under them, so walking past it would
    // otherwise find nothing to land on and skip the column entirely.
    if (element?.classList.contains("collapsed")) {
        return { kind: "header", column };
    }

    return cardCountOf(element)
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
    { columns, byColumn, api, setActiveColumn, selection, sendCardsToColumn, moveCardsWithin }:
        Pick<BoardKeyboardOptions,
            "columns" | "byColumn" | "api" | "setActiveColumn" | "selection"
            | "sendCardsToColumn" | "moveCardsWithin">,
    /** Whether the card goes the whole way rather than one place. */
    toEnd = false
): { intent: FocusIntent; done: Promise<unknown> } | false {
    const item = itemAt(columns, byColumn, spot);
    if (!item || spot.kind !== "item") return false;

    const column = columns[spot.column];
    const items = byColumn?.get(column) ?? [];
    const { noteId } = item.note;

    // The whole selection while the focused card belongs to it, and that card alone otherwise.
    // A move leaves a selection the card is no part of standing: nothing is lost by it, and a key
    // that only reorders should not also undo what the reader has picked out.
    const selected = api.getCards(selection.keys);
    const moving = selection.has(noteId) && selected.length ? selected : [ item ];
    const carried = moving.map((card) => ({
        noteId: card.note.noteId,
        branchId: card.branch.branchId
    }));

    if (key === "ArrowLeft" || key === "ArrowRight") {
        const target = toEnd
            ? columns[key === "ArrowRight" ? columns.length - 1 : 0]
            : columns[spot.column + (key === "ArrowRight" ? 1 : -1)];
        // Only the whole way can ask for the column a card already stands in.
        if (!target || target === column) return false;

        // A selection standing in several columns is left alone: each card has a neighbour of its
        // own, and sending them all to one column is not what the key means anywhere else.
        if (moving.some((card) => api.getCardColumn(card.note.noteId) !== column)) {
            return false;
        }

        // The cards are drawn under the column they land in, so a collapsed one has to open first
        // for there to be anything to focus.
        setActiveColumn(target);

        // The last of them, which is the one that lands furthest down the column it joins: focus
        // is what the board scrolls to, so this is what makes the end of the set visible. For one
        // card it is that card, as it has always been.
        const arrived = moving.at(-1) ?? item;

        return {
            intent: { noteId: arrived.note.noteId },
            done: sendCardsToColumn(carried, target)
        };
    }

    // Where the cards stand in the column, which they can only be reordered as one if they stand
    // together in it. A selection reaching into another column, or one with cards between its own,
    // has no single place to be moved to and the key is answered with nothing.
    const places = moving.map((card) =>
        items.findIndex((candidate) => candidate.note.noteId === card.note.noteId));
    const start = Math.min(...places);
    const end = Math.max(...places);
    if (places.some((place) => place < 0) || end - start !== places.length - 1) {
        return false;
    }

    const last = items.length - 1;
    // A card is placed before a position too, so moving down means passing the one below the run.
    const to = key === "ArrowUp" && start > 0 ? start - 1
        : key === "ArrowDown" && end < last ? end + 2
        : key === "Home" && start > 0 ? 0
        : key === "End" && end < last ? items.length
        : null;

    if (to === null) return false;

    return {
        intent: { noteId },
        done: moveCardsWithin(carried, column, to)
    };
}

/** The pending `reveal()` timer, so a newer call replaces it instead of running alongside it. */
let pendingReveal: number | undefined;

/**
 * Focuses an element and scrolls to it once it has stopped moving.
 *
 * `useFlip` transforms a moved element back to its old place and releases it, so while that slide
 * runs the element is painted between the two places. `scrollIntoView` follows what is painted, so
 * scrolling any earlier targets where the element came from and leaves the column where it was.
 */
function reveal(element: HTMLElement) {
    element.focus({ preventScroll: true });

    // Only the last call survives: keys pressed faster than a slide runs would otherwise each
    // scroll to where the card stood when they fired.
    window.clearTimeout(pendingReveal);
    pendingReveal = window.setTimeout(() => {
        if (!element.isConnected) {
            return;
        }

        // The last card scrolls its column to the end rather than just into view: its own bottom
        // margin and the fade over the column's bottom edge would otherwise cover it.
        const content = element.closest<HTMLElement>(".board-column-content");
        if (content && !cardFollows(element)) {
            content.scrollTop = content.scrollHeight;
        }

        // Into view either way, which is what scrolls the board sideways to the column a card has
        // crossed into. Called second, so a column already scrolled to its end stays there.
        element.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, FLIP_SETTLE_MS);
}

/**
 * Moves the column focus is in, answering with what to put focus back on. Whatever was focused
 * stays focused: the browser blurs an element it moves, so it would otherwise be left focused on
 * nothing.
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
        : key === "End" && spot.column < last ? columns.length
        : key === "Home" && spot.column > 0 ? 0
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
    return cardAt(column, spot.item);
}

/**
 * Watches for a card to be drawn, for the few frames a column takes to scroll to it.
 *
 * Given up on rather than waited for indefinitely: a card that never arrives means the move did not
 * land where it was expected, and focus is better left alone than chased.
 */
function waitForCard(
    container: HTMLElement, noteId: string, then: (card: HTMLElement) => void, tries = 8
) {
    const card = findCard(container, noteId);
    if (card) {
        then(card);
        return;
    }

    if (tries > 0) {
        requestAnimationFrame(() => waitForCard(container, noteId, then, tries - 1));
    }
}

/** Which column holds a note and where in it, for a card the board is not drawing. */
function placeOf(byColumn: ColumnMap | undefined, noteId: string) {
    if (!byColumn) return undefined;

    for (const [ column, items ] of byColumn) {
        const index = items.findIndex((item) => item.note.noteId === noteId);
        if (index >= 0) {
            return { column, index };
        }
    }

    return undefined;
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
    // A strip holds its cards in the page but draws none of them, so it offers none to walk onto.
    if (!column || column.classList.contains("collapsed")) {
        return [];
    }

    return [ ...column.querySelectorAll<HTMLElement>(".board-note") ];
}

/**
 * How many cards a column holds, which a windowed one draws only part of.
 *
 * Read from what the column states rather than counted off the page, or walking one would stop at
 * the edge of what happens to be drawn.
 */
function cardCountOf(column: Element | undefined) {
    if (!column || column.classList.contains("collapsed")) {
        return 0;
    }

    const stated = column.querySelector<HTMLElement>(".board-column-content")?.dataset.windowCount;
    const count = stated === undefined ? Number.NaN : Number(stated);
    return Number.isFinite(count) ? count : cardsOf(column).length;
}

/** The place a card holds in its column, which it states for a windowed one. */
function indexOfCard(card: HTMLElement, column: Element | undefined) {
    const stated = card.dataset.index;
    const index = stated === undefined ? Number.NaN : Number(stated);
    return Number.isFinite(index) ? index : cardsOf(column).indexOf(card);
}

/** The card at a place in a column, or nothing where the column is not drawing it. */
function cardAt(column: Element, index: number) {
    return column.querySelector<HTMLElement>(`.board-note[data-index="${index}"]`);
}
