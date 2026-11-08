import "./PromotedAttributesCard.css";

import { createPortal } from "preact";
import { useCallback, useMemo, useRef, useState } from "preact/hooks";

import { extractAttributeDefinitionTypeAndName } from "@triliumnext/commons";
import type FNote from "../../entities/fnote";
import type { Attribute } from "../../services/attribute_parser";
import attributes, { removeOwnedAttributesByNameOrType } from "../../services/attributes";
import dialog from "../../services/dialog";
import { t } from "../../services/i18n";
import {
    AttributeDetail, type AttributeDetailOpts, DEFINITION_TYPES
} from "../attribute_widgets/attribute_detail";
import { RELATION_DEFINITION_TYPE } from "../attribute_widgets/attribute_types";
import {
    deleteAttributeInSubtree, type PromotedAttribute, type PromotedAttributeSetting,
    renameAttributeInSubtree, resolvePromotedAttributes, storedPromotedAttributes
} from "../collections/promoted_attributes";
import ActionButton from "./ActionButton";
import { Badge } from "./Badge";
import FormToggle from "./FormToggle";
import { useTriliumEvent } from "./hooks";
import { TooltipIcon } from "./Icon";
import { type SortableItem, SortableCard } from "./SortableCard";

/** Each kind of definition by name, holding the title and icon `AttributeDetail` lists it with. */
const TYPES = new Map(DEFINITION_TYPES.map((type) => [ type.value, type ]));

/** The kind a definition naming none is drawn as, which is what a new one is created as. */
const DEFAULT_TYPE = TYPES.get("text") ?? DEFINITION_TYPES[0];

/** The definition a new attribute starts from, which the reader names in the editor. */
const NEW_DEFINITION: Attribute = {
    type: "label",
    name: "label:myLabel",
    value: "promoted,single,text",
    isInheritable: true
};

export interface PromotedAttributesCardProps {
    heading: string;
    /** Explains what arranging the attributes does. Shown under the heading. */
    instruction: string;
    /** The collection that defines them, and the note an attribute created here is written to. */
    note: FNote;
    /** The order and what is hidden, as the collection's view config stores it. */
    settings: PromotedAttributeSetting[] | undefined;
    /**
     * Attributes the collection draws itself, such as the label a board groups by. Listed and
     * arranged with the rest, but their switch is held off: they are already on the screen.
     */
    drawnByCollection?: string[];
    /**
     * The notes the collection shows. Their definitions are listed after those of `note`, and the
     * ones only these notes define have no edit or delete button.
     */
    itemNotes?: Iterable<FNote>;
    /**
     * Starts what the settings have never named switched off, for a collection whose items have
     * little room. A definition created from this card is shown all the same.
     */
    unarrangedHidden?: boolean;
    /**
     * Leaves out what `drawnByCollection` names, for a collection that always draws those itself,
     * such as a calendar's dates. Otherwise they are listed with their switch held off.
     */
    omitDrawn?: boolean;
    /** Called with the whole list after every change, for the caller to store. */
    onChange: (attributes: PromotedAttribute[]) => void;
    /**
     * Runs the deletion of a definition and its values, for a caller that keeps settings of its own
     * for the attribute and must update them in the same write, such as the columns a board stores
     * for a grouping. Without it, the card runs the deletion itself.
     */
    runDeletion?: (
        deletion: () => Promise<void>, type: "label" | "relation", name: string) => Promise<void>;
}

/**
 * The promoted attributes a collection shows on its items, in the order they are shown.
 *
 * Entries are reordered, hidden without being deleted, edited or deleted through the attribute
 * editor, and created from the button at the foot. `note` carries the definitions; `onChange`
 * reports the order and what is hidden, which the caller stores.
 */
export default function PromotedAttributesCard({
    heading, instruction, note, settings, drawnByCollection, itemNotes, unarrangedHidden, omitDrawn,
    onChange, runDeletion
}: PromotedAttributesCardProps) {
    const resolve = (stored: PromotedAttributeSetting[] | undefined) => resolvePromotedAttributes(
        note, stored, drawnByCollection, itemNotes, { unarrangedHidden })
        .filter((attribute) => !omitDrawn || !attribute.drawnByCollection);
    const [ shown, setShown ] = useState(() => resolve(settings));
    const shownRef = useRef(shown);
    shownRef.current = shown;
    /** Names of the definitions created from this card, to show once they load. */
    const madeHere = useRef(new Set<string>());
    // What the collection draws can change while the card stands, a board being regrouped from
    // its header. The rows are marked again where they are, keeping their order and what is
    // hidden; the marks are not stored, so nothing is written back for them.
    const drawn = (drawnByCollection ?? []).join(",");
    const [ lastDrawn, setLastDrawn ] = useState(drawn);
    if (lastDrawn !== drawn) {
        setLastDrawn(drawn);
        setShown((was) => omitDrawn
            ? resolve(storedPromotedAttributes(was))
            : was.map((attribute) => ({
                ...attribute,
                drawnByCollection: drawnByCollection?.includes(attribute.name) ?? false
            })));
    }
    // A card that joins through a branch change brings no attribute row for `entitiesReloaded`, so
    // the list is resolved again when the definition names of `itemNotes` change.
    const itemDefinitions = definitionNames(itemNotes);
    const [ lastItemDefinitions, setLastItemDefinitions ] = useState(itemDefinitions);
    if (lastItemDefinitions !== itemDefinitions) {
        setLastItemDefinitions(itemDefinitions);
        setShown((was) => resolve(storedPromotedAttributes(was)));
    }
    const [ detail, setDetail ] = useState<AttributeDetailOpts | null>(null);
    /** The definition the editor last reported, which `save` writes. */
    const edited = useRef<Attribute | undefined>(undefined);
    /** The definition the editor was handed, which `save` compares against to spot a rename. */
    const original = useRef<Attribute | undefined>(undefined);

    // A definition created, renamed or deleted here arrives as an attribute change. Resolving
    // against the current list is what keeps the order of the rest.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const notes = [ note, ...itemNotes ?? [] ];
        const affects = loadResults.getAttributeRows().some((attribute) =>
            notes.some((affected) => attributes.isAffecting(attribute, affected)));
        if (!affects) return;

        const was = shownRef.current;
        const next = resolve(storedPromotedAttributes(was));
        // A definition made here is one the reader asked for, so it is shown even where what nobody
        // has arranged starts hidden, and stored as such.
        const made = next.filter((attribute) => attribute.hidden
            && madeHere.current.has(attribute.name)
            && !was.some((previous) => previous.name === attribute.name));
        if (!made.length) {
            setShown(next);
            return;
        }

        for (const attribute of made) {
            madeHere.current.delete(attribute.name);
        }
        store(next.map((attribute) =>
            made.includes(attribute) ? { ...attribute, hidden: false } : attribute));
    });

    const items = useMemo(() => shown.map((attribute) => ({
        key: attribute.name,
        caption: attribute.title,
        icon: promotedAttributeType(attribute).icon
    })), [ shown ]);

    const store = useCallback((next: PromotedAttribute[]) => {
        setShown(next);
        onChange(next);
    }, [ onChange ]);

    const reorder = useCallback((order: SortableItem[]) => {
        const byName = new Map(shown.map((attribute) => [ attribute.name, attribute ]));
        store(order.flatMap((item) => {
            const attribute = byName.get(item.key);
            return attribute ? [ attribute ] : [];
        }));
    }, [ shown, store ]);

    const setHidden = useCallback((name: string, hidden: boolean) => {
        store(shown.map((attribute) =>
            attribute.name === name ? { ...attribute, hidden } : attribute));
    }, [ shown, store ]);

    /** Opens the editor on a definition, or on a new one where none is given. */
    const openEditor = useCallback((event: MouseEvent | undefined, attribute?: PromotedAttribute) => {
        const definition: Attribute = attribute
            ? {
                type: "label",
                name: attribute.definitionName,
                value: attribute.definitionValue,
                isInheritable: attribute.isInheritable
            }
            : { ...NEW_DEFINITION };

        original.current = attribute ? { ...definition } : undefined;
        edited.current = undefined;
        setDetail({
            attribute: definition,
            allAttributes: [ definition ],
            isOwned: true,
            // Where the press was, or below the top of the page for one made from the keyboard.
            x: event?.pageX ?? 0,
            focus: attribute ? undefined : "name",
            hideMultiplicity: true,
            // Every attribute listed here is inheritable and promoted already, so the two toggles
            // would only offer a way to take it off the list.
            hideInheritance: true
        });
    }, []);

    /**
     * Writes what the editor was left holding.
     *
     * A renamed definition takes its values with it, so the items keep what they carry. The
     * definition it was renamed from is removed, and so is one whose inheritance changed:
     * `set-attribute` writes the value of a definition that already exists and nothing else, so
     * the new inheritance would be dropped unless the definition is written afresh.
     */
    const save = useCallback(async () => {
        const definition = edited.current;
        const was = original.current;
        setDetail(null);
        if (!definition?.name.includes(":")) {
            return;
        }

        const [ type, name ] = extractAttributeDefinitionTypeAndName(definition.name);
        const isRenamed = !!was && was.name !== definition.name;
        if (!was) {
            madeHere.current.add(name);
        }
        if (isRenamed && was) {
            const [ , previous ] = extractAttributeDefinitionTypeAndName(was.name);
            await renameAttributeInSubtree(note.noteId, type, previous, name);
        }

        if (was && (isRenamed || was.isInheritable !== definition.isInheritable)) {
            await removeOwnedAttributesByNameOrType(note, "label", was.name);
        }

        await attributes.setLabel(
            note.noteId, definition.name, definition.value, definition.isInheritable);
    }, [ note ]);

    /**
     * Deletes the definition and every value written against it. Deleting it from the attributes
     * panel instead leaves the items carrying values no definition describes.
     */
    const erase = useCallback(async (definitionName: string) => {
        const [ type, name ] = extractAttributeDefinitionTypeAndName(definitionName);
        const deletion = async () => {
            await deleteAttributeInSubtree(note.noteId, type, name);
            await removeOwnedAttributesByNameOrType(note, "label", definitionName);
        };
        await (runDeletion ? runDeletion(deletion, type, name) : deletion());
    }, [ note, runDeletion ]);

    /** Deletes the definition the editor was opened on. */
    const removeEdited = useCallback(async () => {
        const definition = original.current;
        setDetail(null);
        if (definition?.name.includes(":")) {
            await erase(definition.name);
        }
    }, [ erase ]);

    /** Confirms first: the values on the items are deleted with the definition. */
    const confirmErase = useCallback(async (attribute: PromotedAttribute) => {
        const confirmed = await dialog.confirm(
            t("promoted_attributes.delete_confirmation", { name: attribute.title }));
        if (confirmed) {
            await erase(attribute.definitionName);
        }
    }, [ erase ]);

    return (
        <>
            <SortableCard
                className="promoted-attributes-card"
                heading={heading}
                description={instruction}
                items={items}
                onChange={reorder}
                // The grip leads, so the trailing edge is left to the toggle each entry carries.
                gripPlacement="start"
                renderItem={(item) => {
                    const attribute = shown.find((candidate) => candidate.name === item.key);
                    return attribute && (
                        <>
                            <TooltipIcon
                                icon={item.icon}
                                tooltip={promotedAttributeType(attribute).title}
                                tooltipClass="tooltip-top"
                                role="img"
                                aria-label={promotedAttributeType(attribute).title}
                            />
                            <span className="promoted-attribute-name">{item.caption}</span>

                            {attribute.isConflicting && (
                                <Badge
                                    className="promoted-attribute-conflict"
                                    icon="bx bx-error-circle"
                                    text={t("promoted_attributes.conflicting")}
                                    tooltip={t("promoted_attributes.conflicting_tooltip")}
                                    outline
                                />
                            )}

                            {!attribute.isDefinedByItems && <>
                                <ActionButton
                                    className="promoted-attribute-edit"
                                    icon="bx bx-edit"
                                    text={t("promoted_attributes.edit_attribute")}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        openEditor(event, attribute);
                                    }}
                                />

                                <ActionButton
                                    className="promoted-attribute-delete"
                                    icon="bx bx-trash"
                                    text={t("promoted_attributes.delete_attribute")}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        confirmErase(attribute);
                                    }}
                                />
                            </>}

                            <FormToggle
                                currentValue={!attribute.hidden && !attribute.drawnByCollection}
                                disabled={attribute.drawnByCollection}
                                switchOnTooltip={t("promoted_attributes.display_on_items")}
                                switchOffTooltip={attribute.drawnByCollection
                                    ? t("promoted_attributes.drawn_by_collection")
                                    : t("promoted_attributes.display_on_items")}
                                onChange={(visible) => setHidden(attribute.name, !visible)}
                            />
                        </>
                    );
                }}
                itemCreationButtons={[
                    {
                        label: t("promoted_attributes.create_attribute"),
                        icon: "bx bx-plus",
                        // The editor answers for what is made, and the definition it writes arrives
                        // as an attribute change: one that is not promoted resolves to nothing and
                        // so is never listed.
                        onCreateItem: (event) => {
                            openEditor(event);
                            return undefined;
                        }
                    }
                ]}
            />

            {createPortal(
                <AttributeDetail
                    opts={detail}
                    currentNoteId={note.noteId}
                    onDismiss={() => setDetail(null)}
                    onCancel={() => setDetail(null)}
                    onAttributesChanged={([ definition ]) => { edited.current = definition; }}
                    onSaveAndClose={save}
                    onDelete={removeEdited}
                />,
                document.body)}
        </>
    );
}

/** Returns the definition names of `notes`, sorted and joined, for comparing between renders. */
function definitionNames(notes: Iterable<FNote> | undefined) {
    const names = new Set<string>();
    for (const note of notes ?? []) {
        for (const definition of note.getAttributeDefinitions()) {
            names.add(definition.name);
        }
    }
    return [ ...names ].sort().join(",");
}

/** The kind entry for an attribute: its `labelType`, or the relation kind for a relation. */
function promotedAttributeType(attribute: PromotedAttribute) {
    const kind = attribute.type === "relation"
        ? RELATION_DEFINITION_TYPE
        : attribute.labelType ?? "text";

    return TYPES.get(kind) ?? DEFAULT_TYPE;
}
