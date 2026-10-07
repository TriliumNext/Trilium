import "../../note_card.css";
import "./NoteBox.css";

import clsx from "clsx";
import { RefObject } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { useNoteColorClass, useNoteIcon, useNoteProperty } from "../../react/hooks";
import RelationMapApi, { MapDataNoteEntry } from "./api";
import { buildNoteContextMenuHandler } from "./context_menu";
import { JsPlumbItem } from "./jsplumb";
import { idToNoteId, noteIdToId } from "./utils";

const NOTE_BOX_SOURCE_CONFIG = {
    filter: ".endpoint",
    anchor: "Continuous",
    connectorStyle: { strokeWidth: 1 },
    connectionType: "basic",
    extract: {
        action: "the-action"
    }
};

const NOTE_BOX_TARGET_CONFIG = {
    dropOptions: { hoverClass: "dragHover" },
    anchor: "Continuous",
    allowLoopback: true
};

interface NoteBoxProps extends MapDataNoteEntry {
    mapApiRef: RefObject<RelationMapApi | null>;
    /** The note is open in the note pane. */
    selected?: boolean;
    /** The map cannot be edited, so the context menu offers no color picker. */
    isReadOnly: boolean;
}

export function NoteBox({ noteId, x, y, mapApiRef, selected, isReadOnly }: NoteBoxProps) {
    const [ note, setNote ] = useState<FNote | null>();
    const title = useNoteProperty(note, "title");
    const icon = useNoteIcon(note);
    const colorClass = useNoteColorClass(note);
    useEffect(() => {
        froca.getNote(noteId).then(setNote);
    }, [ noteId ]);

    const contextMenuHandler = useMemo(() => {
        return buildNoteContextMenuHandler(note, mapApiRef, isReadOnly);
    }, [ note, isReadOnly ]);

    return note && (
        <JsPlumbItem
            id={noteIdToId(noteId)}
            className="note-box tn-note-card"
            dynamicClassName={clsx(colorClass, note.getCssClass(), selected && "selected")}
            onContextMenu={contextMenuHandler}
            x={x} y={y}
            draggable={{
                start() {},
                drag() {},
                stop(params) {
                    const noteId = idToNoteId(params.el.id);
                    const [ x, y ] = params.pos;
                    mapApiRef.current?.moveNote(noteId, x, y);
                },
            }}
            sourceConfig={NOTE_BOX_SOURCE_CONFIG}
            targetConfig={NOTE_BOX_TARGET_CONFIG}
        >
            <span className={clsx("note-box-icon", icon)} />
            <span className="note-box-title">{title}</span>
            <div className="endpoint" title={t("relation_map.start_dragging_relations")} />
        </JsPlumbItem>
    )
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
