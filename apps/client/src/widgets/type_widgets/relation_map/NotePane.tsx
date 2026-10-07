import "./NotePane.css";

import { RefObject } from "preact";
import { useCallback, useEffect, useImperativeHandle, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { isMobile } from "../../../services/utils";
import { announceEmbeddedNoteClosing, EmbeddedNoteActions, EmbeddedNoteScope, EmbeddedNoteSurface, NoteColorAction, OpenNoteActions, SelectTitleOnFirstOpen, useEmbeddedNoteContext } from "../../EmbeddedNotePane";
import NoteDetail from "../../NoteDetail";
import PromotedAttributes from "../../PromotedAttributes";
import ActionButton from "../../react/ActionButton";
import { useNote } from "../../react/hooks";
import RelationMapApi from "./api";
import { confirmRemoveFromMap } from "./context_menu";

/** Which note the pane shows. Owned by the map, which opens the pane on a note it has just created. */
export interface PaneSelection {
    noteId: string;
    /** The note was just created, so the pane opens with its stock title selected. */
    isNew?: boolean;
}

export interface NotePaneHandle {
    /** Closes the pane, giving the note's editor the chance to save first. */
    close(): void;
}

/**
 * The note pane standing against the trailing edge of a relation map while a box is selected: the
 * note's title, promoted attributes and content, editable in place.
 */
export default function NotePane({ paneRef, noteIdsOnMap, mapApiRef, isReadOnly, selection, onSelect }: {
    paneRef: RefObject<NotePaneHandle | null>;
    /** The notes the map shows, which keep the pane open and which a link inside it can switch to. */
    noteIdsOnMap: string[];
    mapApiRef: RefObject<RelationMapApi | null>;
    /** The map cannot be edited, so the pane offers only the ways of opening the note. */
    isReadOnly: boolean;
    /** The note the pane shows, or `null` while the pane is closed. */
    selection: PaneSelection | null;
    onSelect(selection: PaneSelection | null): void;
}) {
    const note = useNote(selection?.noteId, true);
    const [ maximized, setMaximized ] = useState(false);
    const { noteContext, component: paneComponent } = useEmbeddedNoteContext(note ?? undefined, PANE_NTX_ID_PREFIX);

    const closePane = useCallback(() => {
        if (noteContext.ntxId) {
            void announceEmbeddedNoteClosing(paneComponent, noteContext.ntxId);
        }
        onSelect(null);
    }, [ paneComponent, noteContext, onSelect ]);
    useImperativeHandle<NotePaneHandle | null, NotePaneHandle | null>(paneRef, () => ({ close: closePane }), [ closePane ]);

    const followLink = useCallback((noteId: string) => {
        if (!noteIdsOnMap.includes(noteId)) return false;
        onSelect({ noteId });
        return true;
    }, [ noteIdsOnMap, onSelect ]);

    // The pane opens beside the map each time, however it was left.
    useEffect(() => {
        if (!selection) setMaximized(false);
    }, [ selection ]);

    // A note taken off the map, or deleted, closes the pane.
    const isOnMap = !!selection && noteIdsOnMap.includes(selection.noteId);
    useEffect(() => {
        if (selection && (!isOnMap || note === null)) {
            closePane();
        }
    }, [ selection, isOnMap, note, closePane ]);

    // A phone's dialog answers Escape itself.
    useEffect(() => {
        if (!selection || isMobile()) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") closePane();
        };
        // Captured, since `OverlayPanel` stops key presses made inside it from bubbling.
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [ selection?.noteId, closePane ]);

    if (!note || !isOnMap) return null;

    return (
        // `relation-map-note-pane-host` keeps the wheel, double clicks and touches made in the pane
        // from reaching `panzoom`, which listens on the whole map.
        <div
            className="relation-map-note-pane-host"
            onWheel={stopPropagation}
            onDblClick={stopPropagation}
            onTouchStart={stopPropagation}
        >
            <EmbeddedNoteScope component={paneComponent} noteContext={noteContext}>
                <EmbeddedNoteSurface
                    note={note}
                    panelClassName="relation-map-note-pane"
                    sheetClassName="relation-map-note-sheet"
                    bodyClassName="relation-map-note-pane-body"
                    closeText={t("relation_map.close_note_pane")}
                    maximize={{
                        maximized,
                        onChange: setMaximized,
                        expandText: t("relation_map.expand_note_pane"),
                        restoreText: t("relation_map.restore_note_pane")
                    }}
                    onClose={closePane}
                    onFollowLink={followLink}
                >
                    <EmbeddedNoteActions>
                        <OpenNoteActions note={note} />
                        {!isReadOnly && <>
                            <NoteColorAction note={note} title={t("relation_map.note_color")} />
                            <ActionButton
                                className="tn-embedded-note-remove"
                                icon="bx bx-trash"
                                text={t("relation_map.remove_from_map")}
                                onClick={() => void confirmRemoveFromMap(note, mapApiRef)}
                            />
                        </>}
                    </EmbeddedNoteActions>
                    <PromotedAttributes />
                    <NoteDetail />
                </EmbeddedNoteSurface>
                {selection?.isNew && <SelectTitleOnFirstOpen />}
            </EmbeddedNoteScope>
        </div>
    );
}

const PANE_NTX_ID_PREFIX = "_relation-map-note-pane";

function stopPropagation(e: Event) {
    e.stopPropagation();
}
