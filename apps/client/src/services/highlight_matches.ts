import { escapeRegExp } from "./utils.js";

export interface HighlightOptions {
    /** The class of the `<span>` that wraps each match. */
    className: string;
    /** Selectors of the elements whose own text is not searched. */
    exclude?: string[];
    /** The maximum number of matches to wrap. */
    limit?: number;
}

/** Elements whose text is never displayed, so a match inside them is never wrapped. */
const ALWAYS_EXCLUDED = [ "script", "style", "title", "head", "html" ];

/**
 * Wraps each match of `regExp` in the text under `root`, and returns the wrappers in document
 * order. A match cannot span two text nodes. {@link removeHighlights} unwraps them again.
 */
export function highlightRegExp(root: HTMLElement, regExp: RegExp, options: HighlightOptions) {
    const global = regExp.global ? regExp : new RegExp(regExp.source, `${regExp.flags}g`);
    return highlightRanges(root, options, (text) => findRanges(global, text));
}

/**
 * Wraps each occurrence of the literal `terms` in the text under `root`, ignoring case and
 * diacritics the way the server's `normalize()` does, so the unaccented token "ktory" still
 * matches "ktorý". Whitespace in a term matches any run of whitespace.
 */
export function highlightTerms(root: HTMLElement, terms: string[], options: HighlightOptions) {
    const patterns = terms
        .map((term) => fold(term).text.trim())
        .filter((term) => term.length > 0)
        .sort((a, b) => b.length - a.length)
        .map((term) => term.split(/\s+/).map(escapeRegExp).join("\\s+"));
    if (patterns.length === 0) {
        return [];
    }

    const regExp = new RegExp(patterns.join("|"), "g");
    return highlightRanges(root, options, (text) => {
        const folded = fold(text);
        return findRanges(regExp, folded.text)
            .map(([ start, end ]): Range => [ folded.starts[start], folded.ends[end - 1] ]);
    });
}

/** Unwraps the elements that {@link highlightRegExp} and {@link highlightTerms} returned. */
export function removeHighlights(elements: Iterable<HTMLElement>) {
    for (const element of elements) {
        const parent = element.parentNode;
        if (!parent) continue;

        element.replaceWith(...element.childNodes);
        parent.normalize();
    }
}

type Range = [ start: number, end: number ];

function highlightRanges(root: HTMLElement, options: HighlightOptions, getRanges: (text: string) => Range[]) {
    const excluded = [ ...ALWAYS_EXCLUDED, ...options.exclude ?? [] ].join(",");
    const limit = options.limit ?? Infinity;
    const wrappers: HTMLElement[] = [];

    for (const node of getTextNodes(root, excluded)) {
        const ranges = getRanges(node.data).slice(0, limit - wrappers.length);
        wrappers.push(...wrapRanges(node, ranges, options.className));
        if (wrappers.length >= limit) break;
    }

    return wrappers;
}

function getTextNodes(root: HTMLElement, excluded: string) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => node.parentElement?.matches(excluded)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT
    });

    const nodes: Text[] = [];
    while (walker.nextNode()) {
        nodes.push(walker.currentNode as Text);
    }
    return nodes;
}

/** The non-empty matches of the global `regExp` in `text`. */
function findRanges(regExp: RegExp, text: string) {
    const ranges: Range[] = [];
    for (const match of text.matchAll(regExp)) {
        if (match[0].length > 0) {
            ranges.push([ match.index, match.index + match[0].length ]);
        }
    }
    return ranges;
}

function wrapRanges(node: Text, ranges: Range[], className: string) {
    const wrappers: HTMLElement[] = [];
    let rest = node;
    let offset = 0;

    for (const [ start, end ] of ranges) {
        const matched = rest.splitText(start - offset);
        rest = matched.splitText(end - start);
        offset = end;

        const wrapper = document.createElement("span");
        wrapper.className = className;
        matched.replaceWith(wrapper);
        wrapper.append(matched);
        wrappers.push(wrapper);
    }

    return wrappers;
}

/**
 * Strips the diacritics of `text` and lowercases it, one code point at a time. `starts[i]` and
 * `ends[i]` are the bounds in `text` of the code point that produced `text[i]` of the result; a
 * combining mark that folds away joins the code point before it.
 */
function fold(text: string) {
    let folded = "";
    const starts: number[] = [];
    const ends: number[] = [];
    let index = 0;

    for (const char of text) {
        const end = index + char.length;
        const replacement = char.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
        if (replacement.length === 0 && ends.length > 0) {
            ends[ends.length - 1] = end;
        }
        for (let i = 0; i < replacement.length; i++) {
            starts.push(index);
            ends.push(end);
        }
        folded += replacement;
        index = end;
    }

    return { text: folded, starts, ends };
}
