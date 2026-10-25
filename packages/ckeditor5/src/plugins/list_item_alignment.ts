import {
    _getAllListItemBlocks, _isListItemBlock, ListEditing, type ModelElement, type ModelItem,
    type ModelWriter, Plugin, type UpcastElementEvent
} from "ckeditor5";

import {
    getListItemAlignmentClass, isListItemAlignment, LIST_ITEM_ALIGNMENTS,
    type ListItemAlignmentValue
} from "./list_item_alignment_read_only.js";

/** The alignment of the item's first paragraph, set on every block of the item. */
const ATTRIBUTE = "listItemAlignment";

/** The changes that can move an item's blocks or the alignment of its first paragraph. */
const SOURCE_ATTRIBUTES = new Set([ "alignment", "listItemId", "listIndent", "listType" ]);

/**
 * Puts a class on each list item whose first paragraph is aligned, so that `lists.css` can move
 * the item, and its marker, next to the text. The class exists in the editing view only: saved
 * content keeps the paragraph's `text-align`, and `applyListItemAlignment()` adds the class where
 * that content is shown read-only.
 */
export default class ListItemAlignment extends Plugin {

    static get requires() {
        return [ ListEditing ] as const;
    }

    static get pluginName() {
        return "ListItemAlignment" as const;
    }

    init() {
        const editor = this.editor;

        // Every block of an item has its own `<li>`, and the editing view merges them into one.
        editor.plugins.get(ListEditing).registerDowncastStrategy({
            scope: "item",
            attributeName: ATTRIBUTE,
            setAttributeOnDowncast(writer, value, element, options) {
                if (!options.dataPipeline) {
                    const name = getListItemAlignmentClass(value as ListItemAlignmentValue);
                    writer.addClass(name, element);
                }
            }
        });

        // Read-only content has the classes, and General HTML Support keeps pasted classes.
        editor.conversion.for("upcast").add((dispatcher) => {
            dispatcher.on<UpcastElementEvent>("element:li", (_evt, data, conversionApi) => {
                for (const alignment of LIST_ITEM_ALIGNMENTS) {
                    const classes = getListItemAlignmentClass(alignment);
                    conversionApi.consumable.consume(data.viewItem, { classes });
                }
            }, { priority: "high" });
        });

        editor.model.document.registerPostFixer((writer) => this.syncAlignments(writer));
    }

    afterInit() {
        const schema = this.editor.model.schema;
        schema.extend("$listItem", { allowAttributes: ATTRIBUTE });
        schema.addAttributeCheck((context) => {
            if (!context.last.getAttribute("listItemId")) {
                return false;
            }
        }, ATTRIBUTE);
    }

    /** Updates the attribute on the items of the blocks that the last change touched. */
    private syncAlignments(writer: ModelWriter) {
        const blocks = new Set<ModelElement>();
        const add = (item: ModelItem | null) => {
            if (_isListItemBlock(item)) {
                blocks.add(item);
            }
        };

        for (const change of this.editor.model.document.differ.getChanges()) {
            if (change.type === "attribute") {
                if (SOURCE_ATTRIBUTES.has(change.attributeKey)) {
                    for (const item of change.range.getItems({ shallow: true })) {
                        add(item);
                    }
                }
            } else {
                add(change.position.nodeBefore);
                add(change.position.nodeAfter);
                if (change.type === "insert" && change.name !== "$text") {
                    const end = change.position.getShiftedBy(change.length);
                    for (const item of writer.createRange(change.position, end).getItems()) {
                        add(item);
                    }
                }
            }
        }

        const synced = new Set<ModelElement>();
        let isChanged = false;
        for (const block of blocks) {
            if (synced.has(block)) {
                continue;
            }
            const itemBlocks = _getAllListItemBlocks(block);
            const paragraph = itemBlocks.find((itemBlock) => itemBlock.is("element", "paragraph"));
            const alignment = paragraph?.getAttribute("alignment");
            const value = isListItemAlignment(alignment) ? alignment : undefined;
            for (const itemBlock of itemBlocks) {
                synced.add(itemBlock);
                if (itemBlock.getAttribute(ATTRIBUTE) === value) {
                    continue;
                }
                if (value) {
                    writer.setAttribute(ATTRIBUTE, value, itemBlock);
                } else {
                    writer.removeAttribute(ATTRIBUTE, itemBlock);
                }
                isChanged = true;
            }
        }
        return isChanged;
    }
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ListItemAlignment.pluginName]: ListItemAlignment;
    }
}
