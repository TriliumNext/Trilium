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

/**
 * Marks the elements that ranges are found in. The `::highlight()` rules apply only under it,
 * because a document-wide `::highlight()` rule crashes Chromium's renderer at some page zoom
 * levels (#12021).
 */
export const HIGHLIGHT_ROOT_ATTRIBUTE = "data-highlight-root";

export interface MatchOptions {
    /** Selectors of the elements under the root whose subtree is not searched. */
    exclude?: string[];
    /** The maximum number of matches to return. */
    limit?: number;
    /**
     * Searches the text nodes under the root as one text, so a match can cross inline formatting.
     * A {@link TEXT_BREAK_ELEMENTS} element or an excluded one separates words.
     */
    joinTextNodes?: boolean;
}

/** Elements that separate words when the text nodes under a root are joined. */
export const TEXT_BREAK_ELEMENTS = [
    "br", "hr", "p", "div", "section", "article", "aside", "header", "footer", "nav", "main",
    "blockquote", "pre", "figure", "figcaption", "details", "summary", "address",
    "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd",
    "table", "caption", "thead", "tbody", "tfoot", "tr", "td", "th"
];

/** Elements whose text is never displayed, so a match inside them is never returned. */
const ALWAYS_EXCLUDED = [ "script", "style", "title", "head", "html" ];

const TEXT_BREAKS = new Set(TEXT_BREAK_ELEMENTS);

/** The elements whose ranges a {@link WindowedHighlight} draws and removes together. */
const RANGE_BLOCKS = TEXT_BREAK_ELEMENTS
    .filter((name) => name !== "br" && name !== "hr")
    .join(",");

/**
 * The ranges of the matches of `regExp` in the text under `root`, in document order. A match
 * spans two text nodes only with `joinTextNodes`.
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

/**
 * The text that a search with `joinTextNodes` reads under `root`, for matching on what the search
 * paints. Gives the same text for an inert copy of the markup, such as a `<template>`'s content.
 */
export function getMatchText(root: Node, options: Pick<MatchOptions, "exclude"> = {}) {
    return joinTextNodes(root, getExcludedSelector(options)).text;
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
 * Draws ranges as part of the highlight `name` only while their block is within one view of the
 * visible part of its scroller. Chromium processes every range in `CSS.highlights` again in each
 * frame whose style changes, so thousands of drawn ranges slow down scrolling and animations.
 */
export class WindowedHighlight {

    /** The ranges of each block. */
    private readonly blocks = new Map<Element, Range[]>();
    private readonly drawn = new Set<Element>();
    private observer: IntersectionObserver | null = null;

    constructor(private readonly name: HighlightName, private readonly root: HTMLElement) {}

    /** Adds `ranges`, and draws at once those whose block is within the window. */
    add(ranges: Iterable<Range>) {
        const newBlocks: Element[] = [];
        for (const range of ranges) {
            const block = this.getBlock(range);
            const held = this.blocks.get(block);
            if (!held) {
                this.blocks.set(block, [ range ]);
                newBlocks.push(block);
            } else {
                held.push(range);
                if (this.drawn.has(block)) addHighlights(this.name, [ range ]);
            }
        }
        if (!newBlocks.length) return;

        const scroller = getScroller(this.root);
        const observer = this.getObserver(scroller);
        const area = getDrawnArea(scroller);
        for (const block of newBlocks) {
            const { top, bottom } = block.getBoundingClientRect();
            if (!observer || (bottom >= area.top && top <= area.bottom)) {
                this.draw(block);
            }
            observer?.observe(block);
        }
    }

    /** Removes every range. */
    clear() {
        this.observer?.disconnect();
        this.observer = null;
        for (const block of this.drawn) {
            removeHighlights(this.name, this.blocks.get(block) ?? []);
        }
        this.drawn.clear();
        this.blocks.clear();
    }

    /** The observer of the blocks, or `null` where the browser has none and every block draws. */
    private getObserver(scroller: Element | null) {
        if (typeof IntersectionObserver === "undefined") return null;

        this.observer ??= new IntersectionObserver((entries, observer) => {
            if (observer !== this.observer) return;
            for (const { target, isIntersecting, boundingClientRect } of entries) {
                if (isIntersecting) {
                    this.draw(target);
                } else if (boundingClientRect.width || boundingClientRect.height) {
                    // A block with no box is hidden, as in a hidden split. It stays drawn.
                    this.undraw(target);
                }
            }
        }, { root: scroller, rootMargin: "100% 0px" });
        return this.observer;
    }

    /** The block under `root` that holds the start of `range`, else the element of its start. */
    private getBlock(range: Range) {
        const { startContainer } = range;
        const start = startContainer instanceof Element
            ? startContainer
            : startContainer.parentElement;
        const block = start?.closest(RANGE_BLOCKS);
        return block && this.root.contains(block) ? block : start ?? this.root;
    }

    private draw(block: Element) {
        const ranges = this.blocks.get(block);
        if (!ranges || this.drawn.has(block)) return;
        this.drawn.add(block);
        addHighlights(this.name, ranges);
    }

    private undraw(block: Element) {
        if (!this.drawn.delete(block)) return;
        removeHighlights(this.name, this.blocks.get(block) ?? []);
    }

}

/**
 * Scrolls each scrolling ancestor of `range`, innermost first, so that the range sits in its
 * middle. `Element.scrollIntoView()` would center the whole parent element instead, which can be
 * a code block taller than the view.
 */
export function scrollRangeIntoView(range: Range, behavior?: ScrollBehavior) {
    scrollRectIntoView(
        range.startContainer.parentElement,
        () => range.getBoundingClientRect(),
        behavior
    );
}

/**
 * Scrolls `element` and its ancestors that scroll, innermost first, so that the rectangle that
 * `getRect()` returns in client coordinates sits in the middle of each. Without `behavior`, each
 * scroll follows the `scroll-behavior` of its box.
 */
export function scrollRectIntoView(
    element: Element | null,
    getRect: () => Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">,
    behavior?: ScrollBehavior
) {
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        if (!isScrollable(ancestor)) continue;

        const target = getRect();
        const box = ancestor.getBoundingClientRect();
        ancestor.scrollBy({
            left: target.left + target.width / 2 - (box.left + box.width / 2),
            top: target.top + target.height / 2 - (box.top + box.height / 2),
            ...behavior && { behavior }
        });
    }
}

type Offsets = [ start: number, end: number ];

/** A text node of a joined text, with the offset of its first character in that text. */
interface TextSegment {
    node: Text;
    start: number;
}

function getRegistry() {
    return typeof Highlight === "undefined" ? undefined : globalThis.CSS?.highlights;
}

/** The nearest element from `element` up that scrolls vertically, or `null` for the viewport. */
function getScroller(element: Element) {
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        if (/auto|scroll|overlay/.test(getComputedStyle(ancestor).overflowY)) return ancestor;
    }
    return null;
}

/** The client Y span that a {@link WindowedHighlight} draws: the view and one view on each side. */
function getDrawnArea(scroller: Element | null) {
    const { top, bottom } = scroller?.getBoundingClientRect()
        ?? { top: 0, bottom: window.innerHeight };
    const height = bottom - top;
    return { top: top - height, bottom: bottom + height };
}

function isScrollable(element: Element) {
    const { overflowX, overflowY } = getComputedStyle(element);
    const scrolls = (overflow: string) => /auto|scroll|overlay/.test(overflow);
    return (element.scrollHeight > element.clientHeight && scrolls(overflowY))
        || (element.scrollWidth > element.clientWidth && scrolls(overflowX));
}

function findRanges(root: HTMLElement, options: MatchOptions, getOffsets: (text: string) => Offsets[]) {
    const excluded = getExcludedSelector(options);
    const limit = options.limit ?? Infinity;
    const ranges: Range[] = [];
    root.setAttribute(HIGHLIGHT_ROOT_ATTRIBUTE, "");

    if (options.joinTextNodes) {
        const { text, segments } = joinTextNodes(root, excluded);
        for (const offsets of getOffsets(text)) {
            if (ranges.length >= limit) break;
            const range = createJoinedRange(segments, offsets);
            if (range) ranges.push(range);
        }
        return ranges;
    }

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
    // A rejected element skips its subtree. The walker never visits `root` or its ancestors.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            if (!(node instanceof Element)) {
                return NodeFilter.FILTER_ACCEPT;
            }
            return node.matches(excluded) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        }
    });

    const nodes: Text[] = [];
    while (walker.nextNode()) {
        nodes.push(walker.currentNode as Text);
    }
    return nodes;
}

function getExcludedSelector(options: Pick<MatchOptions, "exclude">) {
    return [ ...ALWAYS_EXCLUDED, ...options.exclude ?? [] ].join(",");
}

/**
 * The text nodes under `root` joined into one text, outside the `excluded` elements. A break
 * element or an excluded one adds a space, unless whitespace already separates the text there.
 */
function joinTextNodes(root: Node, excluded: string) {
    let text = "";
    const segments: TextSegment[] = [];
    let isBreakPending = false;

    const visit = (parent: Node) => {
        for (const child of parent.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                const { data } = child as Text;
                if (data.length === 0) continue;
                if (isBreakPending && /\S$/.test(text) && /^\S/.test(data)) {
                    text += " ";
                }
                isBreakPending = false;
                segments.push({ node: child as Text, start: text.length });
                text += data;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const element = child as Element;
                if (element.matches(excluded)) {
                    isBreakPending = true;
                    continue;
                }
                const isBreak = TEXT_BREAKS.has(element.localName);
                isBreakPending ||= isBreak;
                visit(element);
                isBreakPending ||= isBreak;
            }
        }
    };
    visit(root);

    return { text, segments };
}

/**
 * The range of the joined text `offsets` over its text nodes, or `null` when it covers only the
 * space added by a break.
 */
function createJoinedRange(segments: TextSegment[], [ start, end ]: Offsets) {
    let first = findSegment(segments, start);
    let startOffset = start - segments[first].start;
    // A match that starts on an added space starts at the next text node.
    if (startOffset >= segments[first].node.length) {
        first++;
        startOffset = 0;
    }
    const last = findSegment(segments, end - 1);
    if (first >= segments.length || first > last) return null;

    // A match that ends on an added space ends with the text node before it.
    const { node: endNode, start: endNodeStart } = segments[last];
    const range = document.createRange();
    range.setStart(segments[first].node, startOffset);
    range.setEnd(endNode, Math.min(end - endNodeStart, endNode.length));
    return range;
}

/** The index of the last segment that starts at or before `offset`. */
function findSegment(segments: TextSegment[], offset: number) {
    let low = 0;
    let high = segments.length - 1;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (segments[middle].start <= offset) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    return low;
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
 * Strips the diacritics of `text` and lowercases it, one code point at a time, with the final
 * sigma ς as σ. `starts[i]` and `ends[i]` are the bounds in `text` of the code point that produced
 * `text[i]` of the result; a combining mark that folds away joins the code point before it.
 */
function fold(text: string) {
    let folded = "";
    const starts: number[] = [];
    const ends: number[] = [];
    let index = 0;

    for (const char of text) {
        const end = index + char.length;
        const replacement = char.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
            .replace("ς", "σ");
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
