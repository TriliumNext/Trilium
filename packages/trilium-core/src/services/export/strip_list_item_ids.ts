/**
 * Removes the `data-list-item-id` attribute CKEditor's list feature stamps on every `<li>`. It is
 * that plugin's stable per-item identifier for round-tripping the flat list model — regenerated on
 * load and meaningless outside the editor — so it is dropped from exported content. This is the
 * server-side equivalent of CKEditor's `skipListItemIds` downcast option, which cannot be used here
 * because exports serialize already-stored HTML rather than a live editor.
 */
export function stripListItemIds(content: string): string {
    return content.replace(/ data-list-item-id="[^"]*"/g, "");
}
