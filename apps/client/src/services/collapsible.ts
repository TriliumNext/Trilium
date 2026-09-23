/** Open every collapsed `<details>` ancestor of `el` so content inside it becomes visible. */
export function expandAncestorDetails(el: Element) {
    let details = el.closest("details");
    while (details) {
        if (!details.open) {
            details.open = true;
        }
        details = details.parentElement?.closest("details") ?? null;
    }
}
