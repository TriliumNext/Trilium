import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../components/app_context.js";
import froca from "../services/froca.js";
import linkService from "../services/link.js";
import server from "../services/server.js";
import QuickSearchWidget from "./quick_search.js";

describe("QuickSearchWidget", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("moves focus from the search box to the first result on ArrowDown", async () => {
        const widget = await renderAndSearch();
        const $input = widget.$widget.find(".search-string");
        const $items = widget.$widget.find(".dropdown-menu .dropdown-item");

        expect(pressArrowDown($input[0])).toBe(true);
        expect(document.activeElement).toBe($items[0]);
    });

    it("leaves ArrowDown to the search box while the popup is closed or a modifier is held", async () => {
        const widget = await renderAndSearch();
        const $input = widget.$widget.find(".search-string");
        const $firstItem = widget.$widget.find(".dropdown-menu .dropdown-item").first();

        expect(pressArrowDown($input[0], { ctrlKey: true })).toBe(false);
        expect(pressArrowDown($input[0], { shiftKey: true })).toBe(false);
        expect(document.activeElement).not.toBe($firstItem[0]);

        widget.$widget.find(".dropdown-menu").removeClass("show");
        expect(pressArrowDown($input[0])).toBe(false);
        expect(document.activeElement).not.toBe($firstItem[0]);
    });

    it("leaves ArrowDown alone when the popup holds no result to focus", async () => {
        const widget = await renderAndSearch(0);

        expect(widget.$widget.find(".dropdown-menu .dropdown-item.disabled").length).toBe(1);
        expect(pressArrowDown(widget.$widget.find(".search-string")[0])).toBe(false);
    });

    it("keeps the full search link pinned below the scrolling results as more load", async () => {
        const widget = renderWidget();
        mockResults(30);

        await widget.search();

        const $menu = widget.$widget.find(".dropdown-menu");
        const $results = $menu.find(".quick-search-results");
        const $footer = $menu.find(".quick-search-footer");

        // The results scroll on their own, so the footer stays visible at the bottom of the menu.
        expect($results.children(".dropdown-item").length).toBe(15);
        expect($results.find(".show-in-full-search").length).toBe(0);
        expect($menu.children().last().is($footer)).toBe(true);
        expect($footer.hasClass("hidden-ext")).toBe(false);
        expect($footer.find(".show-in-full-search").length).toBe(1);

        // happy-dom reports zero scroll metrics, which reads as "scrolled to the bottom".
        $results.trigger("scroll");
        await vi.waitFor(() => expect($results.children(".dropdown-item").length).toBe(25));

        expect($menu.children().last().is($footer)).toBe(true);
        expect($footer.find(".show-in-full-search").length).toBe(1);
    });

    it("hides the full search link while searching and when nothing matches", async () => {
        const widget = renderWidget();
        mockResults(3);
        await widget.search();

        const $footer = widget.$widget.find(".quick-search-footer");
        expect($footer.hasClass("hidden-ext")).toBe(false);

        mockResults(0);
        const search = widget.search();
        expect($footer.hasClass("hidden-ext")).toBe(true);

        await search;
        expect($footer.hasClass("hidden-ext")).toBe(true);
        expect(widget.$widget.find(".quick-search-results .dropdown-item.disabled").length).toBe(1);
    });

    it("runs the full search from the pinned link, by click and by Enter", async () => {
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        const widget = renderWidget();
        mockResults(3);
        await widget.search();

        const $link = widget.$widget.find(".show-in-full-search");
        $link.trigger("click");
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "hello" });

        triggerCommand.mockClear();
        $link[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "hello" });
    });

    it("sends slash-bearing text as a query parameter", async () => {
        const get = vi.spyOn(server, "get").mockResolvedValue({
            searchResultNoteIds: [],
            searchResults: [],
            error: ""
        } as never);
        const widget = renderWidget();
        widget.$widget.find(".search-string").val("中/英");

        await widget.search();

        expect(get).toHaveBeenCalledWith(
            `quick-search?searchString=${encodeURIComponent("中/英")}`
        );
    });

    it("puts the results of a search the server did not highlight in the same scroller", async () => {
        const widget = renderWidget();
        vi.spyOn(server, "get").mockResolvedValue({
            searchResultNoteIds: [ "note0", "note1" ],
            error: ""
        } as never);
        vi.spyOn(froca, "getNotes").mockResolvedValue([ { noteId: "note0" }, { noteId: "note1" } ] as never);
        vi.spyOn(linkService, "createLink").mockImplementation(async (notePath) => $("<span>").text(String(notePath)));

        await widget.search();

        const $menu = widget.$widget.find(".dropdown-menu");
        expect($menu.find(".quick-search-results > .dropdown-item").length).toBe(2);
        expect($menu.children().last().hasClass("quick-search-footer")).toBe(true);
    });
});

/** Returns whether the widget claimed the key, which is what keeps the caret from moving. */
function pressArrowDown(element: HTMLElement, modifiers: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
        key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true, ...modifiers
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
}

async function renderAndSearch(resultCount = 3) {
    const searchResults = Array.from({ length: resultCount }, (_, index) => ({
        notePath: `note${index}`,
        noteTitle: `Note ${index}`,
        notePathTitle: `Note ${index}`,
        highlightedNotePathTitle: `Note ${index}`,
        icon: "bx bx-note"
    }));

    vi.spyOn(server, "get").mockResolvedValue({
        searchResultNoteIds: searchResults.map((result) => result.notePath),
        searchResults,
        error: ""
    } as never);

    const widget = new QuickSearchWidget();
    widget.render();
    // Focus only moves within the document, and `show` is the class Bootstrap opens the menu with.
    widget.$widget.appendTo(document.body);
    widget.$widget.find(".search-string").val("hello");
    await widget.search();
    widget.$widget.find(".dropdown-menu").addClass("show");

    return widget;
}

function renderWidget() {
    const widget = new QuickSearchWidget();
    widget.render();
    widget.$widget.find(".search-string").val("hello");
    return widget;
}

function mockResults(count: number) {
    const searchResults = Array.from({ length: count }, (_, index) => ({
        notePath: `note${index}`,
        noteTitle: `Note ${index}`,
        notePathTitle: `Note ${index}`,
        highlightedNotePathTitle: `Note ${index}`,
        icon: "bx bx-note"
    }));

    vi.spyOn(server, "get").mockResolvedValue({
        searchResultNoteIds: searchResults.map((result) => result.notePath),
        searchResults,
        highlightedTokens: ["hello"],
        error: ""
    } as never);
}
