import FNote from "../../../entities/fnote";
import { Attribute } from "../../../services/attribute_parser";

export function getFAttributeFromField(parentNote: FNote, field: string) {
    const [ type, name ] = field.split(".", 2);
    const attrName = `${type.replace("s", "")}:${name}`;
    return parentNote.getLabel(attrName);
}

export function getAttributeFromField(parentNote: FNote, field: string): Attribute | undefined {
    const fAttribute = getFAttributeFromField(parentNote, field);
    if (fAttribute) {
        return {
            name: fAttribute.name,
            value: fAttribute.value,
            type: fAttribute.type,
            isInheritable: fAttribute.isInheritable
        };
    }
    return undefined;
}
