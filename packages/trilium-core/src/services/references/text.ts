import {
    BLOCK_ID_ATTRIBUTE, drawBlockId, generateBlockId, isValidBlockId, type MarkedHeadingsResponse,
    type ReferenceTarget
} from "@triliumnext/commons";
import {
    findRequestedHeading, getHeadingLevel, getHeadingText, HEADING_INDEX_ATTRIBUTE,
    type HeadingTarget, isAnchor, toReferenceTargets
} from "@triliumnext/commons/src/lib/reference_targets.js";
import { HTMLElement, type Node, parse } from "node-html-parser";

import { type ReferenceProvider, readContent } from "./index.js";

/**
 * The headings and anchors of text notes. A heading links through `?block=` once it has a block
 * id, which `createReference()` writes into its opening tag. An anchor links through `?bookmark=`.
 */
const textReferences: ReferenceProvider = {
    isFor: (type) => type === "text",
    findTargets(source) {
        const content = readContent(source);
        return typeof content === "string" ? findTextTargets(content) : [];
    },
    createReference(content, request) {
        if (typeof content !== "string" || request.kind !== "heading"
            || request.index === undefined) {
            return null;
        }
        return addHeadingReference(content, request, generateBlockId);
    },
    markHeadings(content) {
        return typeof content === "string" ? markTextHeadings(content, generateBlockId) : null;
    }
};

export default textReferences;

/** The headings that have text, in document order, then the anchors, by name. */
export function findTextTargets(content: string): ReferenceTarget[] {
    const { headings, anchors } = collectReferences(content);
    return toReferenceTargets(headings, anchors);
}

/**
 * The heading targets of `content`, and `content` with `HEADING_INDEX_ATTRIBUTE` as the first
 * attribute of each of them, valued `<token>.<position>`. The token comes from `createToken` and
 * occurs nowhere in `content`. `null` when no draw gives such a token.
 */
export function markTextHeadings(
    content: string, createToken: () => string
): Omit<MarkedHeadingsResponse, "blobId"> | null {
    const markToken = drawBlockId(content, createToken);
    if (!markToken) {
        return null;
    }

    // One pass and one join: splicing each mark into the whole content is quadratic.
    const { headings } = collectReferences(content);
    const parts: string[] = [];
    let offset = 0;
    for (const [ position, { element } ] of headings.entries()) {
        const tagNameEnd = getTagNameEnd(content, element);
        /* v8 ignore next 3 -- node-html-parser lists elements in source order */
        if (tagNameEnd < offset) {
            throw new Error(`The heading at offset ${tagNameEnd} is out of document order.`);
        }
        parts.push(content.slice(offset, tagNameEnd),
            ` ${HEADING_INDEX_ATTRIBUTE}="${markToken}.${position}"`);
        offset = tagNameEnd;
    }
    parts.push(content.slice(offset));
    return { headings: toReferenceTargets(headings, []), markedContent: parts.join(""), markToken };
}

/**
 * `content` with a block id on the heading that `request` names, and the link parameters of the
 * heading. That heading is the one at `request.index` while its text is `request.title`, else the
 * only heading with that text. The content comes back unchanged when the heading has an id
 * already, and `null` when no heading matches or `createId` draws no free id.
 */
export function addHeadingReference(
    content: string, request: { index: number; title: string },
    createId: () => string
) {
    const heading = findRequestedHeading(collectReferences(content).headings, request);
    if (!heading) {
        return null;
    }
    if (heading.id) {
        return { content, params: { block: heading.id } };
    }

    const blockId = drawBlockId(content, createId);
    return blockId
        ? { content: insertBlockId(content, heading.element, blockId), params: { block: blockId } }
        : null;
}

/**
 * `content` with `blockId` as the first attribute of `element`, which `content` was parsed into.
 * The rest of `content` keeps its bytes: `setAttribute()` would serialize the other attributes
 * again, and alter the backslashes in them.
 *
 * Exported for testing.
 */
export function insertBlockId(content: string, element: HTMLElement, blockId: string) {
    const position = getTagNameEnd(content, element);
    const attribute = ` ${BLOCK_ID_ATTRIBUTE}="${blockId}"`;
    return `${content.slice(0, position)}${attribute}${content.slice(position)}`;
}

/** The offset right after the tag name of `element`, which `content` was parsed into. */
function getTagNameEnd(content: string, element: HTMLElement) {
    const openingTag = `<${element.rawTagName}`;
    const start = element.range[0];
    if (!content.startsWith(openingTag, start)) {
        throw new Error(`Expected the opening tag of a heading at offset ${start}.`);
    }
    return start + openingTag.length;
}

/** An opening tag of a heading or of a link. Content without one holds no references. */
const MAY_HOLD_REFERENCES = /<(?:h[1-6]|a)[\s/>]/i;
/** `getAttribute()` parses every attribute of an element, so it runs only when this matches. */
const MAY_HOLD_BLOCK_ID = new RegExp(BLOCK_ID_ATTRIBUTE, "i");

interface FoundHeading extends HeadingTarget {
    element: HTMLElement;
}

function collectReferences(content: string) {
    const headings: FoundHeading[] = [];
    const anchors = new Set<string>();
    if (!MAY_HOLD_REFERENCES.test(content)) {
        return { headings, anchors };
    }

    // A link reaches the first element with a block id, so a later one with that id has none.
    const takenIds = new Set<string>();
    for (const element of getElements(parse(content))) {
        const id = MAY_HOLD_BLOCK_ID.test(element.rawAttrs)
            ? element.getAttribute(BLOCK_ID_ATTRIBUTE)
            : undefined;
        const blockId = isValidBlockId(id) && !takenIds.has(id) ? id : undefined;
        if (blockId) {
            takenIds.add(blockId);
        }

        const level = getHeadingLevel(element);
        if (level) {
            const title = getHeadingText(element);
            if (title) {
                headings.push({ element, level, title, id: blockId });
            }
        } else if (isAnchor(element)) {
            const anchorId = element.getAttribute("id");
            if (anchorId) {
                anchors.add(anchorId);
            }
        }
    }
    return { headings, anchors };
}

/**
 * The elements under `root` in document order. The walk keeps its own stack: recursion overflows
 * the call stack on deeply nested content.
 */
function* getElements(root: HTMLElement) {
    const stack: Node[] = [];
    pushChildren(stack, root);
    for (let node = stack.pop(); node; node = stack.pop()) {
        if (node instanceof HTMLElement) {
            yield node;
            pushChildren(stack, node);
        }
    }
}

/** Pushes the children of `node` so that the first one is popped first. */
function pushChildren(stack: Node[], node: Node) {
    for (let index = node.childNodes.length - 1; index >= 0; index--) {
        stack.push(node.childNodes[index]);
    }
}
