import "../theme/collapsible_list_items.css";

import { Command, ListEditing, MouseObserver, Plugin, type Editor, type ModelElement, type ModelNode, type ModelWriter, type ViewDocumentMouseDownEvent, type ViewElement } from "ckeditor5";

export const LIST_COLLAPSED_ATTRIBUTE = "listCollapsed";

const COLLAPSED_DATA_ATTRIBUTE = "data-trilium-collapsed";

/**
 * Allows collapsing/expanding nested list items, similar to outliners such as Dynalist or Roam.
 *
 * The collapsed state is kept as a `listCollapsed` model attribute, persisted into the note
 * content as `data-trilium-collapsed="true"` on the `<li>`. Hiding the nested items is done by
 * CSS scoped to the editing view, so read-only and shared note rendering stay fully expanded.
 */
export default class CollapsibleListItems extends Plugin {

    static get requires() {
        return [ListEditing] as const;
    }

    init() {
        const editor = this.editor;

        editor.model.schema.extend("$block", {allowAttributes: LIST_COLLAPSED_ATTRIBUTE});

        editor.commands.add("toggleListCollapse", new ToggleListCollapseCommand(editor));

        editor.plugins.get(ListEditing).registerDowncastStrategy({
            scope: "item",
            attributeName: LIST_COLLAPSED_ATTRIBUTE,
            setAttributeOnDowncast(writer, value, element) {
                if (value) {
                    writer.setAttribute(COLLAPSED_DATA_ATTRIBUTE, "true", element);
                } else {
                    writer.removeAttribute(COLLAPSED_DATA_ATTRIBUTE, element);
                }
            }
        });

        editor.conversion.for("upcast").attributeToAttribute({
            view: {name: "li", key: COLLAPSED_DATA_ATTRIBUTE},
            model: {
                key: LIST_COLLAPSED_ATTRIBUTE,
                value: (viewElement: ViewElement) => viewElement.getAttribute(COLLAPSED_DATA_ATTRIBUTE) === "true" ? true : null
            }
        });

        this._enableToggleOnGutterClick();
        this._enableToggleOnKeystroke();
        this._enableAutoExpand();
    }

    /**
     * Toggles the collapsed state on Ctrl+Alt+Enter, uniformly for every list type. Ctrl+Enter is
     * deliberately avoided: it is already the native to-do "check item" shortcut (and a Trilium
     * global), so collapse gets its own conflict-free binding rather than fighting over it.
     */
    private _enableToggleOnKeystroke() {
        const editor = this.editor;

        editor.keystrokes.set("Ctrl+Alt+Enter", (_data, cancel) => {
            const command = editor.commands.get("toggleListCollapse");
            if (!command?.isEnabled) {
                return;
            }
            editor.execute("toggleListCollapse");
            cancel();
        });
    }

    /**
     * Toggles the collapsed state when the arrow rendered in the gutter next to a list item is
     * clicked. The arrow is the item's `::before` pseudo-element placed outside its border box,
     * so a mouse event left of the `<li>` box that still targets the `<li>` is an arrow click.
     */
    private _enableToggleOnGutterClick() {
        const editor = this.editor;
        const view = editor.editing.view;

        view.addObserver(MouseObserver);

        this.listenTo<ViewDocumentMouseDownEvent>(view.document, "mousedown", (evt, data) => {
            const viewItem = data.target;
            if (!viewItem || !viewItem.is("element", "li")) {
                return;
            }

            const domItem = data.domTarget as HTMLElement;
            const rect = domItem.getBoundingClientRect();
            const isRtl = domItem.ownerDocument.defaultView?.getComputedStyle(domItem).direction === "rtl";
            const isGutterClick = isRtl ? data.domEvent.clientX > rect.right : data.domEvent.clientX < rect.left;
            if (!isGutterClick) {
                return;
            }

            const block = getListBlockFromViewListItem(editor, viewItem);
            if (!block || !hasNestedItems(block)) {
                return;
            }

            // Keep the caret where it is instead of moving it to the clicked item.
            data.preventDefault();
            evt.stop();
            toggleCollapsed(editor, block);
        });
    }

    /**
     * Expands collapsed ancestors whenever content would otherwise become (or stay) invisible:
     * when the selection lands inside a hidden block (arrow keys, find & replace, a backspace
     * merge) and when blocks are placed under a collapsed parent (indent, paste, move).
     */
    private _enableAutoExpand() {
        const editor = this.editor;
        const model = editor.model;

        this.listenTo(model.document.selection, "change:range", () => {
            const block = model.document.selection.getFirstPosition()?.parent;
            if (!block || !block.is("element") || !block.hasAttribute("listItemId")) {
                return;
            }

            const collapsedAncestors = getCollapsedAncestors(block);
            if (collapsedAncestors.length === 0) {
                return;
            }

            model.enqueueChange({isUndoable: false}, (writer) => {
                for (const ancestor of collapsedAncestors) {
                    expandItem(writer, ancestor);
                }
            });
        });

        model.document.registerPostFixer((writer) => {
            const insertedNodes = new Set<ModelNode>();
            const changedBlocks = new Set<ModelElement>();

            for (const entry of model.document.differ.getChanges()) {
                if (entry.type === "insert") {
                    let node: ModelNode | null = entry.position.nodeAfter;
                    for (let i = 0; i < entry.length && node; i++, node = node.nextSibling) {
                        insertedNodes.add(node);
                        if (node.is("element") && node.hasAttribute("listItemId")) {
                            changedBlocks.add(node);
                        }
                    }
                } else if (entry.type === "attribute" && (entry.attributeKey === "listIndent" || entry.attributeKey === "listItemId")) {
                    const node = entry.range.start.nodeAfter;
                    /* v8 ignore next -- defensive: the differ always reports a list block-attribute change with the affected block as range.start.nodeAfter, so `node` is never null here (the falsy branch is unreachable from any model operation). */
                    if (node && node.is("element") && node.hasAttribute("listItemId")) {
                        changedBlocks.add(node);
                    }
                }
            }

            let changed = false;
            for (const block of changedBlocks) {
                for (const ancestor of getCollapsedAncestors(block)) {
                    // An ancestor inserted in the same change set arrived together with its
                    // hidden children (data load, paste of a collapsed subtree) — keep it.
                    if (insertedNodes.has(ancestor)) {
                        continue;
                    }
                    expandItem(writer, ancestor);
                    changed = true;
                }
                // Splitting a collapsed item (e.g. pressing Enter) copies the attribute onto the
                // new block; drop it again when the new item has nothing to collapse.
                if (block.getAttribute(LIST_COLLAPSED_ATTRIBUTE) && !hasNestedItems(block)) {
                    writer.removeAttribute(LIST_COLLAPSED_ATTRIBUTE, block);
                    changed = true;
                }
            }

            return changed;
        });
    }

}

/**
 * Toggles the collapsed state of the list item under the selection. Exposed as
 * `toggleListCollapse` for keyboard shortcuts and scripting.
 */
export class ToggleListCollapseCommand extends Command {

    declare public value: boolean;

    refresh() {
        const block = getSelectedListBlock(this.editor);
        this.isEnabled = !!block && hasNestedItems(block);
        this.value = !!block?.getAttribute(LIST_COLLAPSED_ATTRIBUTE);
    }

    execute() {
        const block = getSelectedListBlock(this.editor);
        if (block && hasNestedItems(block)) {
            toggleCollapsed(this.editor, block);
        }
    }

}

function toggleCollapsed(editor: Editor, block: ModelElement): void {
    const collapse = !block.getAttribute(LIST_COLLAPSED_ATTRIBUTE);

    editor.model.change((writer) => {
        for (const itemBlock of getItemBlocks(block)) {
            if (collapse) {
                writer.setAttribute(LIST_COLLAPSED_ATTRIBUTE, true, itemBlock);
            } else {
                writer.removeAttribute(LIST_COLLAPSED_ATTRIBUTE, itemBlock);
            }
        }
    });
}

function expandItem(writer: ModelWriter, block: ModelElement): void {
    for (const itemBlock of getItemBlocks(block)) {
        writer.removeAttribute(LIST_COLLAPSED_ATTRIBUTE, itemBlock);
    }
}

function getSelectedListBlock(editor: Editor): ModelElement | null {
    const parent = editor.model.document.selection.getFirstPosition()?.parent;
    if (parent && parent.is("element") && parent.hasAttribute("listItemId")) {
        return parent;
    }
    return null;
}

/**
 * Maps the view `<li>` back to the first model block of the list item. The model keeps lists
 * flat (sibling blocks with `listIndent`/`listItemId` attributes).
 *
 * A view position at the `<li>`'s offset 0 maps *before* the item's first block for plain lists
 * (so the block is `nodeAfter`), but *inside* it for to-do lists — their `<li>` wraps content in
 * a `<span class="todo-list__label">`, so offset 0 sits before that wrapper and the mapped model
 * position lands within the block (whose `nodeAfter` is then a text node). Resolve from both the
 * node after the position and the position's own block ancestry to cover both shapes.
 */
function getListBlockFromViewListItem(editor: Editor, viewItem: ViewElement): ModelElement | null {
    const viewPosition = editor.editing.view.createPositionAt(viewItem, 0);
    const modelPosition = editor.editing.mapper.toModelPosition(viewPosition);

    if (isListBlock(modelPosition.nodeAfter)) {
        return modelPosition.nodeAfter;
    }
    // To-do case: the position landed inside the block; walk up to the enclosing list item. A
    // view <li> at offset 0 always maps either to a node-after that is a list block (handled
    // above) or to a model position whose parent is the list-item block itself (to-do lists), so
    // the very first iteration always finds `listItemId` and returns (the to-do tests exercise
    // this). The loop's continuation, its no-listItemId branch, and the trailing `return null` are
    // defensive only — kept in case CKEditor's view->model mapping ever changes shape — and are
    // unreachable from any current model/view state, so the whole walk is excluded from coverage.
    let ancestor: typeof modelPosition.parent | null = modelPosition.parent;
    /* v8 ignore start -- defensive walk-up; the first iteration always resolves the list item (see above). */
    while (ancestor && ancestor.is("element")) {
        if (ancestor.hasAttribute("listItemId")) {
            return ancestor;
        }
        ancestor = ancestor.parent;
    }
    return null;
    /* v8 ignore stop */
}

/** Whether the list item has nested (deeper-indented) items, i.e. there is anything to collapse. */
function hasNestedItems(block: ModelElement): boolean {
    const itemId = block.getAttribute("listItemId");
    for (let sibling = block.nextSibling; isListBlock(sibling); sibling = sibling.nextSibling) {
        if (sibling.getAttribute("listItemId") !== itemId) {
            return getIndent(sibling) > getIndent(block);
        }
    }
    return false;
}

/** All consecutive blocks belonging to the same (possibly multi-block) list item. */
function getItemBlocks(block: ModelElement): ModelElement[] {
    const itemId = block.getAttribute("listItemId");
    const blocks = [block];
    for (let prev = block.previousSibling; isListBlock(prev) && prev.getAttribute("listItemId") === itemId; prev = prev.previousSibling) {
        blocks.unshift(prev);
    }
    for (let next = block.nextSibling; isListBlock(next) && next.getAttribute("listItemId") === itemId; next = next.nextSibling) {
        blocks.push(next);
    }
    return blocks;
}

/**
 * The collapsed ancestor items hiding this block, outermost last. Ancestors are the preceding
 * sibling blocks with a lower indent than any block in between.
 */
function getCollapsedAncestors(block: ModelElement): ModelElement[] {
    const ancestors: ModelElement[] = [];
    let minIndent = getIndent(block);

    for (let prev = block.previousSibling; isListBlock(prev) && minIndent > 0; prev = prev.previousSibling) {
        const indent = getIndent(prev);
        if (indent >= minIndent) {
            continue;
        }
        minIndent = indent;
        if (prev.getAttribute(LIST_COLLAPSED_ATTRIBUTE)) {
            ancestors.push(prev);
        }
    }

    return ancestors;
}

function isListBlock(node: ModelNode | null): node is ModelElement {
    return !!node && node.is("element") && node.hasAttribute("listItemId");
}

function getIndent(block: ModelElement): number {
    const indent = block.getAttribute("listIndent");
    return typeof indent === "number" ? indent : 0;
}
