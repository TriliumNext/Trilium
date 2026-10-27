import "./LauncherDropTarget.css";

import { createPortal, type RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";

import branches from "../../services/branches";
import froca from "../../services/froca";
import { createEdgeScroller } from "../react/edge_scroll";
import { TREE_CLIPBOARD_TYPE } from "../react/hooks";

/** How near an end of the bar a drag starts to scroll it, in pixels. */
const EDGE_SCROLL_MARGIN = 40;

/** How fast the bar scrolls with the pointer at its very end, in pixels a second. */
const EDGE_SCROLL_SPEED = 600;

/** How long the drop target waits for the next `dragover` before it treats the drag as ended. */
const DRAG_TIMEOUT = 1000;

/** The root of the hidden launchers, for each root of the visible ones. */
const AVAILABLE_LAUNCHERS_ROOTS: Record<string, string> = {
    _lbVisibleLaunchers: "_lbAvailableLaunchers",
    _lbMobileVisibleLaunchers: "_lbMobileAvailableLaunchers"
};

interface LauncherDropTargetProps {
    /** The bar element; each launcher is rendered in one of its `.launcher-slot` children. */
    containerRef: RefObject<HTMLElement | null>;
    /** The note whose children are the launchers in the bar. */
    parentNoteId: string;
    isHorizontalLayout: boolean;
}

/**
 * Accepts notes dragged from the note tree onto the launch bar. A line shows where they go; a drop
 * clones them there, or moves them when they are already in the launch bar.
 */
export default function LauncherDropTarget({
    containerRef, parentNoteId, isHorizontalLayout
}: LauncherDropTargetProps) {
    const [ marker, setMarker ] = useState<MarkerBox | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const axis = isHorizontalLayout ? "x" : "y";
        const scroller = createEdgeScroller({
            margin: EDGE_SCROLL_MARGIN,
            speed: EDGE_SCROLL_SPEED
        });
        let pointer: { x: number, y: number } | null = null;
        let timeout: ReturnType<typeof setTimeout> | undefined;

        const update = () => {
            if (pointer) {
                setMarker(locateDrop(container, isHorizontalLayout, pointer.x, pointer.y).marker);
            }
        };

        const stop = () => {
            clearTimeout(timeout);
            pointer = null;
            scroller.stop();
            setMarker(null);
        };

        const onDragOver = (e: DragEvent) => {
            if (!isNoteDrag(e)) return;

            // Accepts the drop.
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "copy";
            }

            pointer = { x: e.clientX, y: e.clientY };
            scroller.update([ { element: container, axis } ], e.clientX, e.clientY);
            update();

            // Stops the edge scrolling if the drag ends without a `dragleave` or `drop` here.
            clearTimeout(timeout);
            timeout = setTimeout(stop, DRAG_TIMEOUT);
        };

        const onDragLeave = (e: DragEvent) => {
            if (e.relatedTarget instanceof Node && container.contains(e.relatedTarget)) return;
            stop();
        };

        const onDrop = (e: DragEvent) => {
            if (!isNoteDrag(e)) return;

            e.preventDefault();
            const { index, noteIds } =
                locateDrop(container, isHorizontalLayout, e.clientX, e.clientY);
            stop();

            const droppedNoteIds = readDroppedNoteIds(e);
            const anchor = getDropAnchor(noteIds, index, droppedNoteIds);
            void dropNotesOnLaunchBar(droppedNoteIds, parentNoteId, anchor);
        };

        container.addEventListener("dragenter", onDragOver);
        container.addEventListener("dragover", onDragOver);
        container.addEventListener("dragleave", onDragLeave);
        container.addEventListener("drop", onDrop);
        container.addEventListener("scroll", update, { passive: true });

        return () => {
            container.removeEventListener("dragenter", onDragOver);
            container.removeEventListener("dragover", onDragOver);
            container.removeEventListener("dragleave", onDragLeave);
            container.removeEventListener("drop", onDrop);
            container.removeEventListener("scroll", update);
            stop();
        };
    }, [ containerRef, parentNoteId, isHorizontalLayout ]);

    return marker && createPortal(
        <div
            className="launcher-drop-indicator"
            data-axis={isHorizontalLayout ? "x" : "y"}
            style={{
                left: `${marker.left}px`,
                top: `${marker.top}px`,
                width: `${marker.width}px`,
                height: `${marker.height}px`
            }}
        />,
        document.body
    );
}

/** An extent along the bar, with coordinates growing in reading order. */
export interface Span {
    start: number;
    end: number;
}

/** Where the drop indicator goes on the screen: a box of zero thickness along the bar. */
interface MarkerBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * Finds where an item dropped at `pointer` goes among `spans`, which are in their order along the
 * bar.
 *
 * @returns the index to insert at, and the position of the line between the two neighbors,
 * kept within `bounds`.
 */
export function findInsertionPoint(spans: Span[], pointer: number, bounds: Span) {
    let index = spans.findIndex((span) => pointer < (span.start + span.end) / 2);
    if (index === -1) {
        index = spans.length;
    }

    const previous: Span | undefined = spans[index - 1];
    const next: Span | undefined = spans[index];
    let position: number;
    if (previous && next) {
        position = (previous.end + next.start) / 2;
    } else if (next) {
        // At either end, the line is half a gap out from the item, as it is between two items.
        position = next.start - gapAfter(spans, 0) / 2;
    } else if (previous) {
        position = previous.end + gapAfter(spans, spans.length - 2) / 2;
    } else {
        position = bounds.start;
    }

    return {
        index,
        position: Math.min(Math.max(position, bounds.start), bounds.end)
    };
}

/** The space between the span at `index` and the next one; 0 without both. */
function gapAfter(spans: Span[], index: number) {
    const span: Span | undefined = spans[index];
    const next: Span | undefined = spans[index + 1];
    return span && next ? Math.max(0, next.start - span.end) : 0;
}

export type DropAnchor =
    | { side: "before" | "after", noteId: string }
    | { side: "end" };

/**
 * Picks the launcher that dropped notes are placed next to.
 *
 * @param noteIds the launchers shown in the bar, in order.
 * @param index where the drop goes among them.
 * @param droppedNoteIds the notes being dropped, which can already be in the bar and so cannot be
 * the anchor.
 */
export function getDropAnchor(
    noteIds: string[],
    index: number,
    droppedNoteIds: string[]
): DropAnchor {
    const isDropped = (noteId: string) => droppedNoteIds.includes(noteId);

    const next = noteIds.slice(index).find((noteId) => !isDropped(noteId));
    if (next) {
        return { side: "before", noteId: next };
    }

    const previous = noteIds.slice(0, index).findLast((noteId) => !isDropped(noteId));
    if (previous) {
        return { side: "after", noteId: previous };
    }

    return { side: "end" };
}

/**
 * Puts the notes into the launch bar under `parentNoteId`, next to `anchor`, in their order. A note
 * that is already a launcher of this bar, shown or hidden, is moved there; any other note is cloned
 * there. A launcher of another bar is skipped.
 */
export async function dropNotesOnLaunchBar(
    noteIds: string[],
    parentNoteId: string,
    anchor: DropAnchor
) {
    const anchorBranchId = anchor.side === "end"
        ? undefined
        : froca.getNoteFromCache(anchor.noteId)?.parentToBranch[parentNoteId];
    const availableRootId = AVAILABLE_LAUNCHERS_ROOTS[parentNoteId];
    // Placing each note right after the anchor reverses their order, so the last one goes first.
    const orderedNoteIds = anchor.side === "after" ? [ ...noteIds ].reverse() : noteIds;

    for (const noteId of orderedNoteIds) {
        const note = await froca.getNote(noteId);
        if (!note) continue;

        const branchId = note.parentToBranch[parentNoteId] ?? note.parentToBranch[availableRootId];
        if (!branchId && note.type === "launcher") continue;

        if (anchor.side === "before" && anchorBranchId) {
            await (branchId
                ? branches.moveBeforeBranch([ branchId ], anchorBranchId)
                : branches.cloneNoteBefore(noteId, anchorBranchId));
        } else if (anchor.side === "after" && anchorBranchId) {
            await (branchId
                ? branches.moveAfterBranch([ branchId ], anchorBranchId)
                : branches.cloneNoteAfter(noteId, anchorBranchId));
        } else if (branchId) {
            const parentBranchId = froca.getNoteFromCache(parentNoteId)?.getParentBranchIds()[0];
            if (parentBranchId) {
                await branches.moveToParentNote([ branchId ], parentBranchId);
            }
        } else {
            await branches.cloneNoteToParentNote(noteId, parentNoteId);
        }
    }
}

/** Whether the drag contains notes from the note tree, the only drag the launch bar accepts. */
function isNoteDrag(e: DragEvent) {
    return !!e.dataTransfer?.types.includes(TREE_CLIPBOARD_TYPE);
}

function readDroppedNoteIds(e: DragEvent): string[] {
    try {
        const dropped: unknown = JSON.parse(e.dataTransfer?.getData("text") ?? "");
        if (!Array.isArray(dropped)) {
            return [];
        }
        return dropped
            .map((item: { noteId?: unknown }) => item?.noteId)
            .filter((noteId): noteId is string => typeof noteId === "string");
    } catch {
        return [];
    }
}

/** Measures the bar for a drop at `x`, `y`: where it goes, and where the indicator is drawn. */
function locateDrop(container: HTMLElement, isHorizontalLayout: boolean, x: number, y: number) {
    // In a right-to-left bar the launchers run leftwards, so x coordinates are negated.
    const isRtl = isHorizontalLayout && getComputedStyle(container).direction === "rtl";
    const toSpan = (rect: DOMRect): Span => {
        if (!isHorizontalLayout) {
            return { start: rect.top, end: rect.bottom };
        }
        return isRtl
            ? { start: -rect.right, end: -rect.left }
            : { start: rect.left, end: rect.right };
    };

    const launchers = measureLaunchers(container, toSpan);
    const box = container.getBoundingClientRect();
    const pointer = isHorizontalLayout ? (isRtl ? -x : x) : y;
    const { index, position } = findInsertionPoint(launchers, pointer, toSpan(box));

    const marker: MarkerBox = isHorizontalLayout
        ? { left: isRtl ? -position : position, top: box.top, width: 0, height: box.height }
        : { left: box.left, top: position, width: box.width, height: 0 };

    return { index, noteIds: launchers.map((launcher) => launcher.noteId), marker };
}

/** The extent of each launcher that renders something, in the order of the bar. */
function measureLaunchers(container: HTMLElement, toSpan: (rect: DOMRect) => Span) {
    const launchers: (Span & { noteId: string })[] = [];

    for (const slot of container.children) {
        const noteId = slot instanceof HTMLElement ? slot.dataset.launcherId : undefined;
        if (!noteId) continue;

        let span: Span | null = null;
        for (const child of slot.children) {
            const rect = child.getBoundingClientRect();
            if (!rect.width && !rect.height) continue;

            const childSpan = toSpan(rect);
            span = span
                ? {
                    start: Math.min(span.start, childSpan.start),
                    end: Math.max(span.end, childSpan.end)
                }
                : childSpan;
        }

        if (span) {
            launchers.push({ noteId, ...span });
        }
    }

    return launchers;
}
