import { DEFAULT_BOARD_GROUP_BY, normalizeBoardGroupBy } from "@triliumnext/commons";

import { createPortal } from "preact/compat";
import { useCallback, useRef, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import type { Attribute } from "../../../services/attribute_parser";
import attributes from "../../../services/attributes";
import { t } from "../../../services/i18n";
import toast from "../../../services/toast";
import {
    AttributeDetail, type AttributeDetailOpts
} from "../../attribute_widgets/attribute_detail";
import Dropdown from "../../react/Dropdown";
import { FormDropdownDivider, FormListItem } from "../../react/FormList";
import Icon from "../../react/Icon";
import {
    type PromotedAttribute, type PromotedAttributeSetting, resolvePromotedAttributes
} from "../promoted_attributes";

/** One attribute the board offers to group its cards by. */
export interface GroupingOption {
    /** What `#board:groupBy` carries for it, with the `~` of a relation. */
    value: string;
    /** What the reader sees: the definition's alias, or the attribute's own name. */
    title: string;
}

/**
 * What a grouping made here starts from. The reader names it and gives its columns in the editor.
 *
 * A grouping is a select: its options are the board's columns, so no other kind describes one. It
 * is promoted because the column a card sits in is the point of the board, inheritable so that the
 * cards carry it, and single because a card stands in one column.
 */
const NEW_GROUPING: Attribute = {
    type: "label",
    name: "label:myLabel",
    value: "promoted,single,select",
    isInheritable: true
};

/** Switches which attribute the board's columns are made from, and makes new ones. */
export default function BoardGroupBy({ note, options, current, onSelect }: {
    /** The board note, which carries the definitions and any made here. */
    note: FNote;
    options: GroupingOption[];
    /** The grouping in force, as {@link groupingOptions} spells its value. */
    current: string;
    onSelect: (groupBy: string) => void;
}) {
    const [ detail, setDetail ] = useState<AttributeDetailOpts | null>(null);
    /** The definition the editor last reported, which {@link save} writes. */
    const edited = useRef<Attribute>();
    const selected = options.find(option => option.value === current);

    const create = useCallback((event: MouseEvent) => {
        const definition = { ...NEW_GROUPING };
        edited.current = undefined;
        setDetail({
            attribute: definition,
            allAttributes: [ definition ],
            isOwned: true,
            x: event.pageX,
            y: event.pageY,
            focus: "name",
            // The board answers for all four: a grouping is a promoted, inheritable select whose
            // options are the columns the board makes, and a card stands in one column at a time.
            hideType: true,
            hideTypeOptions: true,
            hideMultiplicity: true,
            hideInheritance: true
        });
    }, []);

    /** Writes the definition the editor was left holding, and groups by it. */
    const save = useCallback(async () => {
        const definition = edited.current;
        const [ , name ] = definition?.name.split(":", 2) ?? [];
        if (!definition || !name) {
            setDetail(null);
            return;
        }

        // `set-attribute` replaces the value of a definition the board already owns, which would
        // take the alias and the columns of a grouping the list above already offers. The editor
        // stays open for the reader to rename it. Owned only: a definition the board inherits is
        // not matched, so a definition of its own shadowing that one is safe.
        if (note.getOwnedLabels(definition.name).length) {
            toast.showError(t("board_view.grouping-already-defined", { name }));
            return;
        }

        setDetail(null);
        await attributes.setLabel(
            note.noteId, definition.name, definition.value, definition.isInheritable);
        onSelect(name);
    }, [ note, onSelect ]);

    return (
        <>
            <Dropdown
                className="board-group-by"
                noDropdownListStyle
                title={t("board_view.group-by")}
                text={<>
                    <Icon icon="bx bx-category-alt" />&nbsp;
                    {selected?.title ?? current}
                </>}
            >
                {options.map(option => (
                    <FormListItem
                        key={option.value}
                        onClick={() => onSelect(option.value)}
                        selected={option.value === current}
                        disabled={option.value === current}
                    >{option.title}</FormListItem>
                ))}

                <FormDropdownDivider />

                <FormListItem
                    className="board-group-by-create"
                    icon="bx bx-plus"
                    onClick={create}
                >{t("promoted_attributes.create_attribute")}</FormListItem>
            </Dropdown>

            {/* Outside the menu, which takes its items down as it closes: the editor is opened by
                one of them and outlives it. */}
            {createPortal(
                <AttributeDetail
                    opts={detail}
                    currentNoteId={note.noteId}
                    onDismiss={() => setDetail(null)}
                    onCancel={() => setDetail(null)}
                    onAttributesChanged={([ definition ]) => { edited.current = definition; }}
                    onSaveAndClose={save}
                />,
                document.body)}
        </>
    );
}

/**
 * The attributes the board offers to group by: the default grouping, the select fields it defines,
 * and the grouping in force whatever defines it.
 *
 * Only a select says what its columns are, so nothing else can be grouped by from here. The current
 * grouping is listed all the same — a board grouping by a relation, or by a label nobody defined,
 * still has to name what it is grouping by.
 */
export function groupingOptions(
    note: FNote | null | undefined,
    settings: PromotedAttributeSetting[] | undefined,
    groupBy: string
): GroupingOption[] {
    const current = normalizeBoardGroupBy(groupBy) || DEFAULT_BOARD_GROUP_BY;
    const defined = resolvePromotedAttributes(note, settings);
    const options = defined
        .filter(attribute => attribute.type === "label" && attribute.labelType === "select")
        .map(attribute => ({ value: attribute.name, title: attribute.title }));

    if (!options.some(option => option.value === current)) {
        const attribute = defined.find(
            ({ type, name }) => (type === "relation" ? `~${name}` : name) === current);
        options.unshift({ value: current, title: attribute?.title ?? current.replace(/^~/, "") });
    }

    // The default grouping leads, and is offered even where nothing defines it: it is what a board
    // groups by when `#board:groupBy` names nothing, so switching away is never a step with no way
    // back.
    const listed = options.findIndex(option => option.value === DEFAULT_BOARD_GROUP_BY);
    if (listed >= 0) {
        options.splice(listed, 1);
    }
    options.unshift({ value: DEFAULT_BOARD_GROUP_BY, title: defaultGroupingTitle(defined) });

    return options;
}

/**
 * What the default grouping is listed as: the alias its definition gives, or the stock word.
 *
 * Named rather than left to read as the label it is, which every other grouping is named by: the
 * board writes the same word into the definition it creates for a new board, so a board that has
 * one and a board that has none are listed alike.
 */
function defaultGroupingTitle(defined: PromotedAttribute[]) {
    const status = defined.find(attribute =>
        attribute.type === "label" && attribute.name === DEFAULT_BOARD_GROUP_BY);
    return status?.promotedAlias || t("board_view.status-alias");
}
