import { DefinitionObject, LabelType, Multiplicity } from "@triliumnext/commons";

function parse(value: string): DefinitionObject {
    const tokens = value.split(",").map((t) => t.trim());
    const defObj: DefinitionObject = {};

    for (const token of tokens) {
        if (token === "promoted") {
            defObj.isPromoted = true;
        } else if (["text", "number", "boolean", "date", "datetime", "time", "url"].includes(token)) {
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

            defObj.inverseRelation = chunks[1].replace(/[^\p{L}\p{N}_:]/gu, "");
        } else {
            console.log("Unrecognized attribute definition token:", token);
        }
    }

    return defObj;
}

export default {
    parse
};
