import "./sort_child_notes.css";

import {
    ATTRIBUTE_NAME_PATTERN,
    serializeSortCriteria,
    type SortCriterion
} from "@triliumnext/commons";
import { useState } from "preact/hooks";

import { t } from "../../services/i18n";
import server from "../../services/server";
import ActionButton from "../react/ActionButton";
import Button from "../react/Button";
import FormCheckbox from "../react/FormCheckbox";
import FormGroup from "../react/FormGroup";
import FormSelect from "../react/FormSelect";
import FormTextBox from "../react/FormTextBox";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import SegmentedChoice, { type SegmentedChoiceOption } from "../react/SegmentedChoice";

type SortKind = "title" | "dateCreated" | "dateModified" | "label";

interface SortLevel {
    kind: SortKind;
    /** The label the level sorts by; only read where {@link kind} is `label`. */
    labelName: string;
    direction: "asc" | "desc";
}

const NEW_LEVEL: SortLevel = { kind: "title", labelName: "", direction: "asc" };

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
        const other = index + offset;
        [ reordered[index], reordered[other] ] = [ reordered[other], reordered[index] ];
        setLevels(reordered);
    }

    const kindOptions = [
        { kind: "title", title: t("sort_child_notes.title") },
        { kind: "dateCreated", title: t("sort_child_notes.date_created") },
        { kind: "dateModified", title: t("sort_child_notes.date_modified") },
        { kind: "label", title: t("sort_child_notes.label") }
    ];
    const directionOptions: SegmentedChoiceOption<SortLevel["direction"]>[] = [
        { value: "asc", icon: "bx-sort-up", title: t("sort_child_notes.ascending") },
        { value: "desc", icon: "bx-sort-down", title: t("sort_child_notes.descending") }
    ];

    async function onSubmit() {
        // The first level's direction also decides where folders group and how ties break.
        await server.put(`notes/${parentNoteId}/sort-children`, {
            sortBy: serializeSortLevels(levels),
            sortDirection: levels[0].direction,
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
            size="lg"
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
                <p className="sort-levels-description">
                    {t("sort_child_notes.sorting_criteria_description")}
                </p>
                <div className="sort-levels">
                    {levels.map((level, index) => (
                        <div className="sort-level" key={index}>
                            <FormSelect
                                className="sort-level-kind"
                                values={kindOptions}
                                keyProperty="kind"
                                titleProperty="title"
                                currentValue={level.kind}
                                onChange={(kind) => updateLevel(index, { kind: kind as SortKind })}
                            />
                            {level.kind === "label" && (
                                <FormTextBox
                                    className="sort-level-label"
                                    placeholder={t("sort_child_notes.label_name")}
                                    required
                                    pattern={ATTRIBUTE_NAME_PATTERN}
                                    currentValue={level.labelName}
                                    onChange={(labelName) => updateLevel(index, { labelName })}
                                />
                            )}
                            <SegmentedChoice
                                options={directionOptions}
                                currentValue={level.direction}
                                onChange={(direction) => updateLevel(index, { direction })}
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
                    icon="bx-plus"
                    text={t("sort_child_notes.add_level")}
                    size="small"
                    onClick={() => setLevels([ ...levels, NEW_LEVEL ])}
                />
            </div>

            <h5>{t("sort_child_notes.folders")}</h5>
            <FormCheckbox
                label={t("sort_child_notes.sort_folders_at_top")}
                hint={t("sort_child_notes.folders_follow_first_level")}
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

/** Writes the levels in the `#sorted` grammar with their directions, skipping a nameless label. */
export function serializeSortLevels(levels: SortLevel[]) {
    const criteria: SortCriterion[] = [];
    for (const level of levels) {
        const key = level.kind === "label" ? level.labelName.trim() : level.kind;
        if (key) {
            criteria.push({ key, descending: level.direction === "desc" });
        }
    }
    return serializeSortCriteria(criteria);
}
