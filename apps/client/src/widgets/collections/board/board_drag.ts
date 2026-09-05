import { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { useTrackedElement } from "../../react/hooks";
import {
    type CardBox, cardInsertionIndex, columnAt, columnCovers, columnInsertionIndex
} from "./drag_geometry";
import { type BoardMeasurement, measureBoard, toAreaY, toBoardX } from "./drag_measure";
import { createEdgeScroller, type ScrollTarget } from "../../react/edge_scroll";

/** How far a pointer travels before a press with a button held is taken for a drag. */
const MOUSE_THRESHOLD = 4;

/** How long a finger rests before its press is taken for a drag. */
const TOUCH_DELAY_MS = 400;

/** How far a finger may stray in that time and still be resting rather than scrolling. */
const TOUCH_TOLERANCE = 8;

/** How much a carried card shrinks. Written with the movement, a class could not add to it. */
const DRAG_SCALE = 0.9;

/** How tall a carried column is allowed to stand, so a full one can be seen past. */
const COLUMN_DRAG_MAX_HEIGHT = 150;

/** How long a card rests on a column's heading before it counts as standing there. */
const DWELL_MS = 500;

/** How long the mouse events a browser makes from a tap can take to arrive. */
const COMPATIBILITY_WINDOW_MS = 700;

/** Which card is being carried, named the way the board's own moves are. */
export interface DraggedCard {
    noteId: string;
    fromColumn: string;
    index: number;
    /** How tall it stands, so the gap held open for it is the size it will fill. */
    height: number;
}

/** Where the card would land. */
export interface DropPosition {
    column: string;
    index: number;
}

export interface BoardDragCallbacks {
    /** A card has been taken hold of, and is now being carried. */
    onCardStart(card: DraggedCard): void;
    /**
     * Where the card would land has changed, or it is over nowhere it could land.
     *
     * @param inside whether the card has come to rest on the column itself, rather than merely
     * being nearest to it or passing over it. A column claims the gap beside it so that a card held
     * there still has somewhere to go, and a collapsed one claims the empty space below its
     * heading; neither is reason enough to open it, and nor is crossing the heading on the way
     * somewhere else.
     */
    onCardMove(position: DropPosition | null, inside: boolean): void;
    /**
     * The gesture is over. A position means let go somewhere; nothing means it was called off, by
     * Escape or by the pointer being taken away.
     */
    onCardEnd(card: DraggedCard, position: DropPosition | null): void;
    /**
     * A column has been taken hold of by its heading.
     *
     * @param size what it measures, so the gap held open for it is the size it will land in.
     */
    onColumnStart(column: string, index: number, size: { width: number, height: number }): void;
    /** Which place among the columns it would take, counting them as they stand. */
    onColumnMove(index: number | null): void;
    /** As {@link onCardEnd}, for a column: a place means let go, nothing means called off. */
    onColumnEnd(from: number, to: number | null): void;
}

/**
 * Carries a card or a column around the board under the pointer.
 *
 * A mouse takes hold as soon as it moves with a button down; a finger has to rest first, so that a
 * swipe still scrolls the column it started in. Everything the gesture needs is measured when it
 * starts, so a move reads two rectangles rather than one for every card on the board.
 *
 * What is carried is a copy, placed against the window: a card is carried past the edges of the
 * column holding it, which scrolls, and would be cut off at them.
 *
 * @param containerRef the board's scrolling container.
 * @param callbacks what to do as the gesture opens, moves and closes.
 * @param disabled whether to leave presses alone.
 */
export function useBoardDrag(
    containerRef: RefObject<HTMLElement>,
    callbacks: BoardDragCallbacks,
    disabled = false
) {
    const [ isDragging, setDragging ] = useState(false);
    // Held in a ref rather than in state: every move reads them, and none of them draw anything.
    const gesture = useRef<Gesture | null>(null);
    const latest = useRef(callbacks);
    latest.current = callbacks;
    // The board draws its container only once the notes have loaded, and filling a ref triggers no
    // render, so an effect reading the ref alone would never hear it arrive.
    const container = useTrackedElement(containerRef);

    useEffect(() => {
        if (!container || disabled) return;

        // Walks the board along, and the column's cards up and down, while what is carried is held
        // near an edge. Each frame that moves anything reads the point again, since what is under
        // the pointer has changed without the pointer itself moving.
        const scroller = createEdgeScroller({
            onScroll: () => {
                const held = gesture.current;
                if (held?.active) {
                    resolve(held);
                }
            }
        });

        const close = (cancelled: boolean) => {
            const held = gesture.current;
            gesture.current = null;
            if (!held) return;

            window.clearTimeout(held.timer);
            window.clearTimeout(held.dwell);
            scroller.stop();
            container.classList.remove("board-dragging");
            held.preview?.remove();
            held.element.style.display = "";
            if (held.frame !== undefined) {
                cancelAnimationFrame(held.frame);
            }
            if (!held.active) return;

            setDragging(false);
            if (held.kind === "card") {
                latest.current.onCardEnd(held.card, cancelled ? null : held.position);
            } else {
                latest.current.onColumnEnd(held.index, cancelled ? null : held.target);
            }
        };

        const activate = () => {
            const held = gesture.current;
            if (!held || held.active) return;

            held.active = true;
            // Measured before what is carried is taken out of the flow, so the places it can land
            // are the ones the board is showing.
            held.measurement = measureBoard(container);
            // Held from here on, so the gesture keeps the pointer wherever it goes. Taken at the
            // press instead, it would carry the click away from what was pressed.
            container.setPointerCapture?.(held.pointerId);

            // Taking the card out of the flow shortens its column, and a column scrolled near its
            // foot is clamped to the new end before the gap standing in for the card has been
            // drawn. Put back on the next frame, by which time it has.
            const area = held.element.closest<HTMLElement>(".board-column-content");
            const keptScroll = area?.scrollTop;
            const lifted = lift(held, container);
            if (area && keptScroll !== undefined) {
                requestAnimationFrame(() => {
                    if (area.scrollTop < keptScroll) {
                        area.scrollTop = keptScroll;
                    }
                });
            }
            held.preview = lifted.preview;
            held.grab = lifted.grab;
            container.classList.add("board-dragging");
            setDragging(true);

            if (held.kind === "card") {
                latest.current.onCardStart(held.card);
            } else {
                latest.current.onColumnStart(held.column, held.index, lifted.size);
            }
            resolve(held);
        };

        const resolve = (held: Gesture) => {
            const measurement = held.measurement;
            const grab = held.grab;
            if (!measurement || !grab) return;

            // Read from what is being carried, not from the pointer: the reader took hold of it
            // wherever they happened to press, and it is the card they are placing. Across, its
            // middle says which column it is over; down, its top edge says which place it takes,
            // that being the edge the gap opens at. Scrolling still follows the pointer, which is
            // what the reader steers with.
            const middleX = held.lastX - grab.x + grab.width / 2;
            const topY = held.lastY - grab.y;

            const x = toBoardX(container, middleX);
            if (held.kind === "column") {
                scroller.update([ { element: container, axis: "x" } ], held.lastX, held.lastY);
                const target = columnInsertionIndex(measurement.columns, x);
                if (target !== held.target) {
                    held.target = target;
                    latest.current.onColumnMove(target);
                }
                return;
            }

            const column = columnAt(measurement.columns, x);
            const area = column && measurement.areas.get(column.value);
            const edges: ScrollTarget[] = [ { element: container, axis: "x" } ];
            if (area) {
                edges.push({ element: area, axis: "y" });
            }
            scroller.update(edges, held.lastX, held.lastY);


            // A collapsed column draws no card area and holds no cards on screen, so a card carried
            // over it goes to the front of whatever it holds.
            const position = column
                ? {
                    column: column.value,
                    index: area
                        ? placeIn(column.cards, toAreaY(area, topY), held.card, column.value)
                        : 0
                }
                : null;
            // Standing on the column itself, which for a collapsed one is its heading alone: the
            // empty space under it belongs to no column the reader can see.
            const on = column && columnCovers(column, x, topY) ? column.value : undefined;
            if (on !== held.on) {
                window.clearTimeout(held.dwell);
                held.on = on;
                held.inside = false;
                if (on) {
                    // Rested on rather than crossed: a card carried over a heading on its way
                    // somewhere else leaves the column as it found it.
                    held.dwell = window.setTimeout(() => {
                        held.inside = true;
                        report(held);
                    }, DWELL_MS);
                }
            }

            report(held, position);
        };

        /** Says where the card would land, and whether it has come to rest on that column. */
        const report = (held: Gesture, next?: DropPosition | null) => {
            if (held.kind !== "card") return;

            const position = next === undefined ? held.position : next;
            if (position?.column !== held.position?.column
                    || position?.index !== held.position?.index
                    || held.inside !== held.reported) {
                held.position = position;
                held.reported = held.inside;
                latest.current.onCardMove(position, held.inside);
            }
        };

        const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0 || gesture.current) return;

            const target = event.target as HTMLElement | null;
            // Anything the card or the heading offers in its own right keeps its press.
            if (!target || target.closest("input, textarea, button, a")) return;

            const started = startCard(target) ?? startColumn(target, container);
            if (!started) return;

            gesture.current = {
                ...started,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                lastX: event.clientX,
                lastY: event.clientY,
                touch: event.pointerType !== "mouse",
                active: false,
                preview: undefined,
                measurement: undefined,
                frame: undefined,
                timer: 0
            };

            if (gesture.current.touch) {
                gesture.current.timer = window.setTimeout(activate, TOUCH_DELAY_MS);
            }
        };

        const onPointerMove = (event: PointerEvent) => {
            const held = gesture.current;
            if (!held || event.pointerId !== held.pointerId) return;

            held.lastX = event.clientX;
            held.lastY = event.clientY;

            if (!held.active) {
                const travelled = Math.hypot(event.clientX - held.startX, event.clientY - held.startY);
                if (held.touch) {
                    // Straying this far before the press has ripened means the finger is scrolling.
                    if (travelled > TOUCH_TOLERANCE) close(true);
                    return;
                }

                if (travelled <= MOUSE_THRESHOLD) return;
                // Carried on into the move below, so what is picked up takes its place under the
                // pointer on the move that picked it up rather than on the one after.
                activate();
            }

            // Written in a frame of its own, and only the transform: a move that redrew the board
            // would redraw every card on it.
            if (held.frame === undefined) {
                held.frame = requestAnimationFrame(() => {
                    held.frame = undefined;
                    if (!gesture.current || !held.preview) return;

                    const dx = held.lastX - held.startX;
                    const dy = held.lastY - held.startY;
                    const scale = held.kind === "card" ? ` scale(${DRAG_SCALE})` : "";
                    held.preview.style.transform = `translate3d(${dx}px, ${dy}px, 0)${scale}`;
                    resolve(held);
                });
            }
        };

        const onPointerUp = (event: PointerEvent) => {
            const held = gesture.current;
            if (!held || event.pointerId !== held.pointerId) return;

            // A tap is a press that never became a drag: it asks for the menu, the long press that
            // would have opened one being how a finger picks a card up instead.
            const tapped = held.touch && !held.active && event.type === "pointerup"
                && Math.hypot(event.clientX - held.startX, event.clientY - held.startY)
                    <= TOUCH_TOLERANCE;
            const target = held.menuTarget;
            // A tap on a collapsed column opens it: that is what the strip is for, and its menu is
            // on the button it carries. Everything else answers a tap with its menu, the long
            // press that would otherwise open one being how a finger picks something up.
            const opens = target.closest(".board-column")?.classList.contains("collapsed");

            close(event.type === "pointercancel");

            if (tapped && !opens) {
                // The browser follows a tap with mouse events for pages that know nothing of touch,
                // and they land on the menu this is about to open, right under the finger: the
                // first of them takes the menu straight back off again. Refused at `touchend`,
                // which is what the browser makes them from, and which has yet to be sent.
                justTapped = true;
                // The click is left out as well, for a browser that sends one regardless. Given up
                // after a moment so a later click of the reader's own is never the one taken.
                container.addEventListener("click", swallow, { capture: true, once: true });
                window.setTimeout(
                    () => container.removeEventListener("click", swallow, { capture: true }),
                    COMPATIBILITY_WINDOW_MS);
                askForMenu(target, event.clientX, event.clientY);
            }
        };

        /** Set between a tap and the `touchend` the browser would make mouse events from. */
        let justTapped = false;

        const onTouchEnd = (event: TouchEvent) => {
            if (justTapped) {
                justTapped = false;
                event.preventDefault();
            }
        };

        const swallow = (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && gesture.current?.active) {
                close(true);
            }
        };

        // A long press is how a finger picks something up, so the menu the same press would
        // otherwise open is left out. Taken while the event is on its way down, the card's own
        // handler standing between this and the menu.
        const onContextMenu = (event: MouseEvent) => {
            if (gesture.current?.touch) {
                event.preventDefault();
                event.stopPropagation();
            }
        };

        // Non-passive, and at the document: the page decides whether a touch scrolls from the first
        // move it sees, so refusing it has to happen there rather than once the board hears of it.
        const onTouchMove = (event: TouchEvent) => {
            if (gesture.current?.active) {
                event.preventDefault();
            }
        };

        container.addEventListener("contextmenu", onContextMenu, { capture: true });
        container.addEventListener("pointerdown", onPointerDown);
        container.addEventListener("pointermove", onPointerMove);
        container.addEventListener("pointerup", onPointerUp);
        container.addEventListener("pointercancel", onPointerUp);
        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("touchmove", onTouchMove, { passive: false });
        document.addEventListener("touchend", onTouchEnd, { passive: false });

        return () => {
            close(true);
            container.removeEventListener("contextmenu", onContextMenu, { capture: true });
            container.removeEventListener("pointerdown", onPointerDown);
            container.removeEventListener("pointermove", onPointerMove);
            container.removeEventListener("pointerup", onPointerUp);
            container.removeEventListener("pointercancel", onPointerUp);
            document.removeEventListener("keydown", onKeyDown);
            document.removeEventListener("touchmove", onTouchMove);
            document.removeEventListener("touchend", onTouchEnd);
            container.removeEventListener("click", swallow, { capture: true });
        };
    }, [ container, disabled ]);

    /**
     * Measures the board again, for a drag the board has redrawn under: a collapsed column opened
     * to take the card moves every column after it.
     */
    const remeasure = useCallback(() => {
        const held = gesture.current;
        if (!held?.active || !container) {
            return;
        }

        const measurement = measureBoard(container);
        // A column that was measured with cards keeps them. The board now holds the gap where the
        // carried card was, which stands every card below it one place lower, so reading them again
        // would take the drag's own doing for a move of its own and the places would creep away
        // from the card with every one it passes. A column measured with none is read afresh: a
        // collapsed one draws no cards at all until it opens, which is what this runs for.
        for (const column of measurement.columns) {
            const before = held.measurement?.columns.find(({ value }) => value === column.value);
            if (before?.cards.length) {
                column.cards = before.cards;
            }
        }

        held.measurement = measurement;
    }, [ container ]);

    return { isDragging, remeasure };
}

/**
 * The place a carried card would take in a column, counting that column as the board holds it.
 *
 * The cards were measured with the carried one among them, and it leaves the flow the moment it is
 * picked up, so the column is read here as it is drawn: without that card, and with everything
 * below it standing where the card's own place used to be. Its height is its own, so the cards
 * below move by that and not by a card's worth, which is what a column of mixed heights turns on.
 * The answer is then counted back into the list the board holds, which is what a move names.
 */
function placeIn(cards: CardBox[], y: number, card: DraggedCard, column: string): number {
    const carried = cards[card.index];
    if (column !== card.fromColumn || !carried) {
        return cardInsertionIndex(cards, y);
    }

    const below = cards[card.index + 1];
    const vacated = below ? below.top - carried.top : carried.height;
    const drawn = cards
        .filter((_, index) => index !== card.index)
        .map((other, index) => index < card.index
            ? other
            : { top: other.top - vacated, height: other.height });

    const index = cardInsertionIndex(drawn, y);

    return index >= card.index ? index + 1 : index;
}

/** Asks an element for its menu the way a right click does, at the place the tap landed. */
function askForMenu(element: HTMLElement, clientX: number, clientY: number) {
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX, clientY }));
}

/** What a press on a card starts, or nothing where the press was not on one. */
function startCard(target: HTMLElement): CardSubject | null {
    const element = target.closest<HTMLElement>(".board-note");
    const columnElement = element?.closest<HTMLElement>(".board-column");
    const noteId = element?.dataset.noteId;
    if (!element || !columnElement || !noteId) return null;

    const cards = [ ...columnElement.querySelectorAll(".board-note") ];
    return {
        kind: "card",
        element,
        menuTarget: element,
        card: {
            noteId,
            fromColumn: columnElement.dataset.column ?? "",
            index: cards.indexOf(element),
            height: element.getBoundingClientRect().height
        },
        position: null,
        inside: false,
        reported: false
    };
}

/**
 * What a press on a column heading starts. The heading is the handle, as it was when the browser
 * carried the column; a press anywhere else in the column belongs to what stands there.
 */
function startColumn(target: HTMLElement, container: HTMLElement): ColumnSubject | null {
    const heading = target.closest<HTMLElement>(".board-column h3");
    const element = heading?.closest<HTMLElement>(".board-column");
    if (!heading || !element || heading.classList.contains("editing")) return null;

    const columns = [ ...container.querySelectorAll(".board-column") ];
    return {
        kind: "column",
        element,
        menuTarget: heading,
        column: element.dataset.column ?? "",
        index: columns.indexOf(element),
        target: null
    };
}

/**
 * Takes a copy of what is being carried out of the board's flow and hands it back.
 *
 * The copy is positioned against the window, which no ancestor's overflow can clip, and stands
 * inside the board so that the board's own styling still reaches it. A column is capped rather than
 * given a height, so that a tall one does not cover the board it is being placed on while a short
 * one still stands as tall as it is.
 */
function lift(held: Gesture, container: HTMLElement) {
    const rect = held.element.getBoundingClientRect();
    const preview = held.element.cloneNode(true) as HTMLElement;

    preview.classList.add("board-drag-preview");
    preview.removeAttribute("data-note-id");
    preview.removeAttribute("data-column");
    // A copy can be used for nothing, and the copy stands outside the column its controls are
    // styled from, so what it offers is taken out rather than left showing.
    preview.querySelector(".edit-icon")?.remove();
    preview.querySelector(".board-new-item")?.remove();

    // The copy is carried in the drag layer rather than in the column it came from, where the rule
    // that tints a card no longer reaches it, so the column's hue is put on the copy itself.
    const hue = held.element.closest<HTMLElement>(".board-column.with-hue")
        ?.style.getPropertyValue("--board-column-custom-hue");
    if (held.kind === "card" && hue) {
        preview.classList.add("column-tinted");
        preview.style.setProperty("--board-column-custom-hue", hue);
    }

    for (const [ property, value ] of Object.entries({
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        ...(held.kind === "column"
            ? { "max-height": `${COLUMN_DRAG_MAX_HEIGHT}px` }
            : { height: `${rect.height}px` })
    })) {
        preview.style.setProperty(property, value);
    }

    // Into the layer rather than the board itself: the board's children are Preact's to place, and
    // a node put among them by hand is one it has to reckon with when it next draws.
    (container.querySelector(".board-drag-layer") ?? container).appendChild(preview);
    held.element.style.display = "none";
    return {
        preview,
        size: { width: rect.width, height: rect.height },
        // Where inside it the reader took hold, so the middle can be found from the pointer.
        grab: {
            x: held.startX - rect.left,
            y: held.startY - rect.top,
            width: rect.width,
            height: rect.height
        }
    };
}

interface CardSubject {
    kind: "card";
    element: HTMLElement;
    /** What a tap asks for the menu, which for a column is its heading rather than the column. */
    menuTarget: HTMLElement;
    card: DraggedCard;
    position: DropPosition | null;
    /** The column the card stands on, if any, which resting there opens. */
    on?: string;
    /** Whether it has rested there long enough to count. */
    inside: boolean;
    /** What was last said about that, so nothing is said twice. */
    reported: boolean;
}

interface ColumnSubject {
    kind: "column";
    element: HTMLElement;
    menuTarget: HTMLElement;
    column: string;
    /** Where it stands among the columns, counting them as they are drawn. */
    index: number;
    /** The place it would take, as last reported. */
    target: number | null;
}

/** One press, from the moment it lands until it is let go or called off. */
type Gesture = (CardSubject | ColumnSubject) & {
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    /** Whether the press has to ripen before it carries anything. */
    touch: boolean;
    /** Whether it has, and something is being carried. */
    active: boolean;
    /** The copy that follows the pointer, what it stands for staying where it is. */
    preview?: HTMLElement;
    /** Where the press landed inside it, and how big it is, for finding its middle. */
    grab?: { x: number, y: number, width: number, height: number };
    measurement?: BoardMeasurement;
    frame?: number;
    timer: number;
    /** Counts down the rest on a column's heading, which is what opens a collapsed one. */
    dwell?: number;
};
