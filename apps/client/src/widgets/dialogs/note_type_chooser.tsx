import { useEffect, useRef, useState } from "preact/hooks";

import type { MenuCommandItem, MenuItem } from "../../menus/context_menu";
import type { TreeCommandNames } from "../../menus/tree_context_menu";
import { t } from "../../services/i18n";
import type { Suggestion } from "../../services/note_autocomplete";
import type { NotePresetId } from "../../services/note_presets";
import note_types from "../../services/note_types";
import FormGroup from "../react/FormGroup";
import { useTriliumEvent } from "../react/hooks";
import Menu from "../react/Menu";
import Modal from "../react/Modal";
import NoteAutocomplete from "../react/NoteAutocomplete";

export interface ChooseNoteTypeResponse {
    success: boolean;
    noteType?: string;
    /** The MIME type of the note, for a code note of a given language. */
    mime?: string;
    templateNoteId?: string;
    notePreset?: NotePresetId;
    notePath?: string;
    /** Extra parents to clone the created note into, from the template's default parents. */
    cloneToNoteIds?: string[];
}

export type ChooseNoteTypeCallback = (data: ChooseNoteTypeResponse) => void;

/**
 * Asks what a new note is made from and where it goes. The note types are the menu the note tree
 * offers to insert notes from, its submenus and filter included, standing in the dialog's flow.
 */
export default function NoteTypeChooserDialogComponent() {
    const [ callback, setCallback ] = useState<ChooseNoteTypeCallback>();
    const [ shown, setShown ] = useState(false);
    const [ parentNote, setParentNote ] = useState<Suggestion | null>();
    const [ noteTypes, setNoteTypes ] = useState<MenuItem<TreeCommandNames>[]>();
    const [ listHost, setListHost ] = useState<HTMLDivElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    /**
     * Whether the user moved to another field before the note types arrived, which the menu then
     * leaves focus in. Until then it takes focus at Text, so Enter creates a text note.
     */
    const userMovedFocus = useRef(false);

    useTriliumEvent("chooseNoteType", ({ callback }) => {
        userMovedFocus.current = false;
        setCallback(() => callback);
        setShown(true);
    });

    useEffect(() => {
        note_types.loadNoteTypeData().then((data) => setNoteTypes(note_types.buildNoteTypeItems(data)));
    }, []);

    /** A press or a key anywhere in the dialog but the menu is the user moving focus themselves. */
    function onUserGesture(e: Event) {
        if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
        userMovedFocus.current = true;
    }

    function onSelect(item: MenuCommandItem<TreeCommandNames>, e: MouseEvent | KeyboardEvent) {
        // A row of its own, such as the one opening the code languages' options.
        if (item.handler) {
            item.handler(item, e);
            setShown(false);
            return;
        }
        // A submenu's row that makes nothing itself.
        if (!item.type) return;

        callback?.({
            success: true,
            noteType: item.type,
            mime: item.mime,
            templateNoteId: item.templateNoteId,
            notePreset: item.notePreset,
            notePath: parentNote?.notePath
        });
        setShown(false);
    }

    return (
        <Modal
            title={t("note_type_chooser.modal_title")}
            className="note-type-chooser-dialog"
            size="md"
            zIndex={1100} // note type chooser needs to be higher than other dialogs from which it is triggered, e.g. "add link"
            scrollable
            // Bootstrap focuses the dialog itself once shown, which the menu takes back.
            onShown={() => {
                if (!userMovedFocus.current) menuRef.current?.focus({ preventScroll: true });
            }}
            onHidden={() => {
                callback?.({ success: false });
                setShown(false);
            }}
            show={shown}
            stackable
        >
            {/* The menu stands in here too; `onUserGesture` leaves its presses and keys to it. */}
            <div onPointerDown={onUserGesture} onKeyDown={onUserGesture}>
                <FormGroup name="parent-note" label={t("note_type_chooser.change_path_prompt")}>
                    <NoteAutocomplete
                        onChange={setParentNote}
                        placeholder={t("note_type_chooser.search_placeholder")}
                        opts={{
                            allowCreatingNotes: false,
                            hideGoToSelectedNoteButton: true,
                            allowJumpToSearchNotes: false,
                        }}
                    />
                </FormGroup>

                <FormGroup name="note-type" label={t("note_type_chooser.modal_body")}>
                    <div className="note-type-chooser-list" ref={setListHost} />
                </FormGroup>
            </div>

            {shown && listHost && noteTypes && (
                <Menu
                    anchor={listHost} container={listHost} inline
                    className="static" elementRef={menuRef}
                    items={noteTypes} filterable startAt="first"
                    isWanted={() => !userMovedFocus.current}
                    onSelect={onSelect}
                    onClose={() => setShown(false)}
                />
            )}
        </Modal>
    );
}
