import { escapeRegExp } from "./utils.js";

/**
 * The highlights of `CSS.highlights` that the client draws, which `::highlight(name)` styles, and
 * their priorities: a range in two highlights draws the one with the higher priority on top.
 */
const PRIORITIES = {
    "search-match": 0,
    "find-result-secondary": 0,
    "find-result": 1,
    "find-result-selected": 2
};

export type HighlightName = keyof typeof PRIORITIES;

export interface MatchOptions {
    /** Selectors of the elements whose own text is not searched. */
    exclude?: string[];
    /** The maximum number of matches to return. */
    limit?: number;
}

/** Elements whose text is never displayed, so a match inside them is never returned. */
const ALWAYS_EXCLUDED = [ "script", "style", "title", "head", "html" ];

/**
 * The ranges of the matches of `regExp` in the text under `root`, in document order. A match
 * cannot span two text nodes.
 */
export function findRegExpRanges(root: HTMLElement, regExp: RegExp, options: MatchOptions = {}) {
    const global = regExp.global ? regExp : new RegExp(regExp.source, `${regExp.flags}g`);
    return findRanges(root, options, (text) => findOffsets(global, text));
}

/**
 * The ranges of the occurrences of the literal `terms` in the text under `root`, ignoring case and
 * diacritics the way the server's `normalize()` does, so the unaccented token "ktory" still
 * matches "ktorý". Whitespace in a term matches any run of whitespace.
 */
export function findTermRanges(root: HTMLElement, terms: string[], options: MatchOptions = {}) {
    const patterns = terms
        .map((term) => fold(term).text.trim())
        .filter((term) => term.length > 0)
        .sort((a, b) => b.length - a.length)
        .map((term) => term.split(/\s+/).map(escapeRegExp).join("\\s+"));
    if (patterns.length === 0) {
        return [];
    }

    const regExp = new RegExp(patterns.join("|"), "g");
    return findRanges(root, options, (text) => {
        const folded = fold(text);
        return findOffsets(regExp, folded.text)
            .map(([ start, end ]): Offsets => [ folded.starts[start], folded.ends[end - 1] ]);
    });
}

/** Draws `ranges` as part of the highlight `name`. Browsers without `CSS.highlights` draw nothing. */
export function addHighlights(name: HighlightName, ranges: Iterable<Range>) {
    const registry = getRegistry();
    if (!registry) return;

    let highlight = registry.get(name);
    if (!highlight) {
        highlight = new Highlight();
        highlight.priority = PRIORITIES[name];
        registry.set(name, highlight);
    }
    for (const range of ranges) {
        highlight.add(range);
    }
}

/** Stops drawing `ranges` as part of the highlight `name`, leaving its other ranges drawn. */
export function removeHighlights(name: HighlightName, ranges: Iterable<Range>) {
    const highlight = getRegistry()?.get(name);
    if (!highlight) return;

    for (const range of ranges) {
        highlight.delete(range);
    }
}

/**
 * Scrolls each scrolling ancestor of `range`, innermost first, so that the range sits in its
 * middle. `Element.scrollIntoView()` would center the whole parent element instead, which can be
 * a code block taller than the view.
 */
export function scrollRangeIntoView(range: Range) {
    for (let element = range.startContainer.parentElement; element; element = element.parentElement) {
        if (!isScrollable(element)) continue;

        const target = range.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        element.scrollBy({
            left: target.left + target.width / 2 - (box.left + box.width / 2),
            top: target.top + target.height / 2 - (box.top + box.height / 2)
        });
    }
}

type Offsets = [ start: number, end: number ];

function getRegistry() {
    return typeof Highlight === "undefined" ? undefined : globalThis.CSS?.highlights;
}

function isScrollable(element: Element) {
    const { overflowX, overflowY } = getComputedStyle(element);
    const scrolls = (overflow: string) => /auto|scroll|overlay/.test(overflow);
    return (element.scrollHeight > element.clientHeight && scrolls(overflowY))
        || (element.scrollWidth > element.clientWidth && scrolls(overflowX));
}

function findRanges(root: HTMLElement, options: MatchOptions, getOffsets: (text: string) => Offsets[]) {
    const excluded = [ ...ALWAYS_EXCLUDED, ...options.exclude ?? [] ].join(",");
    const limit = options.limit ?? Infinity;
    const ranges: Range[] = [];

    for (const node of getTextNodes(root, excluded)) {
        for (const [ start, end ] of getOffsets(node.data).slice(0, limit - ranges.length)) {
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, end);
            ranges.push(range);
        }
        if (ranges.length >= limit) break;
    }

    return ranges;
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

/** The offsets of the non-empty matches of the global `regExp` in `text`. */
function findOffsets(regExp: RegExp, text: string) {
    const offsets: Offsets[] = [];
    for (const match of text.matchAll(regExp)) {
        if (match[0].length > 0) {
            offsets.push([ match.index, match.index + match[0].length ]);
        }
    }
    return offsets;
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
