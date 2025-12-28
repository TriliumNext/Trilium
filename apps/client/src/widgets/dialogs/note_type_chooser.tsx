import Modal from "../react/Modal";
import { t } from "../../services/i18n";
import FormGroup from "../react/FormGroup";
import NoteAutocomplete from "../react/NoteAutocomplete";
import FormList, { FormListHeader, FormListItem } from "../react/FormList";
import { useEffect, useState } from "preact/hooks";
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

    useTriliumEvent("chooseNoteType", ({ callback }) => {
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
            title={t("note_type_chooser.modal_title")}
            className="note-type-chooser-dialog"
            size="md"
            zIndex={1100} // note type chooser needs to be higher than other dialogs from which it is triggered, e.g. "add link"
            scrollable
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
