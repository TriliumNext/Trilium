/**
 * Open every collapsed `<details>` ancestor of `el` inside `boundary` so content inside it becomes
 * visible.
 */
export function expandAncestorDetails(el: Element, boundary?: Element) {
    let details = el.closest("details");
    while (details && (!boundary || boundary.contains(details))) {
        if (!details.open) {
            details.open = true;
        }
        details = details.parentElement?.closest("details") ?? null;
    }
}
