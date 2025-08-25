import { useState } from "preact/hooks";
import { t } from "../../services/i18n";
import Button from "../react/Button";
import FormCheckbox from "../react/FormCheckbox";
import FormRadioGroup from "../react/FormRadioGroup";
import FormTextBox from "../react/FormTextBox";
import Modal from "../react/Modal";
import server from "../../services/server";
import FormGroup from "../react/FormGroup";
import { useTriliumEvent } from "../react/hooks";

export default function SortChildNotesDialog() {
    const [ parentNoteId, setParentNoteId ] = useState<string>();
    const [ sortBy, setSortBy ] = useState("title");
    const [ sortDirection, setSortDirection ] = useState("asc");
    const [ foldersFirst, setFoldersFirst ] = useState(false);
    const [ sortNatural, setSortNatural ] = useState(false);
    const [ sortLocale, setSortLocale ] = useState("");
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("sortChildNotes", ({ node }) => {
        setParentNoteId(node.data.noteId);
        setShown(true);
    });

    async function onSubmit() {
        await server.put(`notes/${parentNoteId}/sort-children`, { 
            sortBy,
            sortDirection,
            foldersFirst,
            sortNatural,
            sortLocale
        });

        setShown(false);
    }

    return (
        <Modal
            className="sort-child-notes-dialog"
            title={t("sort_child_notes.sort_children_by")}
            size="lg" maxWidth={500}
            onSubmit={onSubmit}
            onHidden={() => setShown(false)}
            show={shown}
            footer={<Button text={t("sort_child_notes.sort")} keyboardShortcut="Enter" />}
        >
            <h5>{t("sort_child_notes.sorting_criteria")}</h5>
            <FormRadioGroup
                name="sort-by"
                values={[
                    { value: "title", label: t("sort_child_notes.title") },
                    { value: "dateCreated", label: t("sort_child_notes.date_created") },
                    { value: "dateModified", label: t("sort_child_notes.date_modified") }
                ]}
                currentValue={sortBy} onChange={setSortBy}
            />
            <br/>

            <h5>{t("sort_child_notes.sorting_direction")}</h5>
            <FormRadioGroup
                name="sort-direction"
                values={[
                    { value: "asc", label: t("sort_child_notes.ascending") },
                    { value: "desc", label: t("sort_child_notes.descending") }
                ]}
                currentValue={sortDirection} onChange={setSortDirection}
            />
            <br/>

            <h5>{t("sort_child_notes.folders")}</h5>
            <FormCheckbox
                label={t("sort_child_notes.sort_folders_at_top")}
                name="sort-folders-first"
                currentValue={foldersFirst} onChange={setFoldersFirst}
            />
            <br />

            <h5>{t("sort_child_notes.natural_sort")}</h5>
            <FormCheckbox
                name="sort-natural"
                label={t("sort_child_notes.sort_with_respect_to_different_character_sorting")}
                currentValue={sortNatural} onChange={setSortNatural}
            />
            <FormGroup name="sort-locale" className="form-check" label={t("sort_child_notes.natural_sort_language")} description={t("sort_child_notes.the_language_code_for_natural_sort")}>
                <FormTextBox currentValue={sortLocale} onChange={setSortLocale} />
            </FormGroup>
        </Modal>
    )
}
