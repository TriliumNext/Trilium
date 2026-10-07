import { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import toast from "../../../services/toast";
import RelationMapApi, { MapDataNoteEntry } from "./api";
import { type PendingRelation, PENDING_CONNECTION_ID } from "./Connections";
import type { AskRelationName } from "./RelationNamePopover";
import { CLICK_TOLERANCE, getMousePosition, idToNoteId } from "./utils";

/**
 * Moves a box with the pointer. The box follows the pointer once it has moved more than
 * `CLICK_TOLERANCE`, so a click still selects it, and the map saves the position on release.
 * `dragged` is the box's position while it is dragged, which overrides the saved one.
 */
export function useBoxDragging({ containerRef, mapApiRef, getScale }: {
    containerRef: RefObject<HTMLDivElement | null>;
    mapApiRef: RefObject<RelationMapApi | null>;
    /** The scale the map is zoomed to. */
    getScale(): number;
}) {
    const [ dragged, setDragged ] = useState<MapDataNoteEntry | null>(null);
    const track = usePointerTracking();

    const startDrag = useCallback((e: PointerEvent, entry: MapDataNoteEntry) => {
        const container = containerRef.current;
        if (!container || e.button !== 0 || !e.isPrimary) return;

        const zoom = getScale();
        let position: MapDataNoteEntry | null = null;
        track(e.pointerId, {
            onMove(moveEvent) {
                const dx = moveEvent.clientX - e.clientX;
                const dy = moveEvent.clientY - e.clientY;
                if (!position && Math.hypot(dx, dy) <= CLICK_TOLERANCE) return;

                position = { noteId: entry.noteId, x: entry.x + dx / zoom, y: entry.y + dy / zoom };
                setDragged(position);
            },
            onEnd(endEvent) {
                if (position && endEvent.type === "pointerup") {
                    mapApiRef.current?.moveNote(position.noteId, position.x, position.y);
                }
                setDragged(null);
            }
        });
    }, [ containerRef, mapApiRef, getScale, track ]);

    return { dragged, startDrag };
}

/**
 * Draws a new relation from the endpoint of a box. The relation follows the pointer and snaps to the
 * box under it; on release over a box, it stays drawn while `askRelationName` asks for its name, and
 * the relation is created with that name. A release within `CLICK_TOLERANCE` of the press creates
 * nothing, so a click on the endpoint does not start a relation from the box to itself.
 */
export function useRelationDrawing({ containerRef, mapApiRef, getScale, askRelationName }: {
    containerRef: RefObject<HTMLDivElement | null>;
    mapApiRef: RefObject<RelationMapApi | null>;
    /** The scale the map is zoomed to. */
    getScale(): number;
    askRelationName: AskRelationName;
}) {
    const [ pending, setPending ] = useState<PendingRelation | null>(null);
    const track = usePointerTracking();

    const startDrawing = useCallback((e: PointerEvent, sourceNoteId: string) => {
        const container = containerRef.current;
        if (!container || e.button !== 0 || !e.isPrimary) return;

        const zoom = getScale();
        const pendingAt = (event: PointerEvent): PendingRelation => ({
            sourceNoteId,
            targetNoteId: boxNoteIdAt(event, container),
            pointer: getMousePosition(event, container, zoom)
        });
        setPending(pendingAt(e));

        track(e.pointerId, {
            onMove: (moveEvent) => setPending(pendingAt(moveEvent)),
            async onEnd(endEvent) {
                const dropped = pendingAt(endEvent);
                const { targetNoteId } = dropped;
                const isClick = Math.hypot(endEvent.clientX - e.clientX, endEvent.clientY - e.clientY) <= CLICK_TOLERANCE;
                if (endEvent.type !== "pointerup" || !targetNoteId || isClick) {
                    setPending(null);
                    return;
                }

                setPending(dropped);
                const name = await askRelationName(
                    () => container.querySelector(`[data-connection-id="${PENDING_CONNECTION_ID}"]`));
                if (name?.trim() && mapApiRef.current
                    && !await mapApiRef.current.connect(name, sourceNoteId, targetNoteId)) {
                    toast.showError(t("relation_map.connection_exists", { name }));
                }
                setPending(null);
            }
        });
    }, [ containerRef, mapApiRef, getScale, askRelationName, track ]);

    return { pending, startDrawing };
}

/**
 * Follows the pointer `pointerId` on the window until it is released or the gesture is canceled,
 * so the gesture continues outside the box it started on, and ignores any other pointer, such as a
 * second finger. Stops following on unmount.
 */
function usePointerTracking() {
    const stopRef = useRef<() => void>(null);
    useEffect(() => () => stopRef.current?.(), []);

    return useCallback((pointerId: number, { onMove, onEnd }: {
        onMove(e: PointerEvent): void;
        onEnd(e: PointerEvent): void;
    }) => {
        stopRef.current?.();
        const move = (e: PointerEvent) => {
            if (e.pointerId === pointerId) onMove(e);
        };
        const end = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            stop();
            onEnd(e);
        };
        const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            stopRef.current = null;
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        stopRef.current = stop;
    }, []);
}

/**
 * The note of the box under the pointer. Read from the point rather than from the event's target,
 * because a touch keeps sending events to the element it started on.
 */
function boxNoteIdAt(e: PointerEvent, container: HTMLElement) {
    const box = document.elementFromPoint(e.clientX, e.clientY)?.closest(".note-box:not(.relation-map-ghost-note)");
    return box && container.contains(box) ? idToNoteId(box.id) : undefined;
}
