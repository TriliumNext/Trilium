import { filterAttributeName } from "./attribute_names.js";

/**
 * Every label type a promoted attribute definition may declare, in the order they are offered to
 * the user. This is the runtime source of truth: {@link LabelType} is derived from it, so a new
 * type cannot be added to the union without {@link parse} also accepting it.
 */
export const LABEL_TYPES = [
    "text", "textarea", "number", "boolean", "select", "date", "datetime", "time", "url", "email",
    "phone", "color"
] as const;

export type LabelType = typeof LABEL_TYPES[number];

export const MULTIPLICITIES = [ "single", "multi" ] as const;

export type Multiplicity = typeof MULTIPLICITIES[number];

export interface DefinitionObject {
    isPromoted?: boolean;
    labelType?: LabelType;
    multiplicity?: Multiplicity;
    numberPrecision?: number;
    /** The values a `select` field offers, in the order they are offered. */
    selectOptions?: string[];
    promotedAlias?: string;
    inverseRelation?: string;
}

/**
 * Parses the comma-separated form a definition is stored in, e.g.
 * `promoted,alias=Foo,single,number,precision=2`.
 *
 * Tokens are matched leniently: whitespace around them is trimmed, a later token of the same kind
 * wins over an earlier one, and an unrecognized token is logged and skipped rather than throwing,
 * so a definition written by a newer version degrades to its recognized parts instead of being
 * lost.
 *
 * @param value the raw attribute value of a `label:`/`relation:` definition attribute.
 */
function parse(value: string): DefinitionObject {
    const tokens = value.split(",").map((t) => t.trim());
    const defObj: DefinitionObject = {};

    for (const token of tokens) {
        if (token === "promoted") {
            defObj.isPromoted = true;
        } else if (isLabelType(token)) {
            defObj.labelType = token;
        } else if (isMultiplicity(token)) {
            defObj.multiplicity = token;
        } else if (token.startsWith("precision")) {
            // A missing value parses to NaN, which the consumers treat as "no precision set".
            defObj.numberPrecision = parseInt(parameterValue(token) ?? "");
        } else if (token.startsWith("options")) {
            // A blank entry offers nothing to pick and is dropped, so `options=` and a stray `;;`
            // both parse to what they mean rather than to invisible choices.
            defObj.selectOptions = (parameterValue(token) ?? "")
                .split(";")
                .filter((option) => option !== "")
                .map(decodeOption);
        } else if (token.startsWith("alias")) {
            defObj.promotedAlias = parameterValue(token);
        } else if (token.startsWith("inverse")) {
            // An inverse relation is a relation name, so the same characters are dropped as when
            // one is written by `serialize`. Definitions reaching us from an import, ETAPI or a
            // hand-typed attribute are not otherwise guaranteed to hold a usable name.
            defObj.inverseRelation = filterAttributeName(parameterValue(token) ?? "");
        } else {
            console.log("Unrecognized attribute definition token:", token);
        }
    }

    return defObj;
}

/**
 * Serializes a definition back into the comma separated form stored in the attribute value, e.g.
 * `promoted,alias=Foo,single,number,precision=2`. The inverse of {@link parse}.
 *
 * The multiplicity and the label type are always written out, falling back to the defaults their
 * consumers assume (`single` and `text`) rather than to the empty token {@link parse} would reject.
 *
 * @param definition the definition to serialize.
 * @param valueType whether the definition describes a label or a relation, which decides between
 *                  writing a label type and writing an inverse relation.
 */
function serialize(definition: DefinitionObject, valueType: "label" | "relation") {
    const props: string[] = [];

    if (definition.isPromoted) {
        props.push("promoted");
    }

    // Not only the promoted field's label: the table view titles its columns with it and the attribute
    // list names its values by it, neither of which asks whether the attribute is promoted.
    if (definition.promotedAlias) {
        props.push(`alias=${definition.promotedAlias}`);
    }

    props.push(definition.multiplicity ?? "single");

    if (valueType === "label") {
        const labelType = definition.labelType ?? "text";
        props.push(labelType);

        // A precision is only meaningful for numbers, and only once it has been set.
        if (labelType === "number" && definition.numberPrecision !== undefined) {
            props.push(`precision=${definition.numberPrecision}`);
        }

        // Options are only meaningful for a select, and an empty list means the same as none at all.
        if (labelType === "select" && definition.selectOptions?.length) {
            props.push(`options=${definition.selectOptions.map(encodeOption).join(";")}`);
        }
    } else if (definition.inverseRelation?.trim()) {
        props.push(`inverse=${filterAttributeName(definition.inverseRelation)}`);
    }

    return props.join(",");
}

/**
 * For an attribute definition name (e.g. `label:TEST:TEST1`), extracts its type (label) and name
 * (TEST:TEST1).
 * @param definitionAttrName the attribute definition name, without the leading `#`
 *                           (e.g. `label:TEST:TEST1`)
 * @return a tuple of [type, name].
 */
export function extractAttributeDefinitionTypeAndName(
    definitionAttrName: string
): [ "label" | "relation", string ] {
    const valueType = definitionAttrName.startsWith("label:") ? "label" : "relation";
    const valueName = definitionAttrName.substring(valueType.length + 1);
    return [ valueType, valueName ];
}

/**
 * Reads the value out of a `key=value` token, or `undefined` when the token carries no `=` at all.
 *
 * Only the first `=` separates the two: a value may legitimately contain one (an alias such as
 * `alias=a=b`), and splitting on every occurrence would silently truncate it at the second.
 */
function parameterValue(token: string): string | undefined {
    const separatorIndex = token.indexOf("=");
    return separatorIndex < 0 ? undefined : token.substring(separatorIndex + 1);
}

/**
 * Escapes a select option for storage inside the `options=` token, where `;` separates the options
 * and `,` would be cut by the definition tokenizer before this module ever saw it.
 *
 * Substitution (URL-style) rather than a `\`-escape on purpose: an escaped form must not *contain*
 * the raw separators, or every already-shipped parser — the split in {@link parse} runs before any
 * token logic — would cut straight through it, and the fragments of an option could even spell a
 * live token (`multi`, a label type, …) and be executed as one. `%` is the only character claimed
 * from the option itself, and the exact triplets below essentially never occur in natural text.
 */
function encodeOption(option: string): string {
    // `%` first, so the escapes written below are not re-escaped.
    return option.replace(/%/g, "%25").replace(/,/g, "%2C").replace(/;/g, "%3B");
}

/** The exact inverse of {@link encodeOption}: `%25` last, so a decoded `%` cannot start a triplet. */
function decodeOption(option: string): string {
    return option.replace(/%2C/gi, ",").replace(/%3B/gi, ";").replace(/%25/gi, "%");
}

function isLabelType(token: string): token is LabelType {
    return (LABEL_TYPES as readonly string[]).includes(token);
}

function isMultiplicity(token: string): token is Multiplicity {
    return (MULTIPLICITIES as readonly string[]).includes(token);
}

export default {
    parse,
    serialize
};
