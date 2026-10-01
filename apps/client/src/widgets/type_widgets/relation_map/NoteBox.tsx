import { useEffect, useMemo, useState } from "preact/hooks";
import { useNoteProperty } from "../../react/hooks";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { JsPlumbItem } from "./jsplumb";
import FNote from "../../../entities/fnote";
import RelationMapApi, { MapDataNoteEntry } from "./api";
import { RefObject } from "preact";
import NoteLink from "../../react/NoteLink";
import { idToNoteId, noteIdToId } from "./utils";
import { buildNoteContextMenuHandler } from "./context_menu";

const NOTE_BOX_SOURCE_CONFIG = {
    filter: ".endpoint",
    anchor: "Continuous",
    connectorStyle: { stroke: "#000", strokeWidth: 1 },
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
    /** Opens this note as the center of the map, or the menu of a collapsed relation. */
    onFocus: (noteId: string, event: MouseEvent) => void;
    /** Right-click puts a folded fact back into its two notes. */
    onUnfold?: () => void;
}

export function NoteBox({ noteId, x, y, mapApiRef, onFocus, onUnfold }: NoteBoxProps) {
    const [ note, setNote ] = useState<FNote | null>();
    const title = useNoteProperty(note, "title");
    useEffect(() => {
        froca.getNote(noteId).then(setNote);
    }, [ noteId ]);

    const contextMenuHandler = useMemo(() => {
        return buildNoteContextMenuHandler(note, mapApiRef);
    }, [ note ]);

    return note && (
        <JsPlumbItem
            id={noteIdToId(noteId)}
            className={`note-box ${note?.getCssClass()}`}
            onContextMenu={(event) => {
                if (!onUnfold) {
                    contextMenuHandler(event);
                    return;
                }
                event.preventDefault();
                onUnfold();
            }}
            x={x} y={y}
            onClick={(event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (!target?.closest("a")) {
                    return;
                }
                if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                onFocus(noteId, event);
            }}
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
            <NoteLink className="title" title={title} notePath={noteId} noTnLink noContextMenu />
            <div className="endpoint" title={t("relation_map.start_dragging_relations")} />
        </JsPlumbItem>
    )
}
