import {
    type Editor, type ModelElement, ModelLivePosition, type ModelNode, type ModelPosition,
    type ModelWriter
} from "ckeditor5";

/**
 * Where content or a container goes, relative to the current container among its siblings, such
 * as the columns of a layout or the tabs of a tabs block.
 */
export type SiblingTarget = "previous" | "next" | "first" | "last";

/** The children of `parent` that a selection touches, from `first` to `last`. */
export interface SelectedChildren {
    parent: ModelElement;
    first: ModelNode;
    last: ModelNode;
}

/**
 * Returns the sibling of `element` that `target` names, or `null` when that is `element` itself or
 * there is no such sibling.
 */
export function getSibling(element: ModelElement, target: SiblingTarget): ModelElement | null {
    const siblings = [...(element.parent as ModelElement).getChildren()] as ModelElement[];
    const index = siblings.indexOf(element);
    const last = siblings.length - 1;
    const found = siblings[{ previous: index - 1, next: index + 1, first: 0, last }[target]];
    return found && found !== element ? found : null;
}

/** Moves `element` to the place of its sibling `sibling`, which shifts toward the old place. */
export function moveToSibling(writer: ModelWriter, element: ModelElement, sibling: ModelElement) {
    writer.move(writer.createRangeOn(element), sibling.isAfter(element)
        ? writer.createPositionAfter(sibling)
        : writer.createPositionBefore(sibling));
}

/**
 * Returns the innermost `name` element around a non-collapsed selection, with the first and last
 * of its children that the selection touches, or `null` when the selection ends outside it. A
 * selection that ends at the start of a child leaves that child out. A touched list item counts
 * with all of its blocks.
 */
export function getSelectedChildren(editor: Editor, name: string): SelectedChildren | null {
    const model = editor.model;
    const selection = model.document.selection;
    const start = selection.getFirstPosition();
    const end = selection.getLastPosition();
    const parent = start?.findAncestor(name);
    if (selection.isCollapsed || !start || !end || !parent || end.findAncestor(name) !== parent) {
        return null;
    }

    const first = getChildAt(parent, start, "after");
    let last = getChildAt(parent, end, "before");
    if (last && end.parent !== parent && end.isTouching(model.createPositionAt(last, 0))) {
        last = last.previousSibling;
    }
    /* v8 ignore next 3 -- a selection that is not collapsed touches a child of its parent */
    if (!first || !last) {
        return null;
    }
    return {
        parent,
        first: getListItemEnd(first, "previousSibling"),
        last: getListItemEnd(last, "nextSibling")
    };
}

/**
 * Moves the children from `first` to `last` into `destination`, and the selection with them. They
 * go to the end of a destination before `parent` and to the start of one after it, so they keep
 * their place in the reading order. A destination without content loses its empty paragraph.
 */
export function moveSelectedChildren(
    editor: Editor, { parent, first, last }: SelectedChildren, destination: ModelElement
) {
    // The ends stick to the moved children; one in the child after `last` moves into `last`.
    const model = editor.model;
    const after = model.createPositionAfter(last);
    /* v8 ignore next -- `last` holds a place for the selection, or is an object itself */
    const lastEnd = model.schema.getNearestSelectionRange(after, "backward")?.end ?? after;
    const ends = [...model.document.selection.getRanges()].map(range => [
        ModelLivePosition.fromPosition(range.start, "toNext"),
        ModelLivePosition.fromPosition(range.end.isAfter(after) ? lastEnd : range.end, "toPrevious")
    ] as const);

    model.change(writer => {
        if (!hasContent(destination)) {
            writer.remove(writer.createRangeIn(destination));
        }
        const moved = writer.createRange(
            writer.createPositionBefore(first), writer.createPositionAfter(last));
        const offset = destination.isAfter(parent) ? 0 : "end";
        writer.move(moved, writer.createPositionAt(destination, offset));
        writer.setSelection(ends.map(([start, end]) => writer.createRange(start, end)));
    });

    for (const position of ends.flat()) {
        position.detach();
    }
}

/** Whether `element` holds more than the empty paragraph that a new column or tab starts with. */
export function hasContent(element: ModelElement) {
    const first = element.getChild(0);
    if (!first) {
        return false;
    }
    return element.childCount > 1
        || !first.is("element", "paragraph")
        || !first.isEmpty
        || first.hasAttribute("listItemId");
}

/**
 * Returns the child of `parent` that holds `position`, or the node on `side` of `position` when it
 * is directly in `parent`.
 */
function getChildAt(parent: ModelElement, position: ModelPosition, side: "before" | "after") {
    if (position.parent === parent) {
        return side === "after" ? position.nodeAfter : position.nodeBefore;
    }
    return position.getAncestors().find((ancestor): ancestor is ModelElement =>
        ancestor.is("element") && ancestor.parent === parent);
}

/**
 * Returns the block on `side` of `node` that ends the list item of `node`, or `node` when it is not
 * a list block.
 */
function getListItemEnd(node: ModelNode, side: "previousSibling" | "nextSibling"): ModelNode {
    const itemId = node.getAttribute("listItemId");
    let end = node;
    let sibling = end[side];
    while (itemId && sibling?.getAttribute("listItemId") === itemId) {
        end = sibling;
        sibling = sibling[side];
    }
    return end;
}
