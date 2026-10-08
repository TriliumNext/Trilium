import { applyTabs } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";
import { describe, expect, it } from "vitest";

import { expandAncestorDetails, revealElement } from "./collapsible.js";

/** Build a DOM tree from an HTML string and return the element matching `selector`. */
function mount(html: string, selector: string): HTMLElement {
    const container = document.createElement("div");
    container.innerHTML = html;
    const el = container.querySelector<HTMLElement>(selector);
    if (!el) {
        throw new Error(`No element matched ${selector}`);
    }
    return el;
}

describe("expandAncestorDetails", () => {
    it("opens a single collapsed ancestor", () => {
        const match = mount(`<details><summary>t</summary><span class="m">hit</span></details>`, ".m");
        expandAncestorDetails(match);
        expect(match.closest("details")?.open).toBe(true);
    });

    it("opens every level of nested collapsed ancestors", () => {
        const match = mount(`
            <details class="outer"><summary>o</summary>
                <details class="inner"><summary>i</summary><span class="m">hit</span></details>
            </details>`, ".m");
        expandAncestorDetails(match);
        const outer = match.closest("details.outer");
        const inner = match.closest("details.inner");
        expect(outer instanceof HTMLDetailsElement && outer.open).toBe(true);
        expect(inner instanceof HTMLDetailsElement && inner.open).toBe(true);
    });

    it("leaves an already-open ancestor open", () => {
        const match = mount(`<details open><summary>t</summary><span class="m">hit</span></details>`, ".m");
        expandAncestorDetails(match);
        expect(match.closest("details")?.open).toBe(true);
    });

    it("is a no-op when there is no <details> ancestor", () => {
        const match = mount(`<p><span class="m">hit</span></p>`, ".m");
        expect(() => expandAncestorDetails(match)).not.toThrow();
    });

    it("opens only the closed ancestors in a mixed open/closed chain", () => {
        const match = mount(`
            <details class="outer"><summary>o</summary>
                <details class="middle" open><summary>m</summary>
                    <details class="inner"><summary>i</summary><span class="m">hit</span></details>
                </details>
            </details>`, ".m");
        expandAncestorDetails(match);
        for (const cls of [ "outer", "middle", "inner" ]) {
            const details = match.closest(`details.${cls}`);
            expect(details instanceof HTMLDetailsElement && details.open).toBe(true);
        }
    });

    it("expands the element itself when it is a closed <details>", () => {
        const match = mount(`<details class="outer"><summary>o</summary><details class="m"><summary>i</summary>x</details></details>`, ".m");
        expandAncestorDetails(match);
        const self = match.closest("details.m");
        const outer = match.closest("details.outer");
        expect(self instanceof HTMLDetailsElement && self.open).toBe(true);
        expect(outer instanceof HTMLDetailsElement && outer.open).toBe(true);
    });
});

describe("revealElement", () => {
    it("opens the collapsed blocks and shows the tabs around an element", () => {
        const container = document.createElement("div");
        container.innerHTML =
            `<div class="trilium-tabs">` +
                `<section class="trilium-tab"><p class="trilium-tab-title">A</p><div class="trilium-tab-panel"></div></section>` +
                `<section class="trilium-tab"><p class="trilium-tab-title">B</p><div class="trilium-tab-panel">` +
                    `<details><summary>s</summary><span class="m">hit</span></details>` +
                `</div></section>` +
            `</div>`;
        applyTabs(container, { placeholder: "" });
        const match = container.querySelector(".m");
        expect(match).not.toBeNull();

        revealElement(match as Element);

        expect(container.querySelector("details")?.open).toBe(true);
        expect(container.querySelector(".trilium-tab--active > .trilium-tab-title")?.textContent).toBe("B");
    });
});
