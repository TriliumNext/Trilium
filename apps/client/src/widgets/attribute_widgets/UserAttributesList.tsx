import "./UserAttributesList.css";

import type { DefinitionObject } from "@triliumnext/commons";
import { ComponentChildren, CSSProperties } from "preact";
import { useEffect, useState } from "preact/hooks";

import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import { getReadableTextColor } from "../../services/css_class_manager";
import { formatDateTime } from "../../utils/formatters";
import { useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import NoteLink from "../react/NoteLink";

interface UserAttributesListProps {
    note: FNote;
    ignoredAttributes?: string[];
    /**
     * The attributes to draw, by name and in the order they are given. Without it every attribute
     * carrying a definition is drawn, in the order the definitions stand in.
     */
    shownAttributes?: string[];
    /** Drawn before the attributes, for what a caller marks a note with in the same row. */
    badges?: ComponentChildren;
}

interface AttributeWithDefinitions {
    friendlyName: string;
    name: string;
    type: string;
    value: string;
    def: DefinitionObject;
}

export default function UserAttributesDisplay({
    note, ignoredAttributes, shownAttributes, badges
}: UserAttributesListProps) {
    const userAttributes = useNoteAttributesWithDefinitions(note, ignoredAttributes, shownAttributes);
    return (userAttributes?.length > 0 || !!badges) && (
        <div className="user-attributes">
            {badges}
            {userAttributes?.map(attr => buildUserAttribute(attr))}
        </div>
    );

}

function useNoteAttributesWithDefinitions(
    note: FNote, attributesToIgnore: string[] = [], shown?: string[]
): AttributeWithDefinitions[] {
    const [ userAttributes, setUserAttributes ] = useState<AttributeWithDefinitions[]>(
        getAttributesWithDefinitions(note, attributesToIgnore, shown));

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().some(attr => attributes.isAffecting(attr, note))) {
            setUserAttributes(getAttributesWithDefinitions(note, attributesToIgnore, shown));
        }
    });

    // What is drawn and in what order is the caller's, and it changes as the reader arranges it.
    const key = shown?.join(",");
    useEffect(() => {
        setUserAttributes(getAttributesWithDefinitions(note, attributesToIgnore, shown));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ note, key ]);

    return userAttributes;
}

function UserAttribute({ attr, children, style }: { attr: AttributeWithDefinitions, children: ComponentChildren, style?: CSSProperties }) {
    const className = attr.type === "label" ? `label ${attr.def.labelType}` : "relation";

    return (
        <span key={attr.friendlyName} className={`user-attribute type-${className}`} style={style}>
            {children}
        </span>
    );
}

function buildUserAttribute(attr: AttributeWithDefinitions): ComponentChildren {
    const defaultLabel = <><strong>{attr.friendlyName}:</strong>{" "}</>;
    let content: ComponentChildren;
    let style: CSSProperties | undefined;

    if (attr.type === "label") {
        const value = attr.value;
        switch (attr.def.labelType) {
            case "number":
                let formattedValue = value;
                const numberValue = Number(value);
                if (!Number.isNaN(numberValue) && attr.def.numberPrecision) formattedValue = numberValue.toFixed(attr.def.numberPrecision);
                content = <>{defaultLabel}{formattedValue}</>;
                break;
            case "date":
            case "datetime": {
                const date = new Date(value);
                const timeFormat = attr.def.labelType !== "date" ? "short" : "none";
                const formattedValue = formatDateTime(date, "short", timeFormat);
                content = <>{defaultLabel}{formattedValue}</>;
                break;
            }
            case "time": {
                const date = new Date(`1970-01-01T${value}Z`);
                const formattedValue = formatDateTime(date, "none", "short");
                content = <>{defaultLabel}{formattedValue}</>;
                break;
            }
            case "boolean":
                content = <><Icon icon={value === "true" ? "bx bx-check-square" : "bx bx-square"} />{" "}<strong>{attr.friendlyName}</strong></>;
                break;
            case "url":
                content = <a href={value} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{attr.friendlyName}</a>;
                break;
            // The address is short enough to show, and is the part worth clicking; the scheme check
            // keeps a value imported as a url label (already schemed) from being doubled.
            case "email":
                content = <>{defaultLabel}<a href={value.startsWith("mailto:") ? value : `mailto:${value}`} onClick={(e) => e.stopPropagation()}>{value}</a></>;
                break;
            case "phone":
                content = <>{defaultLabel}<a href={value.startsWith("tel:") ? value : `tel:${value}`} onClick={(e) => e.stopPropagation()}>{value}</a></>;
                break;
            case "color":
                style = { backgroundColor: value, color: getReadableTextColor(value) };
                content = <>{attr.friendlyName}</>;
                break;
            case "text":
            default:
                content = <>{defaultLabel}{value}</>;
                break;
        }
    } else if (attr.type === "relation") {
        content = <>{defaultLabel}<NoteLink notePath={attr.value} showNoteIcon /></>;
    }

    return <UserAttribute attr={attr} style={style}>{content}</UserAttribute>;
}

function getAttributesWithDefinitions(
    note: FNote, attributesToIgnore: string[] = [], shown?: string[]
): AttributeWithDefinitions[] {
    const attributeDefintions = note.getAttributeDefinitions();
    const result: AttributeWithDefinitions[] = [];
    for (const attr of attributeDefintions) {
        const def = attr.getDefinition();
        const [ type, name ] = attr.name.split(":", 2);
        const friendlyName = def?.promotedAlias || name;
        const props: Omit<AttributeWithDefinitions, "value"> = { def, name, type, friendlyName };

        if (attributesToIgnore.includes(name)) continue;

        if (type === "label") {
            const labels = note.getLabels(name);
            for (const label of labels) {
                if (!label.value) continue;
                result.push({ ...props, value: label.value } );
            }
        } else if (type === "relation") {
            const relations = note.getRelations(name);
            for (const relation of relations) {
                if (!relation.value) continue;
                result.push({ ...props, value: relation.value } );
            }
        }
    }

    if (!shown) {
        return result;
    }

    // Sorted rather than gathered in the given order, so an attribute carrying several values keeps
    // them together: the sort is stable, and they were pushed one after another above.
    const at = new Map(shown.map((name, index) => [ name, index ]));
    return result
        .filter(attr => at.has(attr.name))
        .sort((a, b) => (at.get(a.name) ?? 0) - (at.get(b.name) ?? 0));
}
