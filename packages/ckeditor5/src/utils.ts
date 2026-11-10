import {
    type DifferItemAttribute, DomEventObserver, type Editor, type ModelDocumentFragment,
    type ModelElement, type ModelNode, type ViewDocumentDomEventData
} from "ckeditor5";

/**
 * Fires `contextmenu` on the view document for a right-click in the editable. The plugins that
 * listen to it share this class, as each observer class fires the event once.
 */
export class ContextMenuObserver extends DomEventObserver<"contextmenu"> {
    get domEventType() {
        return "contextmenu" as const;
    }

    onDomEvent(domEvent: MouseEvent) {
        this.fire("contextmenu", domEvent);
    }
}

/** The `contextmenu` event of {@link ContextMenuObserver}. */
export type ViewDocumentContextMenuEvent = {
    name: "contextmenu";
    args: [data: ViewDocumentDomEventData<MouseEvent>];
};

export function escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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
