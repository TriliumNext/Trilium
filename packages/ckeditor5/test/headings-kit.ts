import {
    BlockQuote, type ClassicEditor, Essentials, Heading, type HeadingOption, HorizontalLine,
    List, type ModelElement, type ModelNode, Paragraph, Table
} from "ckeditor5";

import CollapsibleHeadings from "../src/plugins/collapsible_headings/collapsible_headings.js";
import { HEADING_COLLAPSED } from "../src/plugins/collapsible_headings/constants.js";
import { HIDDEN_BLOCK_CLASS } from "../src/plugins/hidden_blocks.js";
import { createTestEditor } from "./editor-kit.js";

/**
 * Collapsible heading fixtures for the spec suite: an editor with the heading levels of Trilium's
 * text notes, and an outline of the root that shows which headings are collapsed and which blocks
 * the editing view hides.
 */

/** The heading options of Trilium's text notes. */
export const HEADING_OPTIONS: HeadingOption[] = [
    { model: "paragraph", title: "Paragraph", class: "ck-heading_paragraph" },
    { model: "heading2", view: "h2", title: "Heading 2", class: "ck-heading_heading2" },
    { model: "heading3", view: "h3", title: "Heading 3", class: "ck-heading_heading3" },
    { model: "heading4", view: "h4", title: "Heading 4", class: "ck-heading_heading4" },
    { model: "heading5", view: "h5", title: "Heading 5", class: "ck-heading_heading5" },
    { model: "heading6", view: "h6", title: "Heading 6", class: "ck-heading_heading6" }
];

type Plugins = NonNullable<Parameters<typeof createTestEditor>[0]>;
type Config = Parameters<typeof createTestEditor>[1];

/** An editor with collapsible headings and the blocks the specs hide. */
export function createHeadingsEditor(extraPlugins: Plugins = [], extraConfig: Config = {}) {
    return createTestEditor([
        Essentials, Paragraph, Heading, List, BlockQuote, Table, HorizontalLine,
        CollapsibleHeadings, ...extraPlugins
    ], { heading: { options: HEADING_OPTIONS }, ...extraConfig });
}

/**
 * The children of `parent`, the root by default, as the specs read them: `▸` before a collapsed
 * heading, and a block hidden in the editing view in parentheses, as `intro, ▸Alpha, (a1), Beta`.
 */
export function outline(editor: ClassicEditor, parent: ModelElement = getRoot(editor)): string {
    const mapper = editor.editing.mapper;
    return [ ...parent.getChildren() ].map((child) => {
        const label = (child.hasAttribute(HEADING_COLLAPSED) ? "▸" : "") + getLabel(child);
        const viewElement = mapper.toViewElement(child as ModelElement);
        return viewElement?.hasClass(HIDDEN_BLOCK_CLASS) ? `(${label})` : label;
    }).join(", ");
}

export function getRoot(editor: ClassicEditor) {
    return editor.model.document.getRoot() as ModelElement;
}

/** The child of the root whose text is `text`. */
export function findBlock(editor: ClassicEditor, text: string): ModelElement {
    const block = [ ...getRoot(editor).getChildren() ].find((child) => getLabel(child) === text);
    if (!block) {
        throw new Error(`No block with the text "${text}".`);
    }
    return block as ModelElement;
}

/** The rendered element of `block`. */
export function getDomBlock(editor: ClassicEditor, block: ModelElement): HTMLElement {
    const viewElement = editor.editing.mapper.toViewElement(block);
    const domElement = viewElement && editor.editing.view.domConverter.mapViewToDom(viewElement);
    if (!(domElement instanceof HTMLElement)) {
        throw new Error("The block is not rendered.");
    }
    return domElement;
}

/** The text of `node`, or the name of an element without text. */
function getLabel(node: ModelNode) {
    if (!node.is("element")) {
        return "";
    }
    let text = "";
    for (const child of node.getChildren()) {
        text += child.is("$text") ? child.data : "";
    }
    return text || node.name;
}
