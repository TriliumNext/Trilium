/**
 * Safe template evaluator that replaces eval()-based template string interpolation.
 *
 * Supports only a controlled set of operations within ${...} expressions:
 * - Property access chains: `obj.prop.subprop`
 * - Method calls with a single string literal argument: `obj.method('arg')`
 * - Chained combinations: `obj.prop.method('arg')`
 *
 * This prevents arbitrary code execution while supporting the documented
 * titleTemplate and bulk rename use cases:
 * - ${now.format('YYYY-MM-DD')}
 * - ${parentNote.title}
 * - ${parentNote.getLabelValue('authorName')}
 * - ${note.title}
 * - ${note.dateCreatedObj.format('MM-DD')}
 */

import log from "./log.js";

/** Allowed method names that can be called on template variables. */
const ALLOWED_METHODS = new Set([
    "format",
    "getLabelValue",
    "getLabel",
    "getLabelValues",
    "getRelationValue",
    "getAttributeValue"
]);

/** Allowed property names that can be accessed on template variables. */
const ALLOWED_PROPERTIES = new Set([
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

interface TemplateVariables {
    [key: string]: unknown;
}

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
    return template.replace(/\$\{([^}]+)\}/g, (_match, expression: string) => {
        const result = evaluateExpression(expression.trim(), variables);
        return result == null ? "" : String(result);
    });
}

/**
 * Evaluates a single expression like "now.format('YYYY-MM-DD')" or "parentNote.title".
 *
 * Supported forms:
 * - `varName` -> variables[varName]
 * - `varName.prop` -> variables[varName].prop
 * - `varName.prop1.prop2` -> variables[varName].prop1.prop2
 * - `varName.method('arg')` -> variables[varName].method('arg')
 * - `varName.prop.method('arg')` -> variables[varName].prop.method('arg')
 */
function evaluateExpression(expr: string, variables: TemplateVariables): unknown {
    // Parse the expression into segments: variable name, property accesses, and optional method call.
    // We handle: varName(.propName)*.methodName('stringArg')?

    // First, check for a method call at the end: .methodName('arg') or .methodName("arg")
    const methodCallMatch = expr.match(
        /^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\.([a-zA-Z_]\w*)\(\s*(?:'([^']*)'|"([^"]*)")\s*\)$/
    );

    if (methodCallMatch) {
        const [, chainStr, methodName, singleQuoteArg, doubleQuoteArg] = methodCallMatch;
        const methodArg = singleQuoteArg !== undefined ? singleQuoteArg : doubleQuoteArg;

        if (!ALLOWED_METHODS.has(methodName)) {
            throw new Error(`Method '${methodName}' is not allowed in template expressions`);
        }

        const target = resolvePropertyChain(chainStr, variables);
        if (target == null) {
            return null;
        }

        const method = (target as Record<string, unknown>)[methodName];
        if (typeof method !== "function") {
            throw new Error(`'${methodName}' is not a function on the resolved object`);
        }

        return (method as (arg: string) => unknown).call(target, methodArg as string);
    }

    // Check for a no-arg method call at the end: .methodName()
    const noArgMethodMatch = expr.match(
        /^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\.([a-zA-Z_]\w*)\(\s*\)$/
    );

    if (noArgMethodMatch) {
        const [, chainStr, methodName] = noArgMethodMatch;

        if (!ALLOWED_METHODS.has(methodName)) {
            throw new Error(`Method '${methodName}' is not allowed in template expressions`);
        }

        const target = resolvePropertyChain(chainStr, variables);
        if (target == null) {
            return null;
        }

        const method = (target as Record<string, unknown>)[methodName];
        if (typeof method !== "function") {
            throw new Error(`'${methodName}' is not a function on the resolved object`);
        }

        return (method as () => unknown).call(target);
    }

    // Otherwise it's a pure property chain: varName.prop1.prop2...
    const propChainMatch = expr.match(/^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/);
    if (!propChainMatch) {
        throw new Error(`Template expression '${expr}' is not a supported expression. ` +
            `Only property access and whitelisted method calls are allowed.`);
    }

    return resolvePropertyChain(expr, variables);
}

/**
 * Resolves a dot-separated property chain like "parentNote.title" against variables.
 */
function resolvePropertyChain(chain: string, variables: TemplateVariables): unknown {
    const parts = chain.split(".");
    const rootName = parts[0];

    if (!(rootName in variables)) {
        throw new Error(`Unknown variable '${rootName}' in template expression`);
    }

    let current: unknown = variables[rootName];

    for (let i = 1; i < parts.length; i++) {
        if (current == null) {
            return null;
        }

        const prop = parts[i];
        if (!ALLOWED_PROPERTIES.has(prop)) {
            throw new Error(`Property '${prop}' is not allowed in template expressions`);
        }

        current = (current as Record<string, unknown>)[prop];
    }

    return current;
}

/**
 * Convenience wrapper that evaluates a template and catches errors,
 * logging them and returning the fallback value.
 */
export function evaluateTemplateSafe(
    template: string,
    variables: TemplateVariables,
    fallback: string,
    contextDescription: string
): string {
    try {
        return evaluateTemplate(template, variables);
    } catch (e: any) {
        log.error(`Template evaluation for ${contextDescription} failed with: ${e.message}`);
        return fallback;
    }
}
