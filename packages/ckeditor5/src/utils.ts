import type { DifferItemAttribute, Editor, ModelDocumentFragment, ModelElement, ModelNode } from "ckeditor5";

function hasHeadingAncestor(node: ModelElement | ModelNode | ModelDocumentFragment | null): boolean {
    let current: ModelElement | ModelNode | ModelDocumentFragment | null = node;
    while (current) {
        if (!!current && current.is('element') && (current as ModelElement).name.startsWith("heading")) return true;
        current = current.parent;
    }
    return false;
}

export function attributeChangeAffectsHeading(change: DifferItemAttribute, editor: Editor): boolean {
    if (change.type !== "attribute") return false;

    // Fast checks on range boundaries
    if (hasHeadingAncestor(change.range.start.parent) || hasHeadingAncestor(change.range.end.parent)) {
        return true;
    }

    // Robust check across the whole changed range
    const range = editor.model.createRange(change.range.start, change.range.end);
    for (const item of range.getItems()) {
        const baseNode = item.is("$textProxy") ? item.parent : item;
        if (hasHeadingAncestor(baseNode)) return true;
    }

    return false;
}
