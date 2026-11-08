import "./TemplateDropdown.css";

import { type NoteTypeId } from "@triliumnext/commons";
import clsx from "clsx";
import { useMemo, useState } from "preact/hooks";

import {
    currentNoteTypeOption, type NoteTypeOption, resolveNoteTypeOptions
} from "../../services/note_types";
import Dropdown from "./Dropdown";
import { FormListItem } from "./FormList";
import Icon from "./Icon";

/** What a collection creates its notes from, and how the reader picks something else. */
export interface TemplateChoice {
    /** What the collection offers, in the order it stores them. */
    offered: NoteTypeOption[];
    /** The one a new note would be made from now, absent while the options are still read. */
    current?: NoteTypeOption;
    onSelect: (template: NoteTypeOption) => void;
    /** Opens the dialog that decides what the collection offers. */
    onMore: () => void;
}

/**
 * What a collection stores about its templates in its view config. Extended by the view config of
 * every collection that offers a {@link TemplateDropdown}.
 */
export interface TemplateChoiceConfig {
    /**
     * What a new note can be made from, as {@link NoteTypeOption} ids. Absent until the reader
     * picks for the collection, which is what the collection's defaults stand in for.
     */
    templates?: string[];
    /** The one last used, which the next note is made from. */
    template?: string;
}

/**
 * A dropdown naming what a new note will be made from, listing what the collection offers and a
 * way to the dialog that decides what that is.
 *
 * Drawn as a select button showing the template's icon and name, or with `pill` as a small chip
 * showing the name alone. The dropdown reports a pick rather than storing one, so the collection
 * decides where the last used template is kept.
 */
export default function TemplateDropdown({
    offered, current, onSelect, onMore, title, moreText, pill, onOpened, onClosed
}: TemplateChoice & {
    /** The tooltip of the button, naming what is created. */
    title: string;
    /** The label of the entry that calls `onMore`. */
    moreText: string;
    /** Draws the button as a chip naming the template, for a field that has no room for more. */
    pill?: boolean;
    /**
     * Called as the dropdown opens and closes, for a host that closes on losing focus: the menu
     * takes the focus while it is open.
     */
    onOpened?: () => void;
    onClosed?: () => void;
}) {
    const [ isShown, setIsShown ] = useState(false);

    // Rebuilt only as the list changes, since a dropdown is torn down and put back up with it.
    const items = useMemo(() => offered.map((template) => (
        <FormListItem
            key={template.id}
            icon={template.icon}
            checkable
            checked={template.id === current?.id}
            onClick={() => onSelect(template)}
        >
            {template.title}
        </FormListItem>
    )), [ offered, current, onSelect ]);

    return (
        <Dropdown
            className={clsx("template-dropdown", pill && "template-pill")}
            buttonClassName={pill ? "template-pill-button" : "template-dropdown-button"}
            text={<>
                {!pill && current && <Icon icon={current.icon} />}
                <span className="template-dropdown-name">{current?.title ?? ""}</span>
            </>}
            title={title}
            noSelectButtonStyle={pill}
            onShown={() => {
                setIsShown(true);
                onOpened?.();
            }}
            onHidden={() => {
                setIsShown(false);
                onClosed?.();
            }}
        >
            {isShown && <>
                {items}
                <li><hr className="dropdown-divider" /></li>
                <FormListItem icon="bx bx-list-ul" onClick={onMore}>
                    {moreText}
                </FormListItem>
            </>}
        </Dropdown>
    );
}

/**
 * Resolves the stored template ids against what exists into a {@link TemplateChoice}.
 *
 * `onSelect` and `onMore` must be stable, or every render returns a new choice.
 */
export function useTemplateChoice({ ids, lastUsedId, available, onSelect, onMore }: {
    /** What the collection offers, usually from {@link offeredTemplateIds}. */
    ids: NoteTypeId[];
    lastUsedId: string | undefined;
    /** Everything a note can be made from, from `useNoteTypeOptions()`. */
    available: NoteTypeOption[];
    onSelect: (template: NoteTypeOption) => void;
    onMore: () => void;
}): TemplateChoice {
    const offered = useMemo(() => resolveNoteTypeOptions(ids, available), [ ids, available ]);

    return useMemo(() => ({
        offered,
        current: currentNoteTypeOption(offered, lastUsedId),
        onSelect,
        onMore
    }), [ offered, lastUsedId, onSelect, onMore ]);
}

/** The template ids a collection offers: the stored ones, or `defaults` until the reader picks. */
export function offeredTemplateIds(
    config: TemplateChoiceConfig | undefined, defaults: NoteTypeId[]
) {
    return config?.templates?.length ? config.templates : defaults;
}
