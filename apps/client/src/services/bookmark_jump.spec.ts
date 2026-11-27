import { applyTabs } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    consumeBookmark, findDocumentTarget, revealElement, showDocumentTarget
} from "./bookmark_jump.js";
import type { ViewScope } from "./link.js";

const { showAnchorElement, scroller } = vi.hoisted(() => ({
    showAnchorElement: vi.fn(),
    scroller: { scrollTo: vi.fn() }
}));
// happy-dom lays nothing out, so the scroll itself is not observable.
vi.mock("@triliumnext/ckeditor5/src/plugins/block_reference/block_reference_read_only.js", () => ({
    showAnchorElement,
    getScrollContainer: () => scroller
}));

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

    it("scrolls to the anchor of the note's own content before one of an embed above it", () => {
        const container = buildContainer(`<figure class="include-note" data-note-id="other">`
            + `<p><a id="dup"></a>embedded</p></figure><p><a id="dup"></a>own</p>`);
        const scrolled: Element[] = [];
        scrollIntoView.mockImplementation(function (this: Element) {
            scrolled.push(this);
        });

        consumeBookmark(container, { bookmark: "dup" });
        expect(scrolled.map((anchor) => anchor.parentElement?.textContent)).toEqual([ "own" ]);
        scrollIntoView.mockReset();
    });

    it("scrolls to the anchor of an embed when the note's own content has none", () => {
        const container = buildContainer(`<p><a id="own"></a>own</p>`
            + `<figure class="include-note" data-note-id="other">`
            + `<p><a id="only"></a>embedded</p></figure>`);
        const scrolled: Element[] = [];
        scrollIntoView.mockImplementation(function (this: Element) {
            scrolled.push(this);
        });
        const viewScope: ViewScope = { bookmark: "only" };

        consumeBookmark(container, viewScope);
        expect(scrolled.map((anchor) => anchor.parentElement?.textContent)).toEqual([ "embedded" ]);
        expect(viewScope.bookmark).toBeUndefined();
        scrollIntoView.mockReset();
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

describe("showDocumentTarget", () => {
    beforeEach(() => {
        showAnchorElement.mockClear();
        scroller.scrollTo.mockClear();
    });

    it("shows the element whose marking is the target, a heading before a bookmark", async () => {
        const container = buildContainer("<h2 data-toc-heading=\"h1.x\">Near</h2>"
            + "<h2 data-toc-heading=\"h1\">One</h2>"
            + `<p data-toc-bookmark='say "hi"]'>Quoted</p>`);

        await showDocumentTarget(container, { heading: "h1", bookmark: 'say "hi"]' });
        expect(showAnchorElement).toHaveBeenLastCalledWith(container.querySelectorAll("h2")[1]);

        await showDocumentTarget(container, { bookmark: 'say "hi"]' });
        expect(showAnchorElement).toHaveBeenLastCalledWith(container.querySelector("p"));
        expect(scroller.scrollTo).not.toHaveBeenCalled();
    });

    it("finds a bookmark by its marking where the sanitizer removed its id", async () => {
        // What DOMPurify leaves of `<p data-toc-bookmark="title" id="title">` in a browser: the id
        // names a property of `document`. happy-dom drops the whole element instead.
        const container = buildContainer(
            "<p data-toc-bookmark=\"title\">Named like a property of the document</p>");

        await showDocumentTarget(container, { bookmark: "title" });

        expect(showAnchorElement).toHaveBeenCalledExactlyOnceWith(container.querySelector("p"));
    });

    it("scrolls the preview to its top when no element has the target", async () => {
        const container = buildContainer(`<h2 data-toc-heading="h1">One</h2>`);

        await showDocumentTarget(container, { heading: "gone", bookmark: "gone" });

        expect(showAnchorElement).not.toHaveBeenCalled();
        expect(scroller.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0 });
    });

    it("stays where it is for a target that no element has, when asked not to scroll", async () => {
        const container = buildContainer(`<h2 data-toc-heading="h1">One</h2>`);

        await showDocumentTarget(container, { heading: "gone" }, { isFallbackToTop: false });
        await showDocumentTarget(container, { heading: "h1" }, { isFallbackToTop: false });

        expect(scroller.scrollTo).not.toHaveBeenCalled();
        expect(showAnchorElement).toHaveBeenCalledExactlyOnceWith(container.querySelector("h2"));
    });
});

describe("findDocumentTarget", () => {
    it("finds a heading by one of its ids and a bookmark by its whole name, at once", () => {
        const container = buildContainer("<h2 data-toc-heading=\"a b\">Shared</h2>"
            + "<p data-toc-bookmark=\"Intro\">Intro</p>");

        expect(findDocumentTarget(container, { heading: "b" })).toBe(container.querySelector("h2"));
        expect(findDocumentTarget(container, { bookmark: "Intro" }))
            .toBe(container.querySelector("p"));
        expect(findDocumentTarget(container, { bookmark: "Int" })).toBeUndefined();
        expect(findDocumentTarget(container, { heading: "a b" })).toBeUndefined();
        expect(findDocumentTarget(container, {})).toBeUndefined();
    });
});
