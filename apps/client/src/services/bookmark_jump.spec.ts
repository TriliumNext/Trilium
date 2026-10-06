import { beforeEach, describe, expect, it, vi } from "vitest";

import { consumeBookmark } from "./bookmark_jump.js";
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
