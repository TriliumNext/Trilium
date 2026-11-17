import {
    BLOCK_ID_ATTRIBUTE, type CreateReferenceRequest, generateBlockId, isValidBlockId,
    type ReferenceTarget
} from "@triliumnext/commons";
import { HTMLElement, type Node, parse, TextNode } from "node-html-parser";

import type { ReferenceProvider } from "./index.js";

/**
 * The headings and anchors of text notes. A heading links through `?block=` once it has a block
 * id, which `createReference()` writes into its opening tag. An anchor links through `?bookmark=`.
 */
const textReferences: ReferenceProvider = {
    isFor: (type) => type === "text",
    findTargets: (content) => typeof content === "string" ? findTextTargets(content) : [],
    createReference(content, request) {
        if (typeof content !== "string" || request.kind !== "heading") {
            return null;
        }
        return addHeadingReference(content, request, generateBlockId);
    }
};

export default textReferences;

/** The headings that have text, in document order, then the anchors, by name. */
export function findTextTargets(content: string): ReferenceTarget[] {
    const { headings, anchors } = collectReferences(content);
    return [
        ...headings.map(({ level, title, blockId }): ReferenceTarget => (blockId
            ? { kind: "heading", title, level, params: { block: blockId } }
            : { kind: "heading", title, level })),
        // Sorted as `getAnchorNames()` sorts them in the editor.
        ...[ ...anchors ].sort((a, b) => a.localeCompare(b)).map((name): ReferenceTarget => (
            { kind: "anchor", title: name, params: { bookmark: name } }
        ))
    ];
}

/**
 * `content` with a block id on the heading that `request` names, and the link parameters of the
 * heading. That heading is the one at `request.index` while its text is `request.title`, else the
 * only heading with that text. The content comes back unchanged when the heading has an id
 * already, and `null` when no heading matches.
 */
export function addHeadingReference(
    content: string, request: Pick<CreateReferenceRequest, "index" | "title">,
    createId: () => string
) {
    const heading = findHeading(collectReferences(content).headings, request);
    if (!heading) {
        return null;
    }
    if (heading.blockId) {
        return { content, params: { block: heading.blockId } };
    }

    // An id found nowhere in the content is not the id of another block either.
    let blockId = createId();
    while (content.includes(blockId)) {
        blockId = createId();
    }
    return {
        content: insertBlockId(content, heading.element, blockId),
        params: { block: blockId }
    };
}

/**
 * `content` with `blockId` as the first attribute of `element`, which `content` was parsed into.
 * The rest of `content` keeps its bytes: `setAttribute()` would serialize the other attributes
 * again, and alter the backslashes in them.
 *
 * Exported for testing.
 */
export function insertBlockId(content: string, element: HTMLElement, blockId: string) {
    const openingTag = `<${element.rawTagName}`;
    const start = element.range[0];
    if (!content.startsWith(openingTag, start)) {
        throw new Error(`Expected the opening tag of a heading at offset ${start}.`);
    }

    const position = start + openingTag.length;
    const attribute = ` ${BLOCK_ID_ATTRIBUTE}="${blockId}"`;
    return `${content.slice(0, position)}${attribute}${content.slice(position)}`;
}

/** An opening tag of a heading or of a link. Content without one holds no references. */
const MAY_HOLD_REFERENCES = /<(?:h[1-6]|a)[\s/>]/i;
/** `getAttribute()` parses every attribute of an element, so it runs only when this matches. */
const MAY_HOLD_BLOCK_ID = new RegExp(BLOCK_ID_ATTRIBUTE, "i");
const HEADING_TAG = /^H([1-6])$/;
/** The elements that `getHeadings()` in the editor reads as a space. */
const SPACE_TAGS = new Set([ "BR", "IMG" ]);

interface FoundHeading {
    element: HTMLElement;
    /** 1 for `<h1>`, up to 6 for `<h6>`. */
    level: number;
    /** The plain text of the heading. */
    title: string;
    blockId?: string;
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
                headings.push({ element, level, title, blockId });
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
 * The text of `heading` as `getHeadings()` reads it in the editor: line breaks, images, formulas
 * and anchors read as a space. A heading inside it has an entry of its own.
 */
function getHeadingText(heading: HTMLElement) {
    let text = "";
    const stack: Node[] = [];
    pushChildren(stack, heading);
    for (let node = stack.pop(); node; node = stack.pop()) {
        if (node instanceof TextNode) {
            text += node.text;
        } else if (node instanceof HTMLElement && !getHeadingLevel(node)) {
            const isFormula = node.classList.contains("math-tex");
            if (isFormula || isAnchor(node) || SPACE_TAGS.has(node.tagName)) {
                text += " ";
            }
            if (!isFormula) {
                pushChildren(stack, node);
            }
        }
    }
    return text.replace(/\s+/g, " ").trim();
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

function getHeadingLevel(element: HTMLElement) {
    return Number(HEADING_TAG.exec(element.tagName)?.[1] ?? 0);
}

/** Whether `element` is an anchor: CKEditor reads an `<a>` without `href` as a bookmark. */
function isAnchor(element: HTMLElement) {
    return element.tagName === "A" && !element.hasAttribute("href");
}

/** The heading at `index` while its text is `title`, else the only heading with that text. */
function findHeading(
    headings: FoundHeading[], { index, title }: Pick<CreateReferenceRequest, "index" | "title">
) {
    if (headings[index]?.title === title) {
        return headings[index];
    }

    const matches = headings.filter((heading) => heading.title === title);
    return matches.length === 1 ? matches[0] : null;
}
