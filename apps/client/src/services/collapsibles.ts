/**
 * Opens every closed `<details>` ancestor of `el` (CKEditor collapsibles are native
 * `<details class="trilium-collapsible">`; raw imported `<details>` too). Returns true if
 * anything was expanded.
 */
export function expandCollapsedAncestors(el: Element): boolean {
    let expanded = false;
    for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) {
        if (!d.open) {
            d.open = true;
            expanded = true;
        }
    }
    return expanded;
}
