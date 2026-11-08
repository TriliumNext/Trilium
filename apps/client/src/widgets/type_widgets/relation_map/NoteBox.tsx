import "../../note_card.css";
import "./NoteBox.css";

import clsx from "clsx";
import { RefObject } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { useNoteColorClass, useNoteIcon, useNoteProperty } from "../../react/hooks";
import RelationMapApi, { MapDataNoteEntry } from "./api";
import { buildNoteContextMenuHandler } from "./context_menu";
import { noteIdToId } from "./utils";

interface NoteBoxProps extends MapDataNoteEntry {
    mapApiRef: RefObject<RelationMapApi | null>;
    /** The note is open in the note pane. */
    selected?: boolean;
    /** A relation of the note is hovered. */
    highlighted?: boolean;
    /** A relation being drawn would end on this box. */
    dropTarget?: boolean;
    /** The map cannot be edited, so the context menu offers no color picker. */
    isReadOnly: boolean;
    /** Starts dragging the box, or drawing a relation from its `.endpoint`. */
    onPointerDown(e: PointerEvent): void;
    /** Reports the box's size, which the relations need to end on its border. */
    onResize(noteId: string, size: { width: number; height: number }): void;
}

export function NoteBox({ noteId, x, y, mapApiRef, selected, highlighted, dropTarget, isReadOnly, onPointerDown, onResize }: NoteBoxProps) {
    const [ note, setNote ] = useState<FNote | null>();
    const title = useNoteProperty(note, "title");
    const icon = useNoteIcon(note);
    const colorClass = useNoteColorClass(note);
    const boxRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        froca.getNote(noteId).then(setNote);
    }, [ noteId ]);

    const contextMenuHandler = useMemo(() => {
        return buildNoteContextMenuHandler(note, mapApiRef, isReadOnly);
    }, [ note, isReadOnly ]);

    useLayoutEffect(() => {
        const box = boxRef.current;
        if (!box) return;

        const report = () => onResize(noteId, { width: box.offsetWidth, height: box.offsetHeight });
        report();
        const observer = new ResizeObserver(report);
        observer.observe(box);
        return () => observer.disconnect();
    }, [ note, noteId, onResize ]);

    return note && (
        <div
            ref={boxRef}
            id={noteIdToId(noteId)}
            className={clsx(
                "note-box tn-note-card", colorClass, note.getCssClass(),
                selected && "selected", highlighted && "highlighted", dropTarget && "drop-target"
            )}
            style={{ left: `${x}px`, top: `${y}px` }}
            onContextMenu={contextMenuHandler}
            onPointerDown={onPointerDown}
        >
            <span className={clsx("note-box-icon", icon)} />
            <span className="note-box-title">{title}</span>
            {!isReadOnly && <div className="endpoint" title={t("relation_map.start_dragging_relations")} />}
        </div>
    );
}

/**
 * Translucent box that follows the pointer while the map is in placement mode. `useNotePlacement`
 * sets its `left`/`top` directly on the element, so moving the pointer does not re-render.
 */
export function GhostNoteBox({ elementRef }: { elementRef: RefObject<HTMLDivElement | null> }) {
    return (
        <div ref={elementRef} className="note-box tn-note-card relation-map-ghost-note" aria-hidden="true">
            <span className="note-box-icon bx bx-note" />
            <span className="note-box-title">{t("relation_map.default_new_note_title")}</span>
        </div>
    );
}
