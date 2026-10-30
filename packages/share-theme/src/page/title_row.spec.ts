// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import setupTitleRow from "./title_row.js";

describe("setupTitleRow", () => {
    let resize: () => void = () => {};
    const observed: Element[] = [];
    /** The listeners the page puts on the document, removed after each test. */
    const listeners: [ string, EventListenerOrEventListenerObject ][] = [];

    beforeEach(() => {
        vi.stubGlobal("ResizeObserver", class {

            constructor(callback: () => void) {
                resize = callback;
            }

            observe(element: Element) {
                observed.push(element);
            }

        });
        const addEventListener = document.addEventListener.bind(document);
        vi.spyOn(document, "addEventListener").mockImplementation((type, listener, options) => {
            if (listener) {
                listeners.push([ type, listener ]);
            }
            addEventListener(type, listener, options);
        });
    });

    afterEach(() => {
        for (const [ type, listener ] of listeners) {
            document.removeEventListener(type, listener, { capture: true });
        }
        listeners.length = 0;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.body.innerHTML = "";
        document.documentElement.removeAttribute("style");
        observed.length = 0;
    });

    it("shows the floating row once the header's title scrolls under the bar", () => {
        document.body.innerHTML = `
            <div id="top-bar"></div>
            <div id="scrolling-container">
                <div id="title-row" class="floating hide-title">
                    <span class="title-row-title">Title</span>
                </div>
                <header id="note-header"><h1 id="title">Title</h1></header>
            </div>`;
        const topBar = element("top-bar");
        const row = element("title-row");
        const header = element("note-header");
        const title = element("title");
        Object.defineProperty(topBar, "offsetHeight", { value: 46, configurable: true });
        Object.defineProperty(row, "offsetHeight", { value: 48 });
        topBar.getBoundingClientRect = () => DOMRect.fromRect({ y: 0, height: 46 });
        let titleBottom = 160;
        title.getBoundingClientRect = () => DOMRect.fromRect({ y: titleBottom - 40, height: 40 });

        setupTitleRow();
        expect(observed).toEqual([ topBar ]);
        expect(row.classList.contains("hide-title")).toBe(true);
        expect(header.classList.contains("hidden")).toBe(false);
        expect(heights()).toEqual([ "46px", "0px", "94px" ]);

        // A scroll of the note's container, which does not bubble, reaches the row.
        titleBottom = 46;
        element("scrolling-container").dispatchEvent(new Event("scroll"));
        expect(row.classList.contains("hide-title")).toBe(false);
        expect(header.classList.contains("hidden")).toBe(true);
        expect(heights()).toEqual([ "46px", "48px", "94px" ]);

        // The editor's toolbar joins the bar.
        Object.defineProperty(topBar, "offsetHeight", { value: 99 });
        resize();
        expect(heights()).toEqual([ "99px", "48px", "147px" ]);

        // A scroll of the page itself, on a narrow screen.
        titleBottom = 47;
        document.dispatchEvent(new Event("scroll"));
        expect(row.classList.contains("hide-title")).toBe(true);
        expect(heights()).toEqual([ "99px", "0px", "147px" ]);

        title.textContent = "Renamed";
        title.dispatchEvent(new Event("input"));
        expect(row.querySelector(".title-row-title")?.textContent).toBe("Renamed");
    });

    it("leaves a row that holds the title itself in place, measuring the bar", () => {
        document.body.innerHTML = `
            <div id="top-bar"><div id="title-row"><h1 id="title">Manual</h1></div></div>`;
        const topBar = element("top-bar");
        Object.defineProperty(topBar, "offsetHeight", { value: 94 });
        Object.defineProperty(element("title-row"), "offsetHeight", { value: 48 });

        setupTitleRow();
        document.dispatchEvent(new Event("scroll"));
        expect(element("title-row").className).toBe("");
        expect(heights()).toEqual([ "94px", "0px", "94px" ]);
    });

    it("leaves a page without the bar alone", () => {
        document.body.innerHTML = `<div id="title-row"></div>`;
        setupTitleRow();
        expect(observed).toEqual([]);
        expect(heights()).toEqual([ "", "", "" ]);
    });
});

function element(id: string) {
    const found = document.getElementById(id);
    if (!found) {
        throw new Error(`#${id} is missing.`);
    }
    return found;
}

function heights() {
    const { style } = document.documentElement;
    return [ "--top-bar-height", "--title-row-height", "--top-bar-scrolled-height" ]
        .map((name) => style.getPropertyValue(name));
}
