import { revealTab } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";

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

/**
 * Shows `el` wherever it is hidden: opens the `<details>` inside `boundary` and shows the tabs that
 * enclose it. A text editor around `boundary` reveals its own blocks, as their open state is saved.
 */
export function revealElement(el: Element, boundary?: Element) {
    expandAncestorDetails(el, boundary);
    revealTab(el);
}
