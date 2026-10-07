import { BLOCK_ID_ATTRIBUTE, type BlockRange, isValidBlockId } from "@triliumnext/commons";
import {
    Command, type Model, type ModelElement, type ModelWriter, Plugin, type ViewElement
} from "ckeditor5";

/** The model attribute with the id of a block. */
export const BLOCK_ID = "blockId";

const BLOCK_ID_LENGTH = 12;
const BLOCK_ID_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const EDGES = [ "first", "last" ] as const;

type Edge = typeof EDGES[number];

/** The blocks that a reference made from the selection points at. */
export interface BlockReferenceTarget {
    startId: string;
    endId: string;
    count: number;
}

/**
 * Stores the id of a referenced block as `data-trilium-block-id`, and keeps each id unique in the
 * document.
 */
export default class BlockReferenceEditing extends Plugin {

    private isRangeEditor = false;

    static get pluginName() {
        return "BlockReferenceEditing" as const;
    }

    init() {
        const editor = this.editor;
        const schema = editor.model.schema;

        schema.extend("$container", { allowAttributes: BLOCK_ID });
        schema.addAttributeCheck(
            (context) => schema.isBlock(context.last.name) ? true : undefined,
            BLOCK_ID
        );

        editor.conversion.for("upcast").attributeToAttribute({
            view: { key: BLOCK_ID_ATTRIBUTE },
            model: {
                key: BLOCK_ID,
                value: (viewElement: ViewElement) => {
                    const id = viewElement.getAttribute(BLOCK_ID_ATTRIBUTE);
                    return isValidBlockId(id) ? id : null;
                }
            }
        });

        editor.conversion.for("downcast").attributeToAttribute({
            model: BLOCK_ID,
            view: BLOCK_ID_ATTRIBUTE
        });

        editor.model.document.registerPostFixer((writer) =>
            removeDuplicateBlockIds(editor.model, writer));
        editor.model.document.registerPostFixer((writer) =>
            this.isRangeEditor && giveIdsToEdgeBlocks(editor.model, writer));
        editor.commands.add("assignBlockReference", new AssignBlockReferenceCommand(editor));
    }

    /**
     * Makes the editor hold a range of blocks of a note. Its first and its last block then always
     * have an id, which `getRange()` returns.
     */
    editRange() {
        this.isRangeEditor = true;
    }

    /**
     * The range from the first to the last block of the editor, or `null` while an edge has no
     * id. A block at an edge can start or end with other blocks, as a block quote does, and the
     * ids of `preferred` win among theirs.
     */
    getRange(preferred?: BlockRange | null): BlockRange | null {
        const model = this.editor.model;
        const startId = getEdgeId(model, "first", preferred?.startId);
        const endId = getEdgeId(model, "last", preferred?.endId);
        return startId && endId ? { startId, endId } : null;
    }
}

/** Gives ids to the first and the last block of the selection, and returns the reference. */
export class AssignBlockReferenceCommand extends Command {

    override refresh() {
        this.isEnabled = getReferenceBlocks(this.editor.model).length > 0;
    }

    override execute(): BlockReferenceTarget {
        const model = this.editor.model;
        const blocks = getReferenceBlocks(model);
        const first = blocks[0];
        const last = blocks[blocks.length - 1];

        model.change((writer) => {
            for (const block of new Set([ first, last ])) {
                if (!block.hasAttribute(BLOCK_ID)) {
                    writer.setAttribute(BLOCK_ID, generateBlockId(), block);
                }
            }
        });

        return {
            startId: first.getAttribute(BLOCK_ID) as string,
            endId: last.getAttribute(BLOCK_ID) as string,
            count: blocks.length
        };
    }
}

/**
 * The blocks of the selection that a reference can point at. A block inside an object, such as a
 * table cell, is replaced by the outermost object.
 */
export function getReferenceBlocks(model: Model) {
    const blocks: ModelElement[] = [];
    for (const block of model.document.selection.getSelectedBlocks()) {
        const outerObject = block.getAncestors()
            .find((ancestor): ancestor is ModelElement =>
                ancestor.is("element") && model.schema.isObject(ancestor));
        const target = outerObject ?? block;
        if (!blocks.includes(target) && model.schema.checkAttribute(target, BLOCK_ID)) {
            blocks.push(target);
        }
    }

    return blocks;
}

/**
 * Removes the id from a block inserted with an id that another block already has, as by a copy
 * and paste or an Enter split. After an Enter at the start of a block, the id stays with the text.
 */
function removeDuplicateBlockIds(model: Model, writer: ModelWriter) {
    const inserted = getInsertedBlocksWithId(model);
    if (!inserted.length) {
        return false;
    }

    const existing = getBlocksById(model, new Set(inserted));
    const seenIds = new Set<string>();
    let isChanged = false;

    for (const block of inserted) {
        const id = block.getAttribute(BLOCK_ID) as string;
        const original = existing.get(id);

        if (original?.isEmpty && !block.isEmpty) {
            writer.removeAttribute(BLOCK_ID, original);
            existing.delete(id);
            isChanged = true;
        } else if (original || seenIds.has(id)) {
            writer.removeAttribute(BLOCK_ID, block);
            isChanged = true;
        }
        seenIds.add(id);
    }

    return isChanged;
}

function giveIdsToEdgeBlocks(model: Model, writer: ModelWriter) {
    let isChanged = false;
    for (const edge of EDGES) {
        const blocks = getEdgeBlocks(model, edge);
        if (blocks.length && !blocks.some((block) => block.hasAttribute(BLOCK_ID))) {
            writer.setAttribute(BLOCK_ID, generateBlockId(), blocks[0]);
            isChanged = true;
        }
    }

    return isChanged;
}

function getEdgeId(model: Model, edge: Edge, preferred: string | undefined) {
    const ids = getEdgeBlocks(model, edge).flatMap((block) =>
        block.hasAttribute(BLOCK_ID) ? [ block.getAttribute(BLOCK_ID) as string ] : []);
    return ids.find((id) => id === preferred) ?? ids[0];
}

/** The block at an edge of the root, then the blocks inside that it starts or ends with. */
function getEdgeBlocks(model: Model, edge: Edge) {
    const blocks: ModelElement[] = [];
    let node = getEdgeChild(model.document.getRoot() as ModelElement, edge);
    while (node?.is("element") && model.schema.checkAttribute(node, BLOCK_ID)) {
        blocks.push(node);
        node = model.schema.isObject(node) ? null : getEdgeChild(node, edge);
    }

    return blocks;
}

function getEdgeChild(element: ModelElement, edge: Edge) {
    return element.getChild(edge === "first" ? 0 : element.childCount - 1);
}

function getInsertedBlocksWithId(model: Model) {
    const blocks: ModelElement[] = [];
    for (const change of model.document.differ.getChanges()) {
        if (change.type !== "insert" || change.name === "$text") {
            continue;
        }

        const end = change.position.getShiftedBy(change.length);
        const range = model.createRange(change.position, end);
        for (const item of range.getItems()) {
            if (item.is("element") && item.hasAttribute(BLOCK_ID)) {
                blocks.push(item);
            }
        }
    }

    return blocks;
}

function getBlocksById(model: Model, excluded: Set<ModelElement>) {
    const blocks = new Map<string, ModelElement>();
    for (const root of model.document.getRoots()) {
        for (const item of model.createRangeIn(root).getItems()) {
            if (item.is("element") && !excluded.has(item) && item.hasAttribute(BLOCK_ID)) {
                blocks.set(item.getAttribute(BLOCK_ID) as string, item);
            }
        }
    }

    return blocks;
}

function generateBlockId() {
    const bytes = crypto.getRandomValues(new Uint8Array(BLOCK_ID_LENGTH));
    const characters = Array.from(bytes, (byte) =>
        BLOCK_ID_CHARACTERS[byte % BLOCK_ID_CHARACTERS.length]);
    return characters.join("");
}
