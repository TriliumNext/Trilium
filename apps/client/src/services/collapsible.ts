import { revealTab } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";

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

/** Shows `el` wherever it is hidden: opens the `<details>` and shows the tabs that enclose it. */
export function revealElement(el: Element) {
    expandAncestorDetails(el);
    revealTab(el);
}
