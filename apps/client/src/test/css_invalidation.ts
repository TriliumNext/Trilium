import { type Selector, type SelectorComponent, transform } from "lightningcss";

/**
 * A selector shape that makes Chromium restyle a whole container when an element is inserted
 * into it, or a whole editor when it gains or loses focus. Chromium keys sibling and position
 * invalidation by class, id and attribute only, and descendant invalidation also by tag.
 */
export type SlowShape =
    | "sibling-then-universal"
    | "positional-then-universal"
    | "focus-then-universal"
    | "keyless-sibling"
    | "keyless-nth";

export interface SlowSelector {
    shape: SlowShape;
    selector: string;
}

/** Lists the selectors of the stylesheet `code` that have a {@link SlowShape}. */
export function findSlowSelectors(code: string, filename: string): SlowSelector[] {
    // Lowering for an engine without nesting turns each `&` into the full selector.
    const flat = transform({
        filename,
        code: new TextEncoder().encode(code),
        targets: { chrome: 100 << 16 },
        errorRecovery: true
    }).code;
    const found: SlowSelector[] = [];
    transform({
        filename,
        code: flat,
        errorRecovery: true,
        visitor: {
            Rule: {
                style(rule) {
                    for (const selector of rule.value.selectors) {
                        const shape = classifySelector(selector);
                        if (shape) {
                            found.push({ shape, selector: serializeSelector(selector) });
                        }
                    }
                }
            }
        }
    });
    return found;
}

const NTH = new Set([
    "nth-child", "nth-last-child", "nth-of-type", "nth-last-of-type",
    "first-of-type", "last-of-type", "only-of-type"
]);
const POSITIONAL = new Set([ ...NTH, "first-child", "last-child", "only-child" ]);
const LOGICAL = new Set([ "is", "where" ]);
/** The classes CKEditor toggles on the editable each time it gains or loses focus. */
const FOCUS_CLASSES = new Set([ "ck-focused", "ck-blurred" ]);

interface Compound {
    combinator: string | null;
    parts: SelectorComponent[];
}

/** The {@link SlowShape} of `selector`, or `null`. */
export function classifySelector(selector: Selector): SlowShape | null {
    const compounds = splitCompounds(selector);
    const isSibling = (compound: Compound) =>
        compound.combinator === "next-sibling" || compound.combinator === "later-sibling";

    for (const [ index, compound ] of compounds.entries()) {
        if (isSibling(compound) && compounds.slice(index).some(isBare)) {
            return "sibling-then-universal";
        }
    }
    for (const [ index, compound ] of compounds.entries()) {
        if (hasPseudo(compound.parts, POSITIONAL) && compounds.slice(index + 1).some(isBare)) {
            return "positional-then-universal";
        }
    }
    const subject = compounds[compounds.length - 1];
    const ancestors = compounds.slice(0, -1);
    if (isBare(subject) && ancestors.some((compound) => hasClass(compound.parts, FOCUS_CLASSES))) {
        return "focus-then-universal";
    }
    for (const [ index, compound ] of compounds.entries()) {
        if (isSibling(compound) && !hasKey(compounds[index - 1].parts) && !hasKey(subject.parts)) {
            return "keyless-sibling";
        }
    }
    if (compounds.some((compound) => hasPseudo(compound.parts, NTH) && !hasKey(compound.parts))) {
        return "keyless-nth";
    }
    return null;
}

function splitCompounds(selector: Selector): Compound[] {
    const compounds: Compound[] = [ { combinator: null, parts: [] } ];
    for (const component of selector) {
        if (component.type === "combinator") {
            compounds.push({ combinator: component.value, parts: [] });
        } else {
            compounds[compounds.length - 1].parts.push(component);
        }
    }
    return compounds;
}

/** Whether the compound names a class, id or attribute, the features Chromium keys on. */
function hasKey(parts: SelectorComponent[]): boolean {
    return parts.some((part) => part.type === "class" || part.type === "id"
        || part.type === "attribute"
        || (part.type === "pseudo-class" && LOGICAL.has(part.kind)
            && argumentsOf(part).every((argument) =>
                hasKey(splitCompounds(argument).at(-1)?.parts ?? []))));
}

/** Whether the compound matches any element: no class, id, attribute or tag. */
function isBare(compound: Compound): boolean {
    return !hasKey(compound.parts) && !compound.parts.some((part) => part.type === "type");
}

function hasPseudo(parts: SelectorComponent[], kinds: Set<string>): boolean {
    return parts.some((part) => part.type === "pseudo-class" && (kinds.has(part.kind)
        || argumentsOf(part).some((argument) =>
            splitCompounds(argument).some((compound) => hasPseudo(compound.parts, kinds)))));
}

function hasClass(parts: SelectorComponent[], names: Set<string>): boolean {
    return parts.some((part) => (part.type === "class" && names.has(part.name))
        || argumentsOf(part).some((argument) =>
            splitCompounds(argument).some((compound) => hasClass(compound.parts, names))));
}

/** The selector list of `:not()`, `:is()` or `:where()`, and none for other components. */
function argumentsOf(part: SelectorComponent): Selector[] {
    if (part.type === "pseudo-class" && (part.kind === "not" || part.kind === "is"
        || part.kind === "where")) {
        return part.selectors;
    }
    return [];
}

const COMBINATORS: Record<string, string> = {
    child: " > ", descendant: " ", "next-sibling": " + ", "later-sibling": " ~ "
};

/** A readable form of `selector` for test messages. */
function serializeSelector(selector: Selector): string {
    return selector.map((part) => {
        switch (part.type) {
            case "combinator": return COMBINATORS[part.value] ?? ` ${part.value} `;
            case "class": return `.${part.name}`;
            case "id": return `#${part.name}`;
            case "type": return part.name;
            case "universal": return "*";
            case "attribute": return `[${part.name}]`;
            case "pseudo-element": return `::${part.kind}`;
            case "pseudo-class": {
                const selectors = argumentsOf(part);
                if (selectors.length) {
                    return `:${part.kind}(${selectors.map(serializeSelector).join(", ")})`;
                }
                if ("a" in part) return `:${part.kind}(${part.a}n+${part.b})`;
                return `:${part.kind}`;
            }
            default: return `<${part.type}>`;
        }
    }).join("");
}
