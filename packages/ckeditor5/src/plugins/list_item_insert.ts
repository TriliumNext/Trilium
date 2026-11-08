import {
    _getAllListItemBlocks as getAllListItemBlocks, _getNestedListBlocks as getNestedListBlocks,
    _isListItemBlock as isListItemBlock, type _ListElement as ListElement,
    _ListItemUid as ListItemUid, Command, type Editor, ListEditing, Plugin
} from "ckeditor5";

/** Where {@link InsertListItemCommand} puts the new item, next to an item at the selection. */
export type ListItemInsertPosition = "above" | "below" | "child";

/** The attributes that a new item takes from an item of the list it joins. */
const LIST_ATTRIBUTES = [ "listType", "listStyle", "listStart", "listReversed" ];

/**
 * Adds the commands that insert an empty list item above the item at the selection, below it and
 * its nested items, or as its first nested item.
 */
export default class ListItemInsert extends Plugin {

    static get requires() {
        return [ ListEditing ] as const;
    }

    static get pluginName() {
        return "ListItemInsert" as const;
    }

    init() {
        const editor = this.editor;

        editor.commands.add("triliumInsertListItemAbove",
            new InsertListItemCommand(editor, "above"));
        editor.commands.add("triliumInsertListItemBelow",
            new InsertListItemCommand(editor, "below"));
        editor.commands.add("triliumInsertChildListItem",
            new InsertListItemCommand(editor, "child"));
    }
}

/**
 * Inserts an empty paragraph as a list item next to the item of the first selected block, for
 * `above`, or of the last one, and puts the selection in it.
 */
export class InsertListItemCommand extends Command {

    private readonly position: ListItemInsertPosition;

    constructor(editor: Editor, position: ListItemInsertPosition) {
        super(editor);
        this.position = position;
    }

    override refresh() {
        this.isEnabled = !!this.getItemBlock();
    }

    override execute() {
        const block = this.getItemBlock();
        /* v8 ignore next 3 -- defensive: disabled whenever the selection is outside a list item */
        if (!block) {
            return;
        }

        const model = this.editor.model;
        const itemBlocks = getAllListItemBlocks(block);
        const lastItemBlock = itemBlocks[itemBlocks.length - 1];
        const nested = getNestedListBlocks(lastItemBlock);
        let position = model.createPositionBefore(itemBlocks[0]);
        let listIndent = block.getAttribute("listIndent");
        // The item of the list that the new item joins. A new nested list takes only the type.
        let source: ListElement | undefined = block;
        if (this.position === "below") {
            position = model.createPositionAfter(nested.at(-1) ?? lastItemBlock);
        } else if (this.position === "child") {
            // The first nested list can follow any block of the item, not only the last one.
            source = itemBlocks.map((itemBlock) => getNestedListBlocks(itemBlock).at(0))
                .find(Boolean);
            position = source
                ? model.createPositionBefore(source)
                : model.createPositionAfter(lastItemBlock);
            listIndent += 1;
        }

        model.change((writer) => {
            const attributes = source
                ? LIST_ATTRIBUTES.filter((key) => source.hasAttribute(key))
                    .map((key) => [ key, source.getAttribute(key) ])
                : [ [ "listType", block.getAttribute("listType") ] ];
            const item = writer.createElement("paragraph", {
                ...Object.fromEntries(attributes),
                listIndent,
                listItemId: ListItemUid.next()
            });
            writer.insert(item, position);
            writer.setSelection(item, "in");
        });
    }

    /** The list block whose item the new item goes next to, if the selection is in a list item. */
    private getItemBlock(): ListElement | undefined {
        const blocks = Array.from(this.editor.model.document.selection.getSelectedBlocks());
        const block = this.position === "above" ? blocks.at(0) : blocks.at(-1);
        return block && isListItemBlock(block) ? block : undefined;
    }
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ListItemInsert.pluginName]: ListItemInsert;
    }

    interface CommandsMap {
        triliumInsertListItemAbove: InsertListItemCommand;
        triliumInsertListItemBelow: InsertListItemCommand;
        triliumInsertChildListItem: InsertListItemCommand;
    }
}
