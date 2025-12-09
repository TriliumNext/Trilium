export type LabelType = "text" | "number" | "boolean" | "date" | "datetime" | "time" | "url" | "color";
type Multiplicity = "single" | "multi";

export interface DefinitionObject {
    isPromoted?: boolean;
    labelType?: LabelType;
    multiplicity?: Multiplicity;
    numberPrecision?: number;
    promotedAlias?: string;
    inverseRelation?: string;
}

function parse(value: string) {
    const tokens = value.split(",").map((t) => t.trim());
    const defObj: DefinitionObject = {};

    for (const token of tokens) {
        if (token === "promoted") {
            defObj.isPromoted = true;
        } else if (["text", "number", "boolean", "date", "datetime", "time", "url", "color"].includes(token)) {
            defObj.labelType = token as LabelType;
        } else if (["single", "multi"].includes(token)) {
            defObj.multiplicity = token as Multiplicity;
        } else if (token.startsWith("precision")) {
            const chunks = token.split("=");

            defObj.numberPrecision = parseInt(chunks[1]);
        } else if (token.startsWith("alias")) {
            const chunks = token.split("=");

            defObj.promotedAlias = chunks[1];
        } else if (token.startsWith("inverse")) {
            const chunks = token.split("=");

            defObj.inverseRelation = chunks[1];
        } else {
            console.log("Unrecognized attribute definition token:", token);
        }
    }

    return defObj;
}

/**
 * For an attribute definition name (e.g. `label:TEST:TEST1`), extracts its type (label) and name (TEST:TEST1).
 * @param definitionAttrName the attribute definition name, without the leading `#` (e.g. `label:TEST:TEST1`)
 * @return a tuple of [type, name].
 */
export function extractAttributeDefinitionTypeAndName(definitionAttrName: string): [ "label" | "relation", string ] {
    const valueType = definitionAttrName.startsWith("label:") ? "label" : "relation";
    const valueName = definitionAttrName.substring(valueType.length + 1);
    return [ valueType, valueName ];
}

export default {
    parse
};
