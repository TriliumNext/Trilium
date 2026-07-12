import { CaptureUpdateAction, restoreElements, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import { ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { RefObject } from "preact";
import { JSX } from "preact";
import { useCallback } from "preact/hooks";

/** Default size of an embeddable created by dropping a note onto the canvas. */
const EMBEDDABLE_WIDTH = 480;
const EMBEDDABLE_HEIGHT = 320;
/** Offset between successive embeddables when several notes are dropped at once. */
const STACK_OFFSET = 24;

/**
 * Lets the user drag notes from the note tree onto the canvas to create note embeddables (rendered
 * by {@link NoteEmbeddable}). The note tree puts `[{ noteId, ... }]` JSON into the drag's
 * `text/plain` payload; we read it, translate the drop point into scene coordinates, and insert an
 * `embeddable` element linking to each note (`root/<noteId>`).
 *
 * The handlers run in the capture phase. During `dragover` the browser only exposes the available
 * data *types*, not the data, so we can't yet tell a note drag from any other `text/plain` drag — we
 * accept (and stop propagation for) every `text/plain` drag to claim the drop. On `drop` the actual
 * payload is readable: a recognized note payload is handled here and kept from Excalidraw, while any
 * other `text/plain` drop falls through to Excalidraw's own handling.
 */
export default function useCanvasNoteDrop(apiRef: RefObject<ExcalidrawImperativeAPI>, isReadOnly: boolean) {
    const onDragOverCapture = useCallback((e: JSX.TargetedDragEvent<HTMLElement>) => {
        if (isReadOnly || !e.dataTransfer?.types.includes("text/plain")) {
            return;
        }
        // Signal that we accept the drop so the browser fires a `drop` event here.
        e.preventDefault();
        e.stopPropagation();
    }, [isReadOnly]);

    const onDropCapture = useCallback((e: JSX.TargetedDragEvent<HTMLElement>) => {
        const api = apiRef.current;
        if (isReadOnly || !api) {
            return;
        }

        const noteIds = parseDroppedNoteIds(e.dataTransfer?.getData("text/plain"));
        if (!noteIds.length) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const { x, y } = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());

        // `restoreElements` (rather than `convertToExcalidrawElements`) normalizes these partial
        // elements: Excalidraw's element factory is skipped for embeddables, so a bare skeleton
        // would omit `backgroundColor`/`strokeColor`/`seed`/etc. and crash hit-testing. restore
        // fills every default (and generates fresh ids). We assert to the concrete embeddable type
        // (a superset of these literals); an embeddable array is a valid restoreElements input.
        const partialElements = noteIds.map((noteId, i) => ({
            type: "embeddable",
            x: x + i * STACK_OFFSET,
            y: y + i * STACK_OFFSET,
            width: EMBEDDABLE_WIDTH,
            height: EMBEDDABLE_HEIGHT,
            link: `root/${noteId}`
        })) as ExcalidrawEmbeddableElement[];

        const newElements = restoreElements(partialElements, null);
        // A drop is a user action and must be its own undo step; without IMMEDIATELY it would
        // only be captured as part of the next action (#7148).
        api.updateScene({ elements: [...api.getSceneElements(), ...newElements], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    }, [apiRef, isReadOnly]);

    return { onDragOverCapture, onDropCapture };
}

/** Extracts note IDs from the note tree's drag payload, returning `[]` for anything unrecognized. */
function parseDroppedNoteIds(payload: string | undefined): string[] {
    if (!payload) {
        return [];
    }

    try {
        const parsed = JSON.parse(payload);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .map((entry) => (entry && typeof entry.noteId === "string" ? entry.noteId : null))
            .filter((noteId): noteId is string => noteId !== null);
    } catch {
        return [];
    }
}
