import "./TemplateSelectionCard.css";

import { buildTemplateId } from "@triliumnext/commons";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import type FNote from "../../entities/fnote";
import dialog from "../../services/dialog";
import { t } from "../../services/i18n";
import note_create from "../../services/note_create";
import {
    type NoteTypeOption, noteTypeOptionGroupTitle, resolveNoteTypeOptions
} from "../../services/note_types";
import { type PickerItem, type PickerItemGroup } from "../dialogs/item_picker";
import ActionButton from "./ActionButton";
import { useNoteTypeOptions } from "./hooks";
import Icon from "./Icon";
import { type SortableItem, SortableCard } from "./SortableCard";
import {
    openTemplateMenu, quickEdit, remove, type TemplateCommands, templateNoteId
} from "./template_commands";

export interface TemplateSelectionCardProps {
    heading: string;
    /** Explains what the templates are for. Shown under the heading. */
    instruction: string;
    /** The note the templates belong to, and the parent of any created here. */
    note: FNote;
    /** The title given to a template created here. */
    newTemplateName?: string;
    /** The templates offered, as note type IDs, in display order. */
    templates: string[];
    /** Called with the whole list after every change. */
    onChange: (templates: string[]) => void;
}

/**
 * Lists the templates a note can be created from, in the order they are offered.
 *
 * The reader reorders the list, adds a template the app already offers, or creates one. The caller
 * supplies the current list through `templates` and stores what `onChange` reports; the card reads
 * the available templates itself.
 */
export default function TemplateSelectionCard({
    heading, instruction, note, newTemplateName, templates, onChange
}: TemplateSelectionCardProps) {
    /**
     * The current list, which the card renders from. Held in state because `onChange` writes
     * through at once and a caller that does not re-render would leave `templates` unchanged.
     */
    const [ ids, setIds ] = useState(templates);
    /** Everything a note can be created from, kept current as templates are edited. */
    const available = useNoteTypeOptions();
    /**
     * Templates created here that `getNoteTypeOptions()` has not reported yet. Without them a new
     * template is stored but has nothing to render its entry from.
     */
    const [ made, setMade ] = useState<NoteTypeOption[]>([]);

    useEffect(() => setIds(templates), [ templates ]);

    /**
     * Whether `useNoteTypeOptions()` has answered. The note types alone make it non-empty, so an
     * empty list means `templates` cannot be resolved and a creation would replace the whole list.
     */
    const isRead = available.length > 0;

    const known = useMemo(
        () => [ ...available, ...made.filter((option) => !available.some((a) => a.id === option.id)) ],
        [ available, made ]);
    const offered = useMemo(() => resolveNoteTypeOptions(ids, known), [ ids, known ]);
    const items = useMemo(() => offered.map((option) => ({
        key: option.id,
        caption: option.title,
        icon: option.icon
    })), [ offered ]);

    const store = useCallback((order: SortableItem[]) => {
        const next = order.map((item) => item.key);
        setIds(next);
        onChange(next);
    }, [ onChange ]);

    const drop = useCallback((key: string) => {
        const next = ids.filter((id) => id !== key);
        setIds(next);
        onChange(next);
    }, [ ids, onChange ]);

    /** How the template menu changes the list. Its other commands act on the note alone. */
    const commands = useMemo<TemplateCommands>(() => ({
        onDuplicated: (sourceNoteId, copy) => {
            const source = offered.find(
                (option) => option.options.templateNoteId === sourceNoteId);
            const option: NoteTypeOption = {
                id: buildTemplateId(copy.noteId),
                title: copy.title,
                icon: copy.icon,
                group: "user",
                options: { ...source?.options ?? { type: "text" }, templateNoteId: copy.noteId }
            };

            setMade((was) => [ ...was, option ]);
            // Directly after the template it was copied from.
            const at = source ? ids.indexOf(source.id) : -1;
            const next = [ ...ids ];
            next.splice(at < 0 ? ids.length : at + 1, 0, option.id);
            setIds(next);
            onChange(next);
        },
        onDeleted: (noteId) => drop(buildTemplateId(noteId))
    }), [ drop, ids, offered, onChange ]);

    /** Asks which template to add, and returns it as an entry. */
    const addExisting = useCallback(async () => {
        const taken = new Set(offered.map((option) => option.id));
        const picked = await dialog.pickSingleItem({
            title: t("template_selection.add-title"),
            items: pickable(available, taken)
        });

        return picked
            ? { key: picked.key, caption: picked.caption, icon: picked.icon }
            : undefined;
    }, [ available, offered ]);

    /** Creates a template and opens it for editing. */
    const create = useCallback(async () => {
        const template = await note_create.createTemplateNote(
            note.noteId, newTemplateName ?? t("template_selection.new-name"));
        if (!template) {
            return undefined;
        }

        const option: NoteTypeOption = {
            id: buildTemplateId(template.noteId),
            title: template.title,
            icon: template.getIcon(),
            group: "user",
            options: { type: template.type, mime: template.mime, templateNoteId: template.noteId }
        };

        setMade((was) => [ ...was, option ]);
        return { key: option.id, caption: option.title, icon: option.icon };
    }, [ newTemplateName, note ]);

    return (
        <SortableCard
            className="template-selection-card"
            heading={heading}
            description={instruction}
            items={items}
            onChange={store}
            // The grip leads, leaving the trailing edge to the menu and remove buttons.
            gripPlacement="start"
            onItemKeyDown={(item, event) => {
                const noteId = templateNoteId(item.key);
                if (!noteId) {
                    return;
                }

                if (event.key === " ") {
                    event.preventDefault();
                    quickEdit(noteId);
                } else if (event.key === "Delete") {
                    event.preventDefault();
                    remove(noteId, commands);
                }
            }}
            renderItem={(item, index) => (
                <>
                    {item.icon && <Icon icon={item.icon} />}
                    <span className="template-selection-name">{item.caption}</span>

                    {/* Only a template has a note behind it, so only it carries note commands. */}
                    {templateNoteId(item.key) && (
                        <ActionButton
                            className="template-selection-menu"
                            icon="bx bx-dots-vertical-rounded"
                            text={t("template_selection.menu")}
                            onClick={(event) => {
                                event.stopPropagation();
                                const noteId = templateNoteId(item.key);
                                if (noteId) {
                                    openTemplateMenu(event, noteId, commands);
                                }
                            }}
                        />
                    )}

                    {/* The last template cannot be removed: an empty list creates nothing. */}
                    {items.length > 1 && (
                        <ActionButton
                            className="template-selection-remove"
                            icon="bx bx-x"
                            text={t("template_selection.remove")}
                            onClick={(event) => {
                                event.stopPropagation();
                                store(items.filter((unused, at) => at !== index));
                            }}
                        />
                    )}
                </>
            )}
            itemCreationButtons={[
                {
                    label: t("template_selection.add-existing"),
                    icon: "bx bx-list-plus",
                    disabled: !isRead,
                    onCreateItem: addExisting
                },
                {
                    label: t("template_selection.create"),
                    icon: "bx bx-plus",
                    disabled: !isRead,
                    onCreateItem: create
                }
            ]}
        />
    );
}

/**
 * Groups what can still be added for the picker. Templates the app ships are left out: they are a
 * starting point for a template of your own rather than something to create from repeatedly.
 */
function pickable(available: NoteTypeOption[], taken: Set<string>): PickerItemGroup[] {
    const groups = new Map<string, PickerItemGroup>();

    for (const option of available) {
        if (option.group === "builtin" || taken.has(option.id)) {
            continue;
        }

        const group = groups.get(option.group) ?? {
            key: option.group,
            groupHeader: noteTypeOptionGroupTitle(option.group),
            items: []
        };

        const entry: PickerItem = {
            key: option.id, caption: option.title, icon: option.icon
        };
        group.items.push(entry);
        groups.set(option.group, group);
    }

    return [ ...groups.values() ];
}
