import Modal from "../react/Modal";
import { t } from "../../services/i18n";
import FormGroup from "../react/FormGroup";
import NoteAutocomplete from "../react/NoteAutocomplete";
import FormList, { FormListHeader, FormListItem } from "../react/FormList";
import { useEffect, useRef, useState } from "preact/hooks";
import note_types from "../../services/note_types";
import { MenuCommandItem, MenuItem } from "../../menus/context_menu";
import { TreeCommandNames } from "../../menus/tree_context_menu";
import { Suggestion } from "../../services/note_autocomplete";
import SimpleBadge from "../react/Badge";
import { useTriliumEvent } from "../react/hooks";

export interface ChooseNoteTypeResponse {
    success: boolean;
    noteType?: string;
    templateNoteId?: string;
    notePath?: string;
    /** Extra parents to clone the created note into, from the template's default parents. */
    cloneToNoteIds?: string[];
}

export type ChooseNoteTypeCallback = (data: ChooseNoteTypeResponse) => void;

const SEPARATOR_TITLE_REPLACEMENTS = [
    t("note_type_chooser.builtin_templates"),
    t("note_type_chooser.templates")
];

export default function NoteTypeChooserDialogComponent() {
    const [ callback, setCallback ] = useState<ChooseNoteTypeCallback>();
    const [ shown, setShown ] = useState(false);
    const [ parentNote, setParentNote ] = useState<Suggestion | null>();
    const [ noteTypes, setNoteTypes ] = useState<MenuItem<TreeCommandNames>[]>([]);
    const modalRef = useRef<HTMLDivElement>(null);
    const userMovedFocus = useRef(false);

    useTriliumEvent("chooseNoteType", ({ callback }) => {
        userMovedFocus.current = false;
        setCallback(() => callback);
        setShown(true);
    });

    useEffect(() => {
        note_types.getNoteTypeItems().then(noteTypes => {
            let index = -1;

            setNoteTypes((noteTypes ?? []).map((item) => {
                if ("kind" in item && item.kind === "separator") {
                    index++;
                    return {
                        kind: "header",
                        title: SEPARATOR_TITLE_REPLACEMENTS[index]
                    }
                }

                return item;
            }));
        });
    }, []);

    useEffect(() => {
        const modal = modalRef.current;
        if (!shown || !modal) {
            return;
        }

        const onUserGesture = (e: Event) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest(".dropdown-item")) {
                return;
            }
            userMovedFocus.current = true;
        };

        modal.addEventListener("pointerdown", onUserGesture);
        modal.addEventListener("keydown", onUserGesture);
        return () => {
            modal.removeEventListener("pointerdown", onUserGesture);
            modal.removeEventListener("keydown", onUserGesture);
        };
    }, [ shown ]);

    // Opening focuses the first type so Enter creates it, unless the user is already on the
    // parent-path field.
    useEffect(() => {
        if (shown && noteTypes.length > 0) {
            tryFocusFirstNoteType();
        }
    }, [ shown, noteTypes.length ]);

    function tryFocusFirstNoteType() {
        if (!userMovedFocus.current) {
            focusFirstNoteType(modalRef.current);
        }
    }

    function onNoteTypeSelected(value: string) {
        const [ noteType, templateNoteId ] = value.split(",");

        callback?.({
            success: true,
            noteType,
            templateNoteId,
            notePath: parentNote?.notePath
        });
        setShown(false);
    }

    return (
        <Modal
            modalRef={modalRef}
            title={t("note_type_chooser.modal_title")}
            className="note-type-chooser-dialog"
            size="md"
            zIndex={1100} // note type chooser needs to be higher than other dialogs from which it is triggered, e.g. "add link"
            scrollable
            onShown={tryFocusFirstNoteType}
            onHidden={() => {
                callback?.({ success: false });
                setShown(false);
            }}
            show={shown}
            stackable
        >
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
                <FormList onSelect={onNoteTypeSelected}>
                    {noteTypes.map((_item) => {
                        if ("kind" in _item && _item.kind === "separator") {
                            return;
                        }

                        const item = _item as MenuCommandItem<TreeCommandNames>;

                        if ("kind" in item && item.kind === "header") {
                            return <FormListHeader text={item.title} />
                        } else {
                            return <FormListItem
                                value={[ item.type, item.templateNoteId ].join(",") }
                                icon={item.uiIcon}>
                                {item.title}
                                {item.badges && item.badges.map((badge) => <SimpleBadge {...badge} />)}
                            </FormListItem>;
                        }
                    })}
                </FormList>
            </FormGroup>
        </Modal>
    );
}

function focusFirstNoteType(modal: HTMLDivElement | null) {
    modal?.querySelector<HTMLElement>(".dropdownWrapper .dropdown-item:not(.disabled)")?.focus();
}
