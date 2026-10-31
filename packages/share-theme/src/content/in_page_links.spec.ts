// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import setupInPageLinks from "./in_page_links.js";

const mocks = vi.hoisted(() => ({
    showAnchor: vi.fn(),
    showBlockReference: vi.fn()
}));
vi.mock("@triliumnext/ckeditor5/src/plugins/block_reference/block_reference_read_only.js", () => mocks);

describe("setupInPageLinks", () => {
    beforeEach(() => {
        history.replaceState(null, "", "/share/page");
        document.body.innerHTML = "<div id=\"content\">"
            + "<h2 data-trilium-block-id=\"h\">Intro</h2>"
            + "<p><a id=\"top\"></a><a id=\"café\"></a><a id=\"%E0%A4%A\"></a>text</p>"
            + "</div>";
        setupInPageLinks();
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = "";
    });

    /** Clicks a link to `href` in the content, and returns whether the click was taken. */
    function click(href: string, init: MouseEventInit = {}) {
        const link = document.createElement("a");
        link.setAttribute("href", href);
        document.getElementById("content")?.append(link);
        // Read once the content has seen the click, then kept from happy-dom, which follows a
        // link that no listener took.
        let isTaken = false;
        document.addEventListener("click", (event) => {
            isTaken = event.defaultPrevented;
            event.preventDefault();
        }, { once: true });
        link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
        return isTaken;
    }

    it("scrolls to blocks of the page and flashes them, with the address of the link", async () => {
        expect(click("./page?block=h")).toBe(true);
        await vi.waitFor(() => expect(mocks.showBlockReference)
            .toHaveBeenCalledExactlyOnceWith(document.body, "h"));
        expect(location.search).toBe("?block=h");

        // A fragment link keeps `block` from the address, and goes to its anchor all the same.
        expect(click("#top")).toBe(true);
        await vi.waitFor(() => expect(mocks.showAnchor)
            .toHaveBeenLastCalledWith(document.body, "top"));
        expect(location.href).toBe("http://localhost:3000/share/page?block=h#top");
        const entries = history.length;
        mocks.showAnchor.mockClear();
        expect(click("#top")).toBe(true);
        await vi.waitFor(() => expect(mocks.showAnchor).toHaveBeenCalledOnce());
        expect(history.length).toBe(entries);

        expect(click("#caf%C3%A9")).toBe(true);
        await vi.waitFor(() => expect(mocks.showAnchor)
            .toHaveBeenLastCalledWith(document.body, "café"));
        expect(click("#%E0%A4%A")).toBe(true);
        await vi.waitFor(() => expect(mocks.showAnchor)
            .toHaveBeenLastCalledWith(document.body, "%E0%A4%A"));
    });

    it("leaves other links, modified clicks and missing targets to the browser", () => {
        expect([
            click("./other?block=h"),
            click("https://example.com/share/page?block=h"),
            click("./page?block=h:gone"),
            click("./page?x=1"),
            click("#missing"),
            click("./page?block=h", { ctrlKey: true }),
            click("./page?block=h", { button: 1 })
        ]).toEqual([ false, false, false, false, false, false, false ]);

        // A click outside a link, and one that a script of the page took already.
        document.querySelector("h2")?.click();
        const link = document.createElement("a");
        link.href = "./page?block=h";
        document.getElementById("content")?.append(link);
        link.addEventListener("click", (event) => event.preventDefault(), { once: true });
        link.click();
        expect(location.search).toBe("");
        expect(mocks.showBlockReference).not.toHaveBeenCalled();
    });

    it("does nothing on a page without content", () => {
        document.body.innerHTML = "";
        expect(() => setupInPageLinks()).not.toThrow();
    });
});
