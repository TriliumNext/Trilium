/** The paragraph alignments that `lists.css` moves a list item for. */
export const LIST_ITEM_ALIGNMENTS = [ "left", "center", "right" ] as const;

export type ListItemAlignmentValue = typeof LIST_ITEM_ALIGNMENTS[number];

/** The class `lists.css` styles on a list item whose first paragraph has `alignment`. */
export function getListItemAlignmentClass(alignment: ListItemAlignmentValue) {
    return `trilium-list-item-aligned-${alignment}`;
}

export function isListItemAlignment(value: unknown): value is ListItemAlignmentValue {
    return (LIST_ITEM_ALIGNMENTS as readonly unknown[]).includes(value);
}

/**
 * Puts the alignment class on each list item in `container` whose first paragraph is aligned,
 * for saved content shown outside the editor. The `ListItemAlignment` plugin does the same in
 * the editor.
 */
export function applyListItemAlignment(container: ParentNode) {
    for (const item of container.querySelectorAll("li")) {
        const alignment = item.querySelector<HTMLElement>(":scope > p")?.style.textAlign;
        for (const value of LIST_ITEM_ALIGNMENTS) {
            item.classList.toggle(getListItemAlignmentClass(value), value === alignment);
        }
    }
}
