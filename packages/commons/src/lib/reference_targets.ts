import type { BlockNode } from "./block_reference.js";
import type { ReferenceTarget } from "./server_api.js";

/** The attribute that marks a heading with its position in `MarkedHeadingsResponse`. */
export const HEADING_INDEX_ATTRIBUTE = "data-trilium-heading-index";

/** A heading that a request names: its title, and its position or its source line. */
export type HeadingRequest = { title: string }
    & ({ index: number; line?: undefined } | { line: number; index?: undefined });

/** A heading of a note that a link can point at. */
export interface HeadingTarget {
    /** Its plain text. */
    title: string;
    /** 1 for `<h1>`, up to 6 for `<h6>`. */
    level: number;
    /** The block id that a link to the heading uses, when the heading owns one. */
    id?: string;
}

/**
 * The targets of a note, as the text and Markdown providers list them: `headings` in document
 * order, then each of `anchorNames` once, sorted as `getAnchorNames()` sorts them in the editor.
 */
export function toReferenceTargets(
    headings: HeadingTarget[],
    anchorNames: Iterable<string>
): ReferenceTarget[] {
    const names = sortAnchorNames(anchorNames);
    return [
        ...headings.map(({ title, level, id }): ReferenceTarget => (id === undefined
            ? { kind: "heading", title, level }
            : { kind: "heading", title, level, params: { block: id } })),
        ...names.map((name): ReferenceTarget => (
            { kind: "anchor", title: name, params: { bookmark: name } }
        ))
    ];
}

/** Each of `anchorNames` once, sorted as `getAnchorNames()` sorts them in the text editor. */
export function sortAnchorNames(anchorNames: Iterable<string>) {
    return [ ...new Set(anchorNames) ].sort((a, b) => a.localeCompare(b));
}

/**
 * The heading that `request` names among `headings`: the one at `request.index` while its title is
 * `request.title`, else the only heading with that title.
 */
export function findRequestedHeading<T extends HeadingTarget>(
    headings: T[],
    { index, title }: { index: number; title: string }
): T | null {
    if (headings[index]?.title === title) {
        return headings[index];
    }
    const matches = headings.filter((heading) => heading.title === title);
    return matches.length === 1 ? matches[0] : null;
}

/**
 * The text of `heading` as `getHeadings()` reads it in the text editor: line breaks, images,
 * formulas and anchors read as a space, and white space is collapsed. A heading nested in it has
 * a text of its own, and comments are left out. The walk keeps its own stack: recursion overflows
 * the call stack on deeply nested content.
 */
export function getHeadingText(heading: BlockNode) {
    let text = "";
    const stack: BlockNode[] = [];
    pushChildren(stack, heading);
    for (let node = stack.pop(); node; node = stack.pop()) {
        if (!node.tagName) {
            text += node.nodeType === COMMENT_NODE ? "" : node.textContent as string;
            continue;
        }
        if (getHeadingLevel(node)) {
            continue;
        }
        const isFormula = /(?:^|\s)math-tex(?:\s|$)/.test(node.getAttribute?.("class") ?? "");
        if (isFormula || isAnchor(node) || SPACE_TAGS.has(node.tagName.toUpperCase())) {
            text += " ";
        }
        if (!isFormula) {
            pushChildren(stack, node);
        }
    }
    return text.replace(/\s+/g, " ").trim();
}

/** The level of `node`, 1 for `<h1>` up to 6 for `<h6>`, or 0 when it is not a heading. */
export function getHeadingLevel(node: BlockNode) {
    return Number(HEADING_TAG.exec(node.tagName ?? "")?.[1] ?? 0);
}

/** Whether `node` is an anchor: the text editor reads an `<a>` without `href` as a bookmark. */
export function isAnchor(node: BlockNode) {
    return node.tagName?.toUpperCase() === "A" && node.getAttribute?.("href") == null;
}

const HEADING_TAG = /^H([1-6])$/i;
/** The elements that `getHeadings()` in the text editor reads as a space. */
const SPACE_TAGS = new Set([ "BR", "IMG" ]);
const COMMENT_NODE = 8;

/** Pushes the children of `node` so that the first one is popped first. */
function pushChildren(stack: BlockNode[], node: BlockNode) {
    for (let index = node.childNodes.length - 1; index >= 0; index--) {
        stack.push(node.childNodes[index]);
    }
}
