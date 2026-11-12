import {
    type Editor, type ModelDocumentFragment, type ModelElement, type ModelNode, type ModelPosition,
    type ModelWriter, uid
} from "ckeditor5";

import { isTitle } from "./vim_editing.js";
import { type LineIndex, type LinePosition, OBJECT_CHARACTER, type TextLine } from "./vim_lines.js";

/** The containers whose blocks are paragraphs, whatever is put in them. */
const PARAGRAPH_CONTAINERS = new Set([ "blockQuote", "aside", "tableCell" ]);

/** The model content that the text of a register was read from. */
export interface RichContent {
    fragment: ModelDocumentFragment;
    /** Whether `fragment` holds whole blocks, as a linewise command reads them. */
    isBlocks: boolean;
}

/**
 * A register of the engine. The engine gives it a new `keyBuffer` whenever it sets its text, and
 * adds to the buffer it has when it appends text.
 */
export interface VimRegister {
    keyBuffer: string[];
    toString(): string;
}

/**
 * The rich content of the registers, by the text buffer of the register that holds it, with the
 * text of the register then. The registers keep text only, so a register puts the content instead
 * while it holds that text in that buffer. Shared by every text editor, as the registers are.
 */
let remembered = new WeakMap<string[], { text: string; content: RichContent }>();

/** Remembers `content` as what `register` puts while it holds its text. */
export function rememberRichContent(register: VimRegister, content: RichContent) {
    remembered.set(register.keyBuffer, { text: register.toString(), content });
}

/** The rich content that `register` puts as `text`, if it was read from a note. */
export function getRichContent(register: VimRegister, text: string): RichContent | undefined {
    const entry = remembered.get(register.keyBuffer);
    return entry?.text === text ? entry.content : undefined;
}

/** Forgets every rich content. */
export function forgetRichContents() {
    remembered = new WeakMap();
}

/**
 * Reads the content from `from` to `to`: with `isLinewise`, the blocks of the lines it covers,
 * the parts of a block between soft breaks as blocks of their own, or else the content of the
 * range.
 */
export function readRichContent(
    editor: Editor, index: LineIndex, from: LinePosition, to: LinePosition, isLinewise: boolean
): RichContent {
    const model = editor.model;
    if (!isLinewise) {
        const range = model.createRange(
            index.positionAt(from.line, from.ch), index.positionAt(to.line, to.ch));
        const fragment = model.getSelectedContent(model.createSelection(range));
        return { fragment, isBlocks: false };
    }

    const first = Math.min(from.line, index.lastLine);
    const isEndOut = to.ch === 0 && to.line > from.line;
    const last = Math.min(isEndOut ? to.line - 1 : to.line, index.lastLine);
    return model.change((writer) => {
        const fragment = writer.createDocumentFragment();
        let line = first;
        while (line <= last) {
            const element = index.getElement(line) as ModelElement;
            const elementLines = index.getLinesOf(element);
            const read = elementLines.filter((each) => each >= first && each <= last);
            if (read.length === elementLines.length) {
                writer.append(writer.cloneElement(element, true), fragment);
            } else {
                for (const segment of read) {
                    writer.append(cloneSegment(writer, index.lines[segment] as TextLine), fragment);
                }
            }
            line = read[read.length - 1] + 1;
        }
        return { fragment, isBlocks: true };
    });
}

/**
 * A block with the content of `line`, a part of a block between soft breaks. A code line becomes
 * a paragraph.
 */
function cloneSegment(writer: ModelWriter, line: TextLine): ModelElement {
    const source = line.block;
    const block = source.is("element", "codeBlock")
        ? writer.createElement("paragraph")
        : writer.createElement(source.name, source.getAttributes());
    for (const child of source.getChildren()) {
        const start = child.startOffset as number;
        if (start >= line.start && start < line.end) {
            writer.append(cloneNode(writer, child), block);
        }
    }
    return block;
}

/** A copy of `fragment` that an insertion can take apart. */
export function cloneFragment(
    writer: ModelWriter, fragment: ModelDocumentFragment
): ModelDocumentFragment {
    const copy = writer.createDocumentFragment();
    for (const child of fragment.getChildren()) {
        writer.append(cloneNode(writer, child), copy);
    }
    return copy;
}

function cloneNode(writer: ModelWriter, node: ModelNode): ModelNode {
    return node.is("$text")
        ? writer.createText(node.data, node.getAttributes())
        : writer.cloneElement(node as ModelElement, true);
}

/**
 * Puts the blocks of `content`, or a paragraph for each line of `text`, `count` times after line
 * `line` of `index`, or before it. A block takes the kind that its place gives it: an item of a
 * list, a code line in a code block, a paragraph inside a quote, an admonition or a cell. A code
 * line outside a code block and a title, such as that of a tab, become paragraphs, and lines put
 * on a title go to the start of the content under it. A widget put into a list joins the item,
 * and one put into a code block is left out. Returns the position at the start of the first block
 * put, or `null` when nothing was put.
 */
export function putLines(
    editor: Editor, index: LineIndex, line: number, isAfter: boolean,
    content: RichContent | undefined, text: string, count: number
): ModelPosition | null {
    const entry = index.lines[line];
    const lines = text.replace(/\n$/, "").split("\n");

    return editor.model.change((writer) => {
        if (entry.kind === "text" && entry.block.is("element", "codeBlock")) {
            const codeLines = repeat(lines, count).filter((each) => each !== OBJECT_CHARACTER)
                .map((each) => each.replaceAll(OBJECT_CHARACTER, ""));
            return codeLines.length ? putCodeLines(writer, entry, isAfter, codeLines) : null;
        }

        const blocks: ModelElement[] = [];
        for (let time = 0; time < count; time++) {
            if (content?.isBlocks) {
                const copy = cloneFragment(writer, content.fragment);
                for (const block of [ ...copy.getChildren() ] as ModelElement[]) {
                    blocks.push(...(block.is("element", "codeBlock")
                        ? splitCodeBlock(writer, block)
                        : [ block ]));
                }
            } else {
                for (const lineText of lines) {
                    const paragraph = writer.createElement("paragraph");
                    writer.insertText(lineText.replaceAll(OBJECT_CHARACTER, ""), paragraph);
                    blocks.push(paragraph);
                }
            }
        }

        const anchor = entry.kind === "text" ? entry.block : entry.element;
        const destination = entry.kind === "text" ? entry.block : null;
        let position = getPutPosition(writer, anchor, isAfter);
        const fitter = new BlockFitter(writer, destination, blocks);
        let firstPut: ModelElement | null = null;
        for (const block of blocks) {
            if (fitter.fit(block, position)) {
                writer.insert(block, position);
                firstPut ??= block;
                position = writer.createPositionAfter(block);
            }
        }
        return firstPut ? getStartOf(writer, firstPut) : null;
    });
}

/**
 * Where blocks put after `anchor`, or before it, go. Nothing goes beside a title: the blocks go to
 * the start of the content after it, such as the panel of a tab, or else after its container.
 */
function getPutPosition(writer: ModelWriter, anchor: ModelElement, isAfter: boolean) {
    const schema = writer.model.schema;
    if (!isTitle(schema, anchor)) {
        return isAfter ? writer.createPositionAfter(anchor) : writer.createPositionBefore(anchor);
    }
    const body = anchor.nextSibling;
    const bodyStart = body?.is("element") ? writer.createPositionAt(body, 0) : null;
    if (bodyStart && schema.checkChild(bodyStart, "paragraph")) {
        return bodyStart;
    }
    const afterTitle = writer.createPositionAfter(anchor);
    return schema.checkChild(afterTitle, "paragraph")
        ? afterTitle
        : writer.createPositionAfter(anchor.parent as ModelElement);
}

/** The lines of `codeBlock` as paragraphs. */
function splitCodeBlock(writer: ModelWriter, codeBlock: ModelElement): ModelElement[] {
    const paragraphs = [ writer.createElement("paragraph") ];
    for (const child of [ ...codeBlock.getChildren() ]) {
        if (child.is("element", "softBreak")) {
            paragraphs.push(writer.createElement("paragraph"));
        } else {
            writer.append(cloneNode(writer, child), paragraphs[paragraphs.length - 1]);
        }
    }
    return paragraphs;
}

/** Adds `lines` as code lines after the code line `entry`, or before it. */
function putCodeLines(
    writer: ModelWriter, entry: TextLine, isAfter: boolean, lines: string[]
): ModelPosition {
    let current = writer.createPositionAt(entry.block, isAfter ? entry.end : entry.start);
    if (isAfter) {
        writer.insertElement("softBreak", current);
        current = current.getShiftedBy(1);
    }
    const start = current;
    for (const [ lineIndex, lineText ] of lines.entries()) {
        if (lineIndex > 0) {
            writer.insertElement("softBreak", current);
            current = current.getShiftedBy(1);
        }
        if (lineText) {
            writer.insertText(lineText, current);
            current = current.getShiftedBy(lineText.length);
        }
    }
    if (!isAfter) {
        writer.insertElement("softBreak", current);
    }
    return start;
}

/**
 * Gives put blocks the kind of the place they land in. A list keeps its items together: blocks
 * that came from one item stay one item.
 */
class BlockFitter {

    private readonly itemIds = new Map<unknown, string>();
    private readonly lowestIndent: number;

    constructor(
        private readonly writer: ModelWriter,
        private readonly destination: ModelElement | null,
        blocks: ModelElement[]
    ) {
        const indents = blocks.filter((block) => block.hasAttribute("listItemId"))
            .map((block) => block.getAttribute("listIndent") as number);
        this.lowestIndent = indents.length ? Math.min(...indents) : 0;
    }

    /** Fits `block` to `position`. Returns `false` when the schema allows no such block there. */
    fit(block: ModelElement, position: ModelPosition): boolean {
        const writer = this.writer;
        const schema = writer.model.schema;
        const parent = position.parent as ModelElement;
        const listDestination = this.destination?.hasAttribute("listItemId")
            ? this.destination
            : null;
        const isParagraphPlace = PARAGRAPH_CONTAINERS.has(parent.name)
            || !schema.checkChild(position, block);
        const isRenamed = !schema.isObject(block) && (listDestination || isParagraphPlace)
            && block.name !== "paragraph" && schema.checkChild(position, "paragraph");
        if (isRenamed) {
            writer.rename(block, "paragraph");
            for (const key of [ ...block.getAttributeKeys() ]) {
                if (!schema.checkAttribute(block, key)) {
                    writer.removeAttribute(key, block);
                }
            }
        }

        const sourceId = block.getAttribute("listItemId");
        const sourceIndent = block.getAttribute("listIndent") as number;
        const sourceType = block.getAttribute("listType");
        for (const key of [ "listItemId", "listType", "listIndent" ]) {
            writer.removeAttribute(key, block);
        }
        const canBeListed = schema.checkAttribute(block, "listItemId");
        if (listDestination && canBeListed) {
            const isJoiningItem = schema.isObject(block) && sourceId === undefined;
            const itemId = isJoiningItem
                ? listDestination.getAttribute("listItemId")
                : this.getItemId(sourceId);
            writer.setAttributes({
                listItemId: itemId,
                listType: listDestination.getAttribute("listType"),
                listIndent: (listDestination.getAttribute("listIndent") as number)
                    + (sourceId === undefined ? 0 : sourceIndent - this.lowestIndent)
            }, block);
        } else if (sourceId !== undefined && !PARAGRAPH_CONTAINERS.has(parent.name)
            && canBeListed) {
            writer.setAttributes({
                listItemId: this.getItemId(sourceId),
                listType: sourceType,
                listIndent: sourceIndent - this.lowestIndent
            }, block);
        }
        return schema.checkChild(position, block);
    }

    /** A new id for the item `sourceId`, the same for each of its blocks, or a new item. */
    private getItemId(sourceId: unknown): string {
        if (sourceId === undefined) {
            return uid();
        }
        let id = this.itemIds.get(sourceId);
        if (!id) {
            id = uid();
            this.itemIds.set(sourceId, id);
        }
        return id;
    }
}

/** The position at the start of the text of `block`, or before it when it holds no text. */
function getStartOf(writer: ModelWriter, block: ModelElement): ModelPosition {
    return writer.model.schema.checkChild(block, "$text")
        ? writer.createPositionAt(block, 0)
        : writer.createPositionBefore(block);
}

function repeat<T>(items: T[], count: number): T[] {
    const repeated: T[] = [];
    for (let time = 0; time < count; time++) {
        repeated.push(...items);
    }
    return repeated;
}
