import "./NotePane.css";

import { RefObject } from "preact";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { isMobile } from "../../../services/utils";
import { announceEmbeddedNoteClosing, EmbeddedNoteActions, EmbeddedNoteScope, EmbeddedNoteSurface, NoteColorAction, OpenNoteActions, SelectTitleOnFirstOpen, useEmbeddedNoteContext } from "../../EmbeddedNotePane";
import NoteDetail from "../../NoteDetail";
import PromotedAttributes from "../../PromotedAttributes";
import ActionButton from "../../react/ActionButton";
import { useNote } from "../../react/hooks";
import RelationMapApi from "./api";
import { confirmRemoveFromMap } from "./context_menu";

/** The note shown in the pane. `RelationMap` owns it, so it can open the pane on a note it created. */
export interface PaneSelection {
    noteId: string;
    /** The note was just created; the pane opens with its default title selected. */
    isNew?: boolean;
}

export interface NotePaneHandle {
    /** Closes the pane, giving the note's editor the chance to save first. */
    close(): void;
}

/**
 * Panel at the trailing edge of a relation map that shows the selected note's title, promoted
 * attributes and content for editing.
 */
export default function NotePane({ paneRef, noteIdsOnMap, mapApiRef, isReadOnly, selection, onSelect }: {
    paneRef: RefObject<NotePaneHandle | null>;
    /** IDs of the notes on the map. The pane closes when its note is not among them, and a link in
     *  the pane switches the pane only to a note among them. */
    noteIdsOnMap: string[];
    mapApiRef: RefObject<RelationMapApi | null>;
    /** Hides the color and remove buttons, leaving only the buttons that open the note. */
    isReadOnly: boolean;
    /** The note the pane shows, or `null` while the pane is closed. */
    selection: PaneSelection | null;
    onSelect(selection: PaneSelection | null): void;
}) {
    const note = useNote(selection?.noteId, true);
    const [ maximized, setMaximized ] = useState(false);
    const { noteContext, component: paneComponent, ntxId } = useEmbeddedNoteContext(note ?? undefined, PANE_NTX_ID_PREFIX);

    const closePane = useCallback(() => {
        void announceEmbeddedNoteClosing(paneComponent, ntxId);
        onSelect(null);
    }, [ paneComponent, ntxId, onSelect ]);
    useImperativeHandle<NotePaneHandle | null, NotePaneHandle | null>(paneRef, () => ({ close: closePane }), [ closePane ]);

    const followLink = useCallback((noteId: string) => {
        if (!noteIdsOnMap.includes(noteId)) return false;
        onSelect({ noteId });
        return true;
    }, [ noteIdsOnMap, onSelect ]);

    // Resets the maximized state when the pane closes, so the pane reopens at its normal width.
    useEffect(() => {
        if (!selection) setMaximized(false);
    }, [ selection ]);

    // Closes the pane when its note is removed from the map or deleted. A layout effect, so that
    // the editor is still mounted, and saves, when `closePane()` asks it to.
    const isOnMap = !!selection && noteIdsOnMap.includes(selection.noteId);
    useLayoutEffect(() => {
        if (selection && (!isOnMap || note === null)) {
            closePane();
        }
    }, [ selection, isOnMap, note, closePane ]);

    // On mobile, the `Modal` handles Escape itself.
    useEffect(() => {
        if (!selection || isMobile()) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") closePane();
        };
        // Capture phase, because `OverlayPanel` stops key presses inside it from bubbling.
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [ selection?.noteId, closePane ]);

    if (!note) return null;

    return (
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
    );
}

const PANE_NTX_ID_PREFIX = "_relation-map-note-pane";
