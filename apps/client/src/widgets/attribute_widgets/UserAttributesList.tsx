import { useState } from "preact/hooks";
import FNote from "../../entities/fnote";
import "./UserAttributesList.css";
import { useTriliumEvent } from "../react/hooks";
import attributes from "../../services/attributes";
import { DefinitionObject } from "../../services/promoted_attribute_definition_parser";
import { formatDateTime } from "../../utils/formatters";
import { ComponentChildren, CSSProperties } from "preact";
import Icon from "../react/Icon";
import NoteLink from "../react/NoteLink";
import { getReadableTextColor } from "../../services/css_class_manager";

interface UserAttributesListProps {
    note: FNote;
    ignoredAttributes?: string[];
}

interface AttributeWithDefinitions {
    friendlyName: string;
    name: string;
    type: string;
    value: string;
    def: DefinitionObject;
}

export default function UserAttributesDisplay({ note, ignoredAttributes }: UserAttributesListProps) {
    const userAttributes = useNoteAttributesWithDefinitions(note, ignoredAttributes);
    return userAttributes?.length > 0 && (
        <div className="user-attributes">
            {userAttributes?.map(attr => buildUserAttribute(attr))}
        </div>
    )

}

function useNoteAttributesWithDefinitions(note: FNote, attributesToIgnore:  string[] = []): AttributeWithDefinitions[] {
    const [ userAttributes, setUserAttributes ] = useState<AttributeWithDefinitions[]>(getAttributesWithDefinitions(note, attributesToIgnore));

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().some(attr => attributes.isAffecting(attr, note))) {
            setUserAttributes(getAttributesWithDefinitions(note, attributesToIgnore));
        }
    });

    return userAttributes;
}

function UserAttribute({ attr, children, style }: { attr: AttributeWithDefinitions, children: ComponentChildren, style?: CSSProperties }) {
    const className = `${attr.type === "label" ? "label" + " " + attr.def.labelType : "relation"}`;

    return (
        <span key={attr.friendlyName} className={`user-attribute type-${className}`} style={style}>
            {children}
        </span>
    )
}

function buildUserAttribute(attr: AttributeWithDefinitions): ComponentChildren {
    const defaultLabel = <><strong>{attr.friendlyName}:</strong>{" "}</>;
    let content: ComponentChildren;
    let style: CSSProperties | undefined;

    if (attr.type === "label") {
        let value = attr.value;
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
                content = <a href={value} target="_blank" rel="noopener noreferrer">{attr.friendlyName}</a>;
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

    return <UserAttribute attr={attr} style={style}>{content}</UserAttribute>
}

function getAttributesWithDefinitions(note: FNote, attributesToIgnore: string[] = []): AttributeWithDefinitions[] {
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
    return result;
}
