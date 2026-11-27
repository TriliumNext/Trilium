import type { ModelElement, ModelNode } from "ckeditor5";

import { ELEMENTS as FOOTNOTE_ELEMENTS } from "../footnotes/constants.js";
import type { CollapsedSection } from "../hidden_blocks.js";
import { HEADING_COLLAPSED } from "./constants.js";

/** The level of each heading element, by name. */
const HEADING_LEVELS = new Map([ 1, 2, 3, 4, 5, 6 ].map((level) => [ `heading${level}`, level ]));

/** Whether elements named `name` are headings. */
export function isHeadingName(name: string) {
    return HEADING_LEVELS.has(name);
}

/**
 * The level of `node` when it is a heading that owns a section, else `null`. A heading in a list
 * item belongs to the list.
 */
export function getSectionLevel(node: ModelNode): number | null {
    if (!node.is("element") || node.hasAttribute("listItemId")) {
        return null;
    }
    return HEADING_LEVELS.get(node.name) ?? null;
}

/**
 * The blocks of the section of `heading`: the siblings after it up to the next heading of the same
 * or a higher level, or up to the footnotes.
 */
export function getSection(heading: ModelElement): ModelElement[] {
    const level = getSectionLevel(heading);
    const blocks: ModelElement[] = [];
    for (let node = heading.nextSibling; node && level !== null && !endsSection(node, level);
        node = node.nextSibling) {
        blocks.push(node as ModelElement);
    }
    return blocks;
}

/** Whether `heading` has blocks under it. */
export function hasSection(heading: ModelElement) {
    const level = getSectionLevel(heading);
    const next = heading.nextSibling;
    return level !== null && !!next && !endsSection(next, level);
}

/** The sections of the collapsed headings among the children of `parent`, in document order. */
export function getCollapsedSections(parent: ModelElement): CollapsedSection[] {
    const sections: CollapsedSection[] = [];
    for (const child of parent.getChildren()) {
        const heading = child as ModelElement;
        if (heading.hasAttribute(HEADING_COLLAPSED)) {
            sections.push({ owner: heading, blocks: getSection(heading) });
        }
    }
    return sections;
}

function endsSection(node: ModelNode, level: number) {
    const nodeLevel = getSectionLevel(node);
    return (nodeLevel !== null && nodeLevel <= level)
        || node.is("element", FOOTNOTE_ELEMENTS.footnoteSection);
}
