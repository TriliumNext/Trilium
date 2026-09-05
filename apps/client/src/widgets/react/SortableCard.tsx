import "./SortableCard.css";

import clsx from "clsx";
import { ComponentChildren } from "preact";
import { flushSync } from "preact/compat";
import {
    useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState
} from "preact/hooks";

import { t } from "../../services/i18n";
import Button from "./Button";
import { Card, type CardProps } from "./Card";
import { createEdgeScroller, type Insets, type ScrollTarget } from "./edge_scroll";
import { useFlip } from "./flip";
import Icon from "./Icon";

/** How many creation buttons fit at the foot of a card before each is too narrow to read. */
const MAX_CREATION_BUTTONS = 3;

/**
 * How long a touch must stay still before the drag starts. A touch that moves first scrolls the
 * page instead. Matches the board's cards.
 */
const TOUCH_HOLD_MS = 400;

/** How far the touch can move within `TOUCH_HOLD_MS` and still count as still. */
const TOUCH_SLACK_PX = 8;

/**
 * How near an edge the pointer must come, in pixels, before the card scrolls. Wider for touch: a
 * finger covers the strip it has to reach.
 */
const SCROLL_MARGIN = 60;
const TOUCH_SCROLL_MARGIN = 100;

/**
 * Elements that handle a press themselves, so a press starting on one never drags the segment.
 * `renderItem` can draw anything, so ARIA roles and `contenteditable` count as well as the native
 * controls.
 */
const CONTROLS = "button, a, input, select, textarea, label, [contenteditable]:not([contenteditable=false]), "
    + "[role=button], [role=link], [role=checkbox], [role=switch], [role=textbox], [role=menuitem]";

/** One entry of a {@link SortableCard}, identified by a `key` independent of its position. */
export interface SortableItem {
    key: string;
    /** Text of the segment, used when `renderItem` is not given. */
    caption?: ComponentChildren;
    /** An icon class, `bx` prefix included, drawn before the caption. */
    icon?: string;
}

/**
 * One way of creating an entry, rendered as a button at the foot of the card.
 *
 * `onCreateItem` decides what the entry is, and may open a dialog or a picker first. Returning
 * nothing creates no entry.
 */
export interface ItemCreationButton<T extends SortableItem> {
    label: string;
    /** An icon class, `bx` prefix included. */
    icon?: string;
    /** Turns the button off, for a caller that cannot make an entry yet. */
    disabled?: boolean;
    /** Answers with the entry to add, or with nothing where none was made. */
    onCreateItem: (event?: MouseEvent) => T | undefined | Promise<T | undefined>;
}

export interface SortableCardProps<T extends SortableItem> extends CardProps {
    /** The entries, in display order. */
    items: T[];
    /** Called with the whole list in its new order after every change. */
    onChange: (items: T[]) => void;
    /**
     * Renders the contents of a segment, for a card showing more than a name. Without it, the
     * segment shows the item's `caption` and `icon`.
     */
    renderItem?: (item: T, index: number) => ComponentChildren;
    /**
     * The ways to create an entry, rendered as a row of buttons at the foot of the card and omitted
     * when empty. Up to three; more than that makes each button too narrow to read.
     *
     * Enter on a segment uses the first of them.
     */
    itemCreationButtons?: ItemCreationButton<T>[];
    /**
     * Which edge of a segment holds the grip. Defaults to the trailing edge; use the leading one
     * when the entries carry their own controls on the trailing side.
     */
    gripPlacement?: "start" | "end";
    /**
     * Called for a key the card does not answer itself, with the entry that had the focus. For a
     * caller whose entries have commands of their own.
     */
    onItemKeyDown?: (item: T, event: KeyboardEvent) => void;
    /** The selected entry, for a caller that keeps the selection itself. */
    selectedKey?: string;
    onSelect?: (key: string) => void;
}

/**
 * A card whose segments can be reordered by dragging the grip or with the keyboard. A drag moves
 * vertically only and is clamped to the card.
 *
 * The caller owns the order: `onChange` reports every change and the card renders what it is given
 * back. Entries are not interpreted, so anything identified by a key can be sorted.
 */
export function SortableCard<T extends SortableItem>({
    items, onChange, renderItem, itemCreationButtons, gripPlacement = "end", onItemKeyDown,
    selectedKey, onSelect, className, ...card
}: SortableCardProps<T>) {
    if ((itemCreationButtons?.length ?? 0) > MAX_CREATION_BUTTONS) {
        throw new Error("Up to three item creation buttons are supported");
    }

    const listRef = useRef<HTMLDivElement>(null);
    const adderRef = useRef<HTMLElement>(null);
    const dragRef = useRef<Drag<T>>();
    /** A touch waiting out `TOUCH_HOLD_MS`, after which it becomes a drag. */
    const holdRef = useRef<Hold>();
    /** The last pointer position, needed when scrolling moves the list under a still pointer. */
    const pointerRef = useRef({ x: 0, y: 0 });
    /** The current `dragTo`, so the scroller can reposition the segment without a stale closure. */
    const dragToRef = useRef<(clientY: number) => void>(() => {});
    /** Fixed chrome covering the screen edges, measured when a drag starts. */
    const reachRef = useRef<Insets>({ top: 0, bottom: 0, left: 0, right: 0 });
    /**
     * Scrolls the card's containers while a segment is dragged to an edge, so a card taller than
     * the viewport can be reordered end to end. Created once, so its frames outlive the render.
     */
    const scroller = useMemo(() => createEdgeScroller({
        margin: matchMedia("(pointer: coarse)").matches
            ? TOUCH_SCROLL_MARGIN
            : SCROLL_MARGIN,
        reach: () => reachRef.current,
        // The pointer has not moved, but the content under it has.
        onScroll: () => dragToRef.current(pointerRef.current.y)
    }), []);

    useEffect(() => () => scroller.stop(), [ scroller ]);

    /**
     * The order during a drag, reported to the caller when it ends. Kept until the caller renders
     * its own order, so the segments do not spring back in between.
     */
    const [ draft, setDraft ] = useState<T[] | null>(null);
    const [ draggedKey, setDraggedKey ] = useState<string>();
    const [ ownSelection, setOwnSelection ] = useState<string>();
    /** The entry just added, which grows and fades in. */
    const [ addedKey, setAddedKey ] = useState<string>();
    /** The segment to focus after the next render: moving an element drops its focus. */
    const pendingFocus = useRef<string>();

    const shown = draft ?? items;
    /** The current list, for a callback that resumes after an await. */
    const shownRef = useRef(shown);
    shownRef.current = shown;
    const selected = selectedKey ?? ownSelection;

    useEffect(() => {
        // The caller rendered its own order, so the draft can go. Not during a drag, where the
        // order is still changing.
        if (!dragRef.current) {
            setDraft(null);
        }
    }, [ items ]);

    const segmentOf = useCallback((key: string) => {
        // Compared instead of interpolated into a selector: a key holding a quote or a backslash
        // would throw or match the wrong segment.
        const segments = listRef.current?.querySelectorAll<HTMLElement>(".tn-sortable-segment");
        return [ ...segments ?? [] ].find((segment) => segment.dataset.key === key);
    }, []);

    // The dragged segment is excluded: it follows the pointer, and useFlip would slide it back.
    useFlip(listRef, {
        selector: ".tn-sortable-segment:not(.tn-sortable-dragging)",
        grow: (segment) => segment.dataset.key === addedKey
    });


    useLayoutEffect(() => {
        const key = pendingFocus.current;
        if (!key) {
            return;
        }

        pendingFocus.current = undefined;
        segmentOf(key)?.focus();
    });

    const select = useCallback((key: string) => {
        setOwnSelection(key);
        onSelect?.(key);
    }, [ onSelect ]);

    /** Moves focus and selection to the entry at `index`. */
    const focusEntry = useCallback((index: number) => {
        const key = shown[index]?.key;
        if (!key) {
            return;
        }

        pendingFocus.current = key;
        select(key);
        segmentOf(key)?.focus();
    }, [ segmentOf, select, shown ]);

    /** Moves the entry at `from` to `to`, keeping the focus on it. */
    const moveItem = useCallback((from: number, to: number) => {
        const order = moved(shown, from, to);
        if (!order) {
            return;
        }

        pendingFocus.current = shown[from].key;
        setDraft(order);
        onChange(order);
    }, [ onChange, shown ]);

    /** Ends the drag, keeping the new order or restoring the one the drag started from. */
    const endDrag = useCallback((keep: boolean) => {
        const drag = dragRef.current;
        if (!drag) {
            return;
        }

        dragRef.current = undefined;
        const segment = segmentOf(drag.key);
        if (segment) {
            segment.style.transform = "";
        }

        listRef.current?.releasePointerCapture?.(drag.pointerId);
        scroller.stop();
        setDraggedKey(undefined);
        pendingFocus.current = drag.key;

        if (!keep) {
            setDraft(null);
            return;
        }

        setDraft(drag.order);
        if (drag.order.some((item, index) => item.key !== drag.was[index].key)) {
            onChange(drag.order);
        }
    }, [ onChange, scroller, segmentOf ]);

    /** Starts the drag: records what is being moved and marks the segment as dragging. */
    const startDrag = useCallback((key: string, pointerId: number, clientY: number) => {
        const segment = segmentOf(key);
        if (!segment) {
            return;
        }

        reachRef.current = fixedChrome(segment);

        // Throws when the pointer is no longer active, usually a touch lifted during the hold.
        // Touch captures to the segment implicitly, so the drag works without this.
        try {
            listRef.current?.setPointerCapture?.(pointerId);
        } catch {
            // Nothing to do: pointermove reaches the list either way.
        }

        dragRef.current = {
            key,
            pointerId,
            grabbedAt: clientY,
            at: listRef.current?.getBoundingClientRect().top ?? 0,
            from: segment.offsetTop,
            height: segment.offsetHeight,
            order: shown,
            was: shown
        };

        setDraggedKey(key);
        select(key);
        segment.focus();
    }, [ segmentOf, select, shown ]);

    const cancelHold = useCallback(() => {
        const held = holdRef.current;
        holdRef.current = undefined;
        if (!held) {
            return;
        }

        window.clearTimeout(held.timer);
        held.stopWatching();
    }, []);

    useEffect(() => () => cancelHold(), [ cancelHold ]);

    const beginDrag = useCallback((event: PointerEvent, key: string) => {
        if (!listRef.current || !segmentOf(key)) {
            return;
        }

        const target = event.target as HTMLElement | null;
        const onGrip = !!target?.closest(".tn-sortable-grip");

        // A mouse drags from the grip only, since it can aim at one. A touch drags from anywhere
        // on the segment, which a thumb reaches far more easily.
        if (event.pointerType === "mouse") {
            if (!onGrip || event.button !== 0) {
                return;
            }

            // Stops the press from starting a text selection.
            event.preventDefault();
            startDrag(key, event.pointerId, event.clientY);
            return;
        }

        // A press starting on a control belongs to that control. The segment is not one, although
        // it handles keys and carries a tabindex.
        const control = target?.closest(CONTROLS);
        if (!onGrip && control && control !== segmentOf(key)) {
            return;
        }


        cancelHold();

        // The list captures the pointer only once the drag begins, so a finger lifted before that
        // and outside the list reports to the page. Without this the timer drags a pointer that is
        // no longer down.
        const dropped = (ended: PointerEvent) => {
            if (ended.pointerId === holdRef.current?.pointerId) {
                cancelHold();
            }
        };

        document.addEventListener("pointerup", dropped);
        document.addEventListener("pointercancel", dropped);

        holdRef.current = {
            pointerId: event.pointerId,
            from: { x: event.clientX, y: event.clientY },
            // Where the finger is once the hold ends, so a small drift does not offset the drag.
            at: event.clientY,
            stopWatching: () => {
                document.removeEventListener("pointerup", dropped);
                document.removeEventListener("pointercancel", dropped);
            },
            timer: window.setTimeout(() => {
                const held = holdRef.current;
                holdRef.current = undefined;
                if (held) {
                    held.stopWatching();
                    startDrag(key, held.pointerId, held.at);
                }
            }, TOUCH_HOLD_MS)
        };
    }, [ cancelHold, segmentOf, startDrag ]);

    const dragTo = useCallback((clientY: number) => {
        const drag = dragRef.current;
        const list = listRef.current;
        const segment = drag && segmentOf(drag.key);
        if (!drag || !list || !segment) {
            return;
        }

        // How far the pointer has moved, less how far the list has scrolled under it: the segment
        // follows the position in the card, not the position on screen it started from.
        const carried = clientY - drag.grabbedAt - (list.getBoundingClientRect().top - drag.at);
        // Clamped to the card: the segment cannot pass the first or last position, whatever the
        // pointer does.
        const room = Math.max(0, list.clientHeight - drag.height);
        const top = Math.min(Math.max(drag.from + carried, 0), room);

        const order = orderFor(drag, segment, top, segmentOf);
        if (order) {
            drag.order = order;
            // Rendered before the segment is positioned, so it is measured against its new slot.
            flushSync(() => setDraft(order));
        }

        segment.style.transform = `translateY(${top - segment.offsetTop}px)`;
    }, [ segmentOf ]);

    dragToRef.current = dragTo;

    /**
     * Creates an entry at `at`, or appends it when no index is given. An entry created among the
     * others takes the focus; an appended one leaves it on the button, so several can be made.
     */
    const add = useCallback(async (
        create: ItemCreationButton<T>["onCreateItem"], at?: number, event?: MouseEvent
    ) => {
        const created = await create(event);
        if (!created) {
            return;
        }

        // Read again instead of closed over: `create` can open a dialog, and an order built from
        // the stale list would undo a reorder made meanwhile.
        const order = [ ...shownRef.current ];
        order.splice(at ?? order.length, 0, created);
        setAddedKey(created.key);
        setDraft(order);
        if (at !== undefined) {
            pendingFocus.current = created.key;
        }

        onChange(order);
    }, [ onChange ]);

    /**
     * Ends what `event.pointerId` was doing, and nothing else: a second finger pressed and lifted
     * in the list would otherwise cancel or commit the first one's drag.
     */
    const finish = useCallback((event: PointerEvent, keep: boolean) => {
        if (holdRef.current?.pointerId === event.pointerId) {
            cancelHold();
            return;
        }

        if (dragRef.current?.pointerId === event.pointerId) {
            endDrag(keep);
        }
    }, [ cancelHold, endDrag ]);

    const onSegmentKeyDown = useCallback((event: KeyboardEvent, index: number) => {
        if (event.key === "Escape" && dragRef.current) {
            event.preventDefault();
            endDrag(false);
            return;
        }

        // A key pressed on a control `renderItem` drew belongs to that control: Enter and Space
        // activate a button, and the card would otherwise act on the entry at the same time.
        if (event.target !== event.currentTarget) {
            return;
        }

        // Creates an entry below the focused one, or above it with Shift, the way a spreadsheet
        // adds a row. Uses the first creation button, since no button was pressed.
        const leading = itemCreationButtons?.[0];
        if (event.key === "Enter" && leading && !leading.disabled
                && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            add(leading.onCreateItem, event.shiftKey ? index : index + 1);
            return;
        }

        const control = event.ctrlKey || event.metaKey;
        const last = shown.length - 1;
        const to = placeFor(event, index, last);

        if (to === undefined) {
            // Left to the caller, whose entries can handle keys of their own.
            if (!control) {
                onItemKeyDown?.(shown[index], event);
            }

            // Down from the last entry moves onto the creation row. It holds no entry, so
            // Ctrl+Down moves nothing there.
            if (!control && event.key === "ArrowDown" && index === last) {
                event.preventDefault();
                adderRef.current?.querySelector<HTMLElement>(".tn-sortable-adder")?.focus();
            }

            return;
        }

        event.preventDefault();
        if (control) {
            moveItem(index, to);
        } else {
            focusEntry(to);
        }
    }, [ add, endDrag, focusEntry, itemCreationButtons, moveItem, onItemKeyDown, shown ]);

    const onAddKeyDown = useCallback((event: KeyboardEvent) => {
        // Moves back into the entries. Home and End address the first and last entry, as they do
        // on an entry: the creation row is a focus stop, not an entry.
        const control = event.ctrlKey || event.metaKey;
        const to = control || !shown.length ? undefined : lastPlaceFor(event, shown.length - 1);
        if (to === undefined) {
            return;
        }

        event.preventDefault();
        focusEntry(to);
    }, [ focusEntry, shown ]);

    /**
     * The drag handle, drawn on the edge `gripPlacement` names. An affordance rather than the hit
     * area: the segment handles the press, so only a mouse has to aim at the grip.
     */
    const grip = () => (
        <span
            className="tn-sortable-grip"
            title={t("sortable_card.reorder")}
            aria-hidden="true"
        >
            <svg viewBox="0 0 16 16">
                <line x1="3" y1="6" x2="13" y2="6" />
                <line x1="3" y1="10" x2="13" y2="10" />
            </svg>
        </span>
    );

    return (
        <Card className={clsx("tn-sortable-card", className)} {...card}>
            <div
                ref={listRef}
                className="tn-sortable-list"
                role="list"
                onPointerMove={(event) => {
                    const held = holdRef.current;
                    if (held?.pointerId === event.pointerId) {
                        // Gone before it settled, which is a finger on its way somewhere else.
                        held.at = event.clientY;
                        if (Math.hypot(event.clientX - held.from.x, event.clientY - held.from.y)
                                > TOUCH_SLACK_PX) {
                            cancelHold();
                        }

                        return;
                    }

                    if (dragRef.current?.pointerId === event.pointerId) {
                        event.preventDefault();
                        pointerRef.current = { x: event.clientX, y: event.clientY };
                        scroller.update(scrolledBy(listRef.current), event.clientX, event.clientY);
                        dragTo(event.clientY);
                    }
                }}
                // Prevented during a drag only, so a touch meant to scroll still scrolls.
                onTouchMove={(event) => {
                    if (dragRef.current) {
                        event.preventDefault();
                    }
                }}
                onPointerUp={(event) => finish(event, true)}
                onPointerCancel={(event) => finish(event, false)}
            >
                {shown.map((item, index) => (
                    <section
                        key={item.key}
                        data-key={item.key}
                        role="listitem"
                        tabIndex={0}
                        aria-current={item.key === selected ? "true" : undefined}
                        className={clsx("tn-card-section tn-sortable-segment", {
                            "tn-sortable-dragging": item.key === draggedKey,
                            "tn-sortable-selected": item.key === selected,
                            "tn-sortable-appearing": item.key === addedKey
                        })}
                        onFocus={() => select(item.key)}
                        onPointerDown={(event) => beginDrag(event, item.key)}
                        onKeyDown={(event) => onSegmentKeyDown(event, index)}
                        onAnimationEnd={() => setAddedKey(undefined)}
                    >
                        {gripPlacement === "start" && grip()}

                        <span className="tn-sortable-content">
                            {renderItem
                                ? renderItem(item, index)
                                : <>
                                    {item.icon && <Icon icon={item.icon} />}
                                    <span className="tn-sortable-caption">{item.caption}</span>
                                </>}
                        </span>

                        {gripPlacement === "end" && grip()}
                    </section>
                ))}

                {/* Transparent: each button paints itself, and the gaps show the card through. */}
                {!!itemCreationButtons?.length && (
                    <section
                        ref={adderRef}
                        className="tn-card-section tn-sortable-adders"
                        onKeyDown={onAddKeyDown}
                    >
                        {itemCreationButtons.map((button, index) => (
                            <Button
                                // The position in the row: two buttons can share a label.
                                key={index}
                                // Not a command button: the theme gives those a background, a
                                // shadow and a minimum width, none of which suit a segment.
                                kind="lowProfile"
                                className="tn-sortable-adder"
                                text={<>
                                    {button.icon && <Icon icon={button.icon} />}
                                    <span>{button.label}</span>
                                </>}
                                disabled={button.disabled}
                                onClick={(event) => add(button.onCreateItem, undefined, event)}
                            />
                        ))}
                    </section>
                )}
            </div>
        </Card>
    );
}

/**
 * How much of the viewport's top and bottom edges fixed chrome covers, a toolbar or a tab bar.
 *
 * A pointer cannot reach under a toolbar, so an edge behind one never triggers the edge scroll.
 * Measured at the middle of each edge and read once per drag.
 */
function fixedChrome(carried: HTMLElement): Insets {
    const insets = { top: 0, bottom: 0, left: 0, right: 0 };
    const middle = window.innerWidth / 2;

    for (const edge of [ "top", "bottom" ] as const) {
        const y = edge === "top" ? 1 : window.innerHeight - 1;

        for (const element of document.elementsFromPoint?.(middle, y) ?? []) {
            // Whatever contains the dragged segment covers nothing: the pointer is on it.
            if (element.contains(carried) || getComputedStyle(element).position !== "fixed") {
                continue;
            }

            const box = element.getBoundingClientRect();
            const depth = edge === "top" ? box.bottom : window.innerHeight - box.top;
            insets[edge] = Math.max(insets[edge], Math.min(depth, window.innerHeight / 3));
        }
    }

    return insets;
}

/**
 * The scrollable ancestors of the card, nearest first, which the edge scroller walks. A card in a
 * scrolling pane inside a scrolling page needs both.
 */
function scrolledBy(list: HTMLElement | null): ScrollTarget[] {
    const targets: ScrollTarget[] = [];

    for (let element = list?.parentElement; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        const scrolls = style.overflowY === "auto" || style.overflowY === "scroll";
        if (scrolls && element.scrollHeight > element.clientHeight) {
            targets.push({ element, axis: "y" });
        }
    }

    const page = document.scrollingElement;
    if (page instanceof HTMLElement && page.scrollHeight > page.clientHeight) {
        targets.push({ element: page, axis: "y" });
    }

    return targets;
}

/** A touch waiting out `TOUCH_HOLD_MS` before it becomes a drag. */
interface Hold {
    pointerId: number;
    /** Where the pointer went down, which movement is measured against. */
    from: { x: number, y: number };
    /** Where the pointer is now, which the drag starts from. */
    at: number;
    timer: number;
    /** Removes the document listeners watching for a lift outside the list. */
    stopWatching: () => void;
}

/** A drag in progress: where the segment started, and the order it has reached. */
interface Drag<T extends SortableItem> {
    key: string;
    pointerId: number;
    /** Where the pointer went down, against which everything after it is measured. */
    grabbedAt: number;
    /** The list's position on screen when the drag started, against which scrolling is measured. */
    at: number;
    /** The segment's offsetTop when the drag started. */
    from: number;
    height: number;
    /** The current order, which is what `onChange` reports. */
    order: T[];
    /** The order the drag started from, for telling whether it changed anything. */
    was: T[];
}

/**
 * The index the dragged segment now belongs at. The others are measured at their current
 * positions, which for one already sliding is the position it slides to.
 *
 * A segment gives way once the dragged one's near edge passes its middle: the bottom edge for a
 * segment below, the top edge for one above. Comparing middles would put the last slot exactly at
 * the clamp, leaving the last position unreachable.
 */
function orderFor<T extends SortableItem>(
    drag: Drag<T>, carried: HTMLElement, top: number,
    segmentOf: (key: string) => HTMLElement | null | undefined
) {
    const from = drag.order.findIndex((item) => item.key === drag.key);
    let to = 0;

    for (const item of drag.order) {
        const segment = item.key !== drag.key && segmentOf(item.key);
        if (!segment) {
            continue;
        }

        const middle = segment.offsetTop + segment.offsetHeight / 2;
        const isBelow = segment.offsetTop > carried.offsetTop;
        if (isBelow ? middle < top + drag.height : middle <= top) {
            to++;
        }
    }

    return from === to ? undefined : moved(drag.order, from, to);
}

/** The list with one entry moved, or `undefined` when the order would not change. */
function moved<T>(items: T[], from: number, to: number) {
    const place = Math.min(Math.max(to, 0), items.length - 1);
    if (from < 0 || from >= items.length || place === from) {
        return undefined;
    }

    const order = [ ...items ];
    order.splice(place, 0, ...order.splice(from, 1));
    return order;
}

/** Which entry a key addresses from the creation row. */
function lastPlaceFor(event: KeyboardEvent, last: number) {
    switch (event.key) {
        case "ArrowUp":
        case "End":
            return last;
        case "Home":
            return 0;
        default:
            return undefined;
    }
}

/**
 * Which index a key addresses, or `undefined` for a key the card ignores. The same keys move a
 * segment and step between them, Control telling them apart, as the board's cards do.
 */
function placeFor(event: KeyboardEvent, index: number, last: number) {
    switch (event.key) {
        case "ArrowUp":
            return index - 1 < 0 ? undefined : index - 1;
        case "ArrowDown":
            return index + 1 > last ? undefined : index + 1;
        case "Home":
            return index === 0 ? undefined : 0;
        case "End":
            return index === last ? undefined : last;
        default:
            return undefined;
    }
}
