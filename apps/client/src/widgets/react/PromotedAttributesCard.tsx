import "./PromotedAttributesCard.css";

import { createPortal } from "preact/compat";
import { useCallback, useMemo, useRef, useState } from "preact/hooks";

import type FNote from "../../entities/fnote";
import type { Attribute } from "../../services/attribute_parser";
import attributes, { removeOwnedAttributesByNameOrType } from "../../services/attributes";
import dialog from "../../services/dialog";
import { t } from "../../services/i18n";
import {
    AttributeDetail, type AttributeDetailOpts, DEFINITION_TYPES, RELATION_DEFINITION_TYPE
} from "../attribute_widgets/attribute_detail";
import {
    deleteAttributeInSubtree, type PromotedAttribute, type PromotedAttributeSetting,
    renameAttributeInSubtree, resolvePromotedAttributes, storedPromotedAttributes
} from "../collections/promoted_attributes";
import ActionButton from "./ActionButton";
import { Badge } from "./Badge";
import FormToggle from "./FormToggle";
import { useTriliumEvent } from "./hooks";
import Icon from "./Icon";
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
    /** Attributes the collection draws itself, such as the label a board groups by. */
    ignored?: string[];
    /** Called with the whole list after every change, for the caller to store. */
    onChange: (attributes: PromotedAttribute[]) => void;
}

/**
 * The promoted attributes a collection shows on its items, in the order they are shown.
 *
 * Entries are reordered, hidden without being deleted, edited or deleted through the attribute
 * editor, and created from the button at the foot. `note` carries the definitions; `onChange`
 * reports the order and what is hidden, which the caller stores.
 */
export default function PromotedAttributesCard({
    heading, instruction, note, settings, ignored, onChange
}: PromotedAttributesCardProps) {
    const [ shown, setShown ] = useState(() => resolvePromotedAttributes(note, settings, ignored));
    const [ detail, setDetail ] = useState<AttributeDetailOpts | null>(null);
    /** The definition the editor last reported, which `save` writes. */
    const edited = useRef<Attribute>();
    /** The definition the editor was handed, which `save` compares against to spot a rename. */
    const original = useRef<Attribute>();

    // A definition created, renamed or deleted here arrives as an attribute change. Resolving
    // against the current list is what keeps the order of the rest.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const affects = loadResults.getAttributeRows()
            .some((attribute) => attributes.isAffecting(attribute, note));
        if (affects) {
            setShown((was) =>
                resolvePromotedAttributes(note, storedPromotedAttributes(was), ignored));
        }
    });

    const items = useMemo(() => shown.map((attribute) => ({
        key: attribute.name,
        caption: attribute.title,
        icon: typeOf(attribute).icon
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
            y: event?.pageY ?? 150,
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

        const [ type, name ] = definition.name.split(":", 2) as [ "label" | "relation", string ];
        const isRenamed = !!was && was.name !== definition.name;
        if (isRenamed && was) {
            const [ , previous ] = was.name.split(":", 2);
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
        const [ type, name ] = definitionName.split(":", 2) as [ "label" | "relation", string ];
        await deleteAttributeInSubtree(note.noteId, type, name);
        await removeOwnedAttributesByNameOrType(note, "label", definitionName);
    }, [ note ]);

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
                            {item.icon && <Icon icon={item.icon} />}
                            <span className="promoted-attribute-name">{item.caption}</span>

                            <Badge
                                className="promoted-attribute-type"
                                text={typeOf(attribute).title}
                                outline
                            />

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

                            <FormToggle
                                currentValue={!attribute.hidden}
                                switchOnTooltip={t("promoted_attributes.shown_on_items")}
                                switchOffTooltip={t("promoted_attributes.hidden_from_items")}
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

/** The kind entry for an attribute: its `labelType`, or the relation kind for a relation. */
function typeOf(attribute: PromotedAttribute) {
    const kind = attribute.type === "relation"
        ? RELATION_DEFINITION_TYPE
        : attribute.labelType ?? "text";

    return TYPES.get(kind) ?? DEFAULT_TYPE;
}
