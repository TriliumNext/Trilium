/**
 * Safe template evaluator that replaces eval()-based template string interpolation.
 *
 * Supports only a controlled set of operations within ${...} expressions:
 * - Property access chains: `obj.prop.subprop`
 * - Method calls with a single string literal argument: `obj.method('arg')`
 * - Chained combinations: `obj.prop.method('arg')`
 *
 * This prevents arbitrary code execution while supporting the documented
 * titleTemplate, bulk rename and calendar event title use cases:
 * - ${now.format('YYYY-MM-DD')}
 * - ${parentNote.title}
 * - ${parentNote.getLabelValue('authorName')}
 * - ${note.title}
 * - ${note.dateCreatedObj.format('MM-DD')}
 * - ${title} (${years})
 */

/** Allowed method names that can be called on template variables. */
export const TEMPLATE_ALLOWED_METHODS: ReadonlySet<string> = new Set([
    "format",
    "getLabelValue",
    "getLabel",
    "getLabelValues",
    "getRelationValue",
    "getAttributeValue"
]);

/** Allowed property names that can be accessed on template variables. */
export const TEMPLATE_ALLOWED_PROPERTIES: ReadonlySet<string> = new Set([
    "title",
    "type",
    "mime",
    "noteId",
    "dateCreated",
    "dateModified",
    "utcDateCreated",
    "utcDateModified",
    "dateCreatedObj",
    "utcDateCreatedObj",
    "isProtected",
    "content"
]);

export interface TemplateVariables {
    [key: string]: unknown;
}

/** What a template value holds: a `BNote`, a `dayjs` date, or a string or other plain value. */
export type TemplateValueType = "note" | "date" | "text";

/** The variables a template can read, by name, and what each holds. */
export type TemplateVariableTypes = Readonly<Record<string, TemplateValueType>>;

const TEMPLATE_METHODS_OF: Readonly<Record<TemplateValueType, ReadonlySet<string>>> = {
    note: new Set([ "getLabelValue", "getLabel", "getLabelValues", "getRelationValue", "getAttributeValue" ]),
    date: new Set([ "format" ]),
    text: new Set()
};

const NOTE_DATE_PROPERTIES: ReadonlySet<string> = new Set([ "dateCreatedObj", "utcDateCreatedObj" ]);

/**
 * Why {@link findTemplateIssues} refuses an expression, which `evaluateTemplate()` would throw for,
 * with the variable, property or method refused for the kinds that name one.
 */
export type TemplateProblem =
    | { kind: "unclosed" | "unsupported"; name: undefined }
    | { kind: "unknownVariable" | "propertyNotAllowed" | "methodNotAllowed" | "methodNotOnValue"; name: string };

export type TemplateIssueKind = TemplateProblem["kind"];

/** A refused expression, and where its `${...}` starts and ends in the template. */
export type TemplateIssue = TemplateProblem & { from: number; to: number };

// `{` is excluded too, so a `${` without a closing brace scans only to the next brace.
const EXPRESSION = /\$\{([^{}]+)\}/g;
const METHOD_CALL = /^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\.([a-zA-Z_]\w*)\(\s*(?:(?:'([^']*)'|"([^"]*)")\s*)?\)$/;
const PROPERTY_CHAIN = /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/;

/**
 * Evaluates a template string safely without using eval().
 *
 * Template strings can contain ${...} expressions which are evaluated
 * against the provided variables map.
 *
 * @param template - The template string, e.g. "Note: ${now.format('YYYY-MM-DD')}"
 * @param variables - Map of variable names to their values
 * @returns The interpolated string
 * @throws Error if an expression cannot be safely evaluated
 */
export function evaluateTemplate(template: string, variables: TemplateVariables): string {
    return template.replace(EXPRESSION, (_match, expression: string) => {
        const result = evaluateExpression(expression.trim(), variables);
        return result == null ? "" : String(result);
    });
}

/**
 * Lists the expressions of `template` that `evaluateTemplate()` refuses when given values of
 * `variables`, without evaluating anything, so an editor can mark them as they are typed. Also lists
 * a `${` that is never closed, which `evaluateTemplate()` leaves in the result as text.
 */
export function findTemplateIssues(template: string, variables: TemplateVariableTypes): TemplateIssue[] {
    const issues: TemplateIssue[] = [];
    let closedUpTo = 0;

    for (const match of template.matchAll(EXPRESSION)) {
        const from = match.index;
        const to = from + match[0].length;
        reportUnclosed(template.slice(closedUpTo, from), closedUpTo, issues);
        closedUpTo = to;

        const problem = checkExpression(parseExpression(match[1].trim()), variables);
        if (problem) {
            issues.push({ ...problem, from, to });
        }
    }

    reportUnclosed(template.slice(closedUpTo), closedUpTo, issues);
    return issues;
}

function reportUnclosed(text: string, offset: number, issues: TemplateIssue[]) {
    const start = text.indexOf("${");
    if (start >= 0) {
        issues.push({ kind: "unclosed", from: offset + start, to: offset + text.length, name: undefined });
    }
}

/** An expression broken into the variable, the properties read off it and the method called last. */
interface ParsedExpression {
    chain: string[];
    method?: { name: string; arg: string | undefined };
}

function parseExpression(expr: string): ParsedExpression | null {
    const methodCall = expr.match(METHOD_CALL);
    if (methodCall) {
        const [ , chain, name, singleQuoteArg, doubleQuoteArg ] = methodCall;
        return { chain: chain.split("."), method: { name, arg: singleQuoteArg ?? doubleQuoteArg } };
    }

    return PROPERTY_CHAIN.test(expr) ? { chain: expr.split(".") } : null;
}

/** What `evaluateExpression()` throws for `parsed` when the variables hold values of `variables`. */
function checkExpression(parsed: ParsedExpression | null, variables: TemplateVariableTypes): TemplateProblem | null {
    if (!parsed) {
        return { kind: "unsupported", name: undefined };
    }
    if (parsed.method && !TEMPLATE_ALLOWED_METHODS.has(parsed.method.name)) {
        return { kind: "methodNotAllowed", name: parsed.method.name };
    }

    const [ root, ...properties ] = parsed.chain;
    if (!Object.hasOwn(variables, root)) {
        return { kind: "unknownVariable", name: root };
    }

    const refused = properties.find((property) => !TEMPLATE_ALLOWED_PROPERTIES.has(property));
    if (refused) {
        return { kind: "propertyNotAllowed", name: refused };
    }

    // A method on a missing value gives an empty result, so only a value of a known type is checked.
    const target = resolveChainType(variables[root], properties);
    if (parsed.method && target && !TEMPLATE_METHODS_OF[target].has(parsed.method.name)) {
        return { kind: "methodNotOnValue", name: parsed.method.name };
    }
    return null;
}

/** What reading `properties` off a value of `type` gives, or `undefined` when it gives nothing. */
function resolveChainType(type: TemplateValueType, properties: readonly string[]): TemplateValueType | undefined {
    let current: TemplateValueType | undefined = type;
    for (const property of properties) {
        if (current !== "note") {
            return undefined;
        }
        current = NOTE_DATE_PROPERTIES.has(property) ? "date" : "text";
    }
    return current;
}

/**
 * Evaluates a single expression like "now.format('YYYY-MM-DD')" or "parentNote.title".
 *
 * Supported forms:
 * - `varName` -> variables[varName]
 * - `varName.prop` -> variables[varName].prop
 * - `varName.prop1.prop2` -> variables[varName].prop1.prop2
 * - `varName.method('arg')` -> variables[varName].method('arg')
 * - `varName.method()` -> variables[varName].method()
 * - `varName.prop.method('arg')` -> variables[varName].prop.method('arg')
 */
function evaluateExpression(expr: string, variables: TemplateVariables): unknown {
    const parsed = parseExpression(expr);

    if (!parsed) {
        throw new Error(`Template expression '${expr}' is not a supported expression. ` +
            `Only property access and whitelisted method calls are allowed.`);
    }

    if (!parsed.method) {
        return resolvePropertyChain(parsed.chain, variables);
    }

    const { name, arg } = parsed.method;
    if (!TEMPLATE_ALLOWED_METHODS.has(name)) {
        throw new Error(`Method '${name}' is not allowed in template expressions`);
    }

    const target = resolvePropertyChain(parsed.chain, variables);
    if (target == null) {
        return null;
    }

    const method = (target as Record<string, unknown>)[name];
    if (typeof method !== "function") {
        throw new Error(`'${name}' is not a function on the resolved object`);
    }

    return arg === undefined
        ? (method as () => unknown).call(target)
        : (method as (arg: string) => unknown).call(target, arg);
}

/**
 * Resolves a property chain like ["parentNote", "title"] against variables.
 */
function resolvePropertyChain(parts: string[], variables: TemplateVariables): unknown {
    const rootName = parts[0];

    if (!Object.hasOwn(variables, rootName)) {
        throw new Error(`Unknown variable '${rootName}' in template expression`);
    }

    let current: unknown = variables[rootName];

    for (let i = 1; i < parts.length; i++) {
        if (current == null) {
            return null;
        }

        const prop = parts[i];
        if (!TEMPLATE_ALLOWED_PROPERTIES.has(prop)) {
            throw new Error(`Property '${prop}' is not allowed in template expressions`);
        }

        current = (current as Record<string, unknown>)[prop];
    }

    return current;
}
