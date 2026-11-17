import { applyTabs } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { consumeBookmark, revealElement } from "./bookmark_jump.js";
import type { ViewScope } from "./link.js";

function buildContainer(html: string) {
    const container = document.createElement("div");
    container.innerHTML = html;
    return container;
}

describe("consumeBookmark", () => {
    const scrollIntoView = vi.fn();

    beforeEach(() => {
        scrollIntoView.mockClear();
        Element.prototype.scrollIntoView = scrollIntoView;
    });

    it("expands collapsed <details> ancestors, scrolls to the target and consumes the bookmark", () => {
        const container = buildContainer(
            `<details><summary>outer</summary>` +
                `<details><summary>inner</summary><p><a id="deep"></a>target</p></details>` +
            `</details>`
        );
        const viewScope: ViewScope = { bookmark: "deep" };

        consumeBookmark(container, viewScope);

        for (const details of container.querySelectorAll("details")) {
            expect(details.open).toBe(true);
        }
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
        expect(viewScope.bookmark).toBeUndefined();
    });

    it("shows the tab that holds the target", () => {
        const container = buildContainer(
            `<div class="trilium-tabs">` +
                `<section class="trilium-tab"><p class="trilium-tab-title">A</p><div class="trilium-tab-panel"></div></section>` +
                `<section class="trilium-tab"><p class="trilium-tab-title">B</p><div class="trilium-tab-panel"><p><a id="in-tab"></a>target</p></div></section>` +
            `</div>`
        );
        applyTabs(container, { placeholder: "", scrollLabels: { start: "", end: "" } });

        consumeBookmark(container, { bookmark: "in-tab" });

        expect(container.querySelector(".trilium-tab-title--active")?.textContent).toBe("B");
    });

    it("leaves the bookmark unconsumed when the content container is not rendered yet", () => {
        const viewScope: ViewScope = { bookmark: "deep" };

        consumeBookmark(null, viewScope);
        consumeBookmark(undefined, viewScope);

        expect(viewScope.bookmark).toBe("deep");
        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("finds ids that would break a CSS selector, and consumes dangling bookmarks without scrolling", () => {
        const weirdId = `we"ird ]id`;
        const container = buildContainer("<p>anchor here</p>");
        const anchor = container.querySelector("p");
        anchor?.setAttribute("id", weirdId);
        const weirdScope: ViewScope = { bookmark: weirdId };

        consumeBookmark(container, weirdScope);

        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(weirdScope.bookmark).toBeUndefined();

        scrollIntoView.mockClear();
        const danglingScope: ViewScope = { bookmark: "missing-anchor" };

        consumeBookmark(buildContainer("<p>no anchor here</p>"), danglingScope);

        expect(scrollIntoView).not.toHaveBeenCalled();
        expect(danglingScope.bookmark).toBeUndefined();
    });

    it("no-ops without a bookmark or view scope", () => {
        const viewScope: ViewScope = {};

        consumeBookmark(buildContainer("<p><a id='deep'></a></p>"), viewScope);
        consumeBookmark(buildContainer("<p><a id='deep'></a></p>"), undefined);

        expect(scrollIntoView).not.toHaveBeenCalled();
        expect(viewScope.bookmark).toBeUndefined();
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
        applyTabs(container, { placeholder: "", scrollLabels: { start: "", end: "" } });
        const match = container.querySelector(".m");
        expect(match).not.toBeNull();

        revealElement(match as Element);

        expect(container.querySelector("details")?.open).toBe(true);
        expect(container.querySelector(".trilium-tab-title--active")?.textContent).toBe("B");
    });
});
