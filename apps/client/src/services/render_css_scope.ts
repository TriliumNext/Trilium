/**
 * Class applied to the element a render note's markup is mounted into. It doubles as the root that
 * the note's own stylesheets are scoped to, so the two must stay in sync.
 */
export const RENDER_SCOPE_CLASS = "render-note-scope";

/**
 * Scopes every stylesheet the note has in `container`, and keeps scoping the ones it adds later.
 *
 * A render note's script can build its markup after the bundle's HTML is inserted, so the sheet
 * that has to be confined does not necessarily exist yet. Assigning to a style element's
 * `textContent` swaps its child text node, so watching `childList` over the subtree catches a
 * rewritten stylesheet as well as a newly appended one.
 *
 * Rules a script adds through `CSSStyleSheet.insertRule()` never touch the DOM and so cannot be
 * caught here, and neither can a stylesheet it appends to `document.head` instead.
 */
export function keepStylesScoped(container: HTMLElement) {
    scopeStyleElements(container.querySelectorAll("style"));

    const observer = new MutationObserver((records) => {
        for (const record of records) {
            if (record.target instanceof HTMLStyleElement) {
                scopeStyleElements([ record.target ]);
            }

            for (const node of record.addedNodes) {
                if (node instanceof HTMLStyleElement) {
                    scopeStyleElements([ node ]);
                } else if (node instanceof Element) {
                    scopeStyleElements(node.querySelectorAll("style"));
                }
            }
        }
    });

    observer.observe(container, { childList: true, subtree: true });
}

/**
 * Confines a render note's stylesheet to the note's own container.
 *
 * A `<style>` element applies to the whole document however deeply it is nested, so a standalone
 * HTML document's `body { max-width: … }` restyles the app. Wrapping the rules in `@scope` stops
 * that. Selectors that address the document root are rewritten to `:scope`, so they keep
 * styling the note instead of silently matching nothing.
 *
 * At-rules that define named resources (`@keyframes`, `@font-face`) stay outside the wrapper: they
 * are global by nature, and nesting them changes whether they parse at all.
 */
export function scopeRenderNoteCss(css: string): string {
    const hoisted: string[] = [];
    const scoped: string[] = [];

    for (const node of parseNodes(css)) {
        if (node.atName && HOISTED_AT_RULES.has(node.atName)) {
            hoisted.push(serialize(node, false));
        } else {
            scoped.push(serialize(node, true));
        }
    }

    const prefix = hoisted.length ? `${hoisted.join("\n")}\n` : "";
    if (!scoped.length) {
        return prefix.trimEnd();
    }

    return `${prefix}@scope (.${RENDER_SCOPE_CLASS}) {\n${scoped.join("\n")}\n}`;
}

/**
 * The CSS this module last wrote into a style element. Rewriting `textContent` is itself a
 * mutation, so without this the observer would see its own work and wrap the rules a second time.
 */
const scopedOutput = new WeakMap<HTMLStyleElement, string>();

function scopeStyleElements(styles: Iterable<HTMLStyleElement>) {
    for (const style of styles) {
        const css = style.textContent ?? "";
        if (scopedOutput.get(style) === css) {
            continue;
        }

        const scoped = scopeRenderNoteCss(css);
        scopedOutput.set(style, scoped);
        style.textContent = scoped;
    }
}

/** At-rules defining document-global named resources, or that are only valid at the top level. */
const HOISTED_AT_RULES = new Set([
    "charset", "import", "namespace",
    "font-face", "font-feature-values", "font-palette-values",
    "keyframes", "-webkit-keyframes", "-moz-keyframes",
    "property", "counter-style", "page"
]);

/** At-rules that wrap style rules, whose selectors still need rewriting. */
const GROUPING_AT_RULES = new Set([ "media", "supports", "container", "layer", "starting-style" ]);

/**
 * A leading run of `html` / `body` / `:root`, which addresses the document rather than the note.
 * Combinators are consumed with it, so `html > body .card` scopes down to `:scope .card`.
 */
const DOCUMENT_ROOT_PREFIX = /^\s*(?:html|body|:root)\b(?:\s*[>+~]?\s*(?:html|body|:root)\b)*/;

const COMMENT = /\/\*[\s\S]*?\*\//g;

interface CssNode {
    /** The at-rule name without its `@`, or undefined for a style rule. */
    atName?: string;
    /** Everything before the block: the selector, or the at-rule name and its condition. */
    prelude: string;
    /** The block contents, or undefined for a statement at-rule such as `@import …;`. */
    block?: string;
}

/**
 * Splits CSS into top-level nodes. Braces inside strings and comments are ignored, so a declaration
 * such as `content: "}"` does not end the rule early. Unbalanced input is consumed to the end
 * rather than rejected, which is how a browser recovers from it.
 */
function parseNodes(css: string): CssNode[] {
    const nodes: CssNode[] = [];
    let index = 0;
    let preludeStart = 0;

    while (index < css.length) {
        const char = css[index];

        if (char === "/" && css[index + 1] === "*") {
            index = skipComment(css, index);
        } else if (char === "\"" || char === "'") {
            index = skipString(css, index);
        } else if (char === ";") {
            addNode(nodes, css.slice(preludeStart, index));
            index++;
            preludeStart = index;
        } else if (char === "{") {
            const blockEnd = findBlockEnd(css, index);
            addNode(nodes, css.slice(preludeStart, index), css.slice(index + 1, blockEnd));
            index = blockEnd + 1;
            preludeStart = index;
        } else {
            index++;
        }
    }

    addNode(nodes, css.slice(preludeStart));
    return nodes;
}

function addNode(nodes: CssNode[], rawPrelude: string, block?: string) {
    // A comment ahead of the selector would otherwise hide the `body` that needs rewriting.
    const prelude = rawPrelude.replace(COMMENT, " ").trim();
    if (!prelude) {
        return;
    }

    const atName = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase();
    nodes.push({ atName, prelude, block });
}

function serialize(node: CssNode, rewrite: boolean): string {
    if (node.block === undefined) {
        return `${node.prelude};`;
    }

    if (node.atName) {
        // Grouping at-rules hold style rules of their own; anything else keeps its body verbatim.
        const body = rewrite && GROUPING_AT_RULES.has(node.atName)
            ? parseNodes(node.block).map((child) => serialize(child, true)).join("\n")
            : node.block;
        return `${node.prelude} {\n${body}\n}`;
    }

    const selector = rewrite ? rewriteSelector(node.prelude) : node.prelude;
    return `${selector} {${node.block}}`;
}

/** Rewrites document-root selectors to `:scope`, leaving every other selector untouched. */
function rewriteSelector(selector: string): string {
    return splitSelectorList(selector)
        .map((part) => part.replace(DOCUMENT_ROOT_PREFIX, ":scope"))
        .join(", ");
}

/** Splits a selector list on its top-level commas, ignoring those inside `:is(…)` or strings. */
function splitSelectorList(selector: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    let index = 0;

    while (index < selector.length) {
        const char = selector[index];

        if (char === "\"" || char === "'") {
            index = skipString(selector, index);
            continue;
        }

        if (char === "(" || char === "[") {
            depth++;
        } else if (char === ")" || char === "]") {
            depth--;
        } else if (char === "," && depth === 0) {
            parts.push(selector.slice(start, index).trim());
            start = index + 1;
        }

        index++;
    }

    parts.push(selector.slice(start).trim());
    return parts.filter((part) => part);
}

function findBlockEnd(css: string, openIndex: number): number {
    let depth = 0;
    let index = openIndex;

    while (index < css.length) {
        const char = css[index];

        if (char === "/" && css[index + 1] === "*") {
            index = skipComment(css, index);
            continue;
        }

        if (char === "\"" || char === "'") {
            index = skipString(css, index);
            continue;
        }

        if (char === "{") {
            depth++;
        } else if (char === "}") {
            depth--;
            if (depth === 0) {
                return index;
            }
        }

        index++;
    }

    return css.length;
}

function skipComment(css: string, index: number): number {
    const end = css.indexOf("*/", index + 2);
    return end === -1 ? css.length : end + 2;
}

function skipString(css: string, index: number): number {
    const quote = css[index];
    let cursor = index + 1;

    while (cursor < css.length) {
        if (css[cursor] === "\\") {
            cursor += 2;
            continue;
        }
        if (css[cursor] === quote) {
            return cursor + 1;
        }
        cursor++;
    }

    return css.length;
}
