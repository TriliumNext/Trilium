import "./sort_child_notes.css";

import { useState } from "preact/hooks";
import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import Button from "../react/Button";
import FormCheckbox from "../react/FormCheckbox";
import FormSelect from "../react/FormSelect";
import FormTextBox from "../react/FormTextBox";
import Modal from "../react/Modal";
import SegmentedChoice from "../react/SegmentedChoice";
import server from "../../services/server";
import FormGroup from "../react/FormGroup";
import { useTriliumEvent } from "../react/hooks";

type SortKind = "title" | "dateCreated" | "dateModified" | "label";

interface SortLevel {
    kind: SortKind;
    /** The label the level sorts by; only read where {@link kind} is `label`. */
    labelName: string;
    descending: boolean;
}

const NEW_LEVEL: SortLevel = { kind: "title", labelName: "", descending: false };

export default function SortChildNotesDialog() {
    const [ parentNoteId, setParentNoteId ] = useState<string>();
    const [ levels, setLevels ] = useState<SortLevel[]>([ NEW_LEVEL ]);
    const [ foldersFirst, setFoldersFirst ] = useState(false);
    const [ sortNatural, setSortNatural ] = useState(false);
    const [ sortLocale, setSortLocale ] = useState("");
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("sortChildNotes", ({ node, noteId }) => {
        const targetNoteId = noteId ?? node?.data.noteId;
        if (!targetNoteId) return;
        setParentNoteId(targetNoteId);
        setShown(true);
    });

    function updateLevel(index: number, change: Partial<SortLevel>) {
        setLevels(levels.map((level, i) => (i === index ? { ...level, ...change } : level)));
    }

    function moveLevel(index: number, offset: -1 | 1) {
        const reordered = [ ...levels ];
        [ reordered[index], reordered[index + offset] ] = [ reordered[index + offset], reordered[index] ];
        setLevels(reordered);
    }

    async function onSubmit() {
        await server.put(`notes/${parentNoteId}/sort-children`, {
            sortBy: serializeSortLevels(levels),
            sortDirection: "asc",
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
            size="lg" maxWidth={680}
            onSubmit={onSubmit}
            onHidden={() => setShown(false)}
            show={shown}
            footer={<>
                <Button text={t("modal.cancel")} onClick={() => setShown(false)} />
                <Button text={t("sort_child_notes.sort")} keyboardShortcut="Enter" />
            </>}
        >
            <div className="sort-criteria">
                <h5>{t("sort_child_notes.sorting_criteria")}</h5>
                <p className="sort-levels-description">{t("sort_child_notes.sorting_criteria_description")}</p>
                <div className="sort-levels">
                    {levels.map((level, index) => (
                        <div className="sort-level" key={index}>
                            <FormSelect
                                className="sort-level-kind"
                                values={[
                                    { key: "title", title: t("sort_child_notes.title") },
                                    { key: "dateCreated", title: t("sort_child_notes.date_created") },
                                    { key: "dateModified", title: t("sort_child_notes.date_modified") },
                                    { key: "label", title: t("sort_child_notes.label") }
                                ]}
                                keyProperty="key"
                                titleProperty="title"
                                currentValue={level.kind}
                                onChange={(kind) => updateLevel(index, { kind: kind as SortKind })}
                            />
                            {level.kind === "label" && (
                                <FormTextBox
                                    className="sort-level-label"
                                    placeholder={t("sort_child_notes.label_name")}
                                    required
                                    currentValue={level.labelName}
                                    onChange={(labelName) => updateLevel(index, { labelName })}
                                />
                            )}
                            <SegmentedChoice
                                options={[
                                    { value: "asc", icon: "bx-sort-up", title: t("sort_child_notes.ascending") },
                                    { value: "desc", icon: "bx-sort-down", title: t("sort_child_notes.descending") }
                                ]}
                                currentValue={level.descending ? "desc" : "asc"}
                                onChange={(direction) => updateLevel(index, { descending: direction === "desc" })}
                            />
                            <ActionButton
                                className="sort-level-up"
                                icon="bx bx-up-arrow-alt"
                                text={t("sort_child_notes.move_level_up")}
                                disabled={index === 0}
                                onClick={() => moveLevel(index, -1)}
                            />
                            <ActionButton
                                className="sort-level-down"
                                icon="bx bx-down-arrow-alt"
                                text={t("sort_child_notes.move_level_down")}
                                disabled={index === levels.length - 1}
                                onClick={() => moveLevel(index, 1)}
                            />
                            <ActionButton
                                className="sort-level-remove"
                                icon="bx bx-x"
                                text={t("sort_child_notes.remove_level")}
                                disabled={levels.length === 1}
                                onClick={() => setLevels(levels.filter((_, i) => i !== index))}
                            />
                        </div>
                    ))}
                </div>
                <Button
                    className="sort-level-add"
                    icon="bx bx-plus"
                    text={t("sort_child_notes.add_level")}
                    size="small"
                    onClick={() => setLevels([ ...levels, NEW_LEVEL ])}
                />
            </div>

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

/** Writes the levels in the `#sorted` format the server parses, e.g. `priority:desc,title:asc`. */
export function serializeSortLevels(levels: SortLevel[]) {
    return levels
        .map((level) => ({ ...level, key: level.kind === "label" ? level.labelName.trim() : level.kind }))
        .filter((level) => level.key)
        .map((level) => `${level.key}:${level.descending ? "desc" : "asc"}`)
        .join(",");
}
