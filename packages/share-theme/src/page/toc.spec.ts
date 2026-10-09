// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import setupToC from "./toc.js";

describe("setupToC", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("marks the entry of the last heading scrolled past, whatever the heading levels", () => {
        const container = renderPage([ [ 1, "intro", 100 ], [ 2, "details", 500 ], [ 3, "more", 900 ] ]);

        expect(activeEntry()).toBe("intro");

        container.scrollTop = 520;
        container.dispatchEvent(new Event("scroll"));
        expect(activeEntry()).toBe("details");

        container.scrollTop = 900;
        container.dispatchEvent(new Event("scroll"));
        expect(activeEntry()).toBe("more");
    });

    it("scrolls to the heading of a clicked entry, also when its ID starts with a digit", () => {
        renderPage([ [ 2, "2024-plans", 100 ], [ 2, "later", 500 ] ]);
        const scrollIntoView = vi.fn();
        const heading = document.getElementById("2024-plans");
        if (!heading) {
            throw new Error("The heading is missing.");
        }
        heading.scrollIntoView = scrollIntoView;

        document.querySelector<HTMLElement>(`#toc a[href="#2024-plans"]`)?.click();

        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
    });

    it("leaves an entry without a heading to the browser, and a page without one alone", () => {
        expect(() => setupToC()).not.toThrow();

        document.body.innerHTML = `
            <div id="right-pane">
                <ul id="toc"><li><a href="#missing">Missing</a></li><li><a>No link</a></li></ul>
            </div>
        `;
        setupToC();

        for (const link of document.querySelectorAll("#toc a")) {
            const click = new MouseEvent("click", { bubbles: true, cancelable: true });
            link.dispatchEvent(click);
            expect(click.defaultPrevented).toBe(false);
        }
        expect(activeEntry()).toBeUndefined();
    });
});

/**
 * Renders the content and the table of contents of a page with headings given as level, slug and
 * distance from the top, sets the table of contents up and returns the scrolling container.
 */
function renderPage(headings: [ level: number, slug: string, offsetTop: number ][]) {
    document.body.innerHTML = `
        <div id="right-pane">
            <div id="content">
                ${headings.map(([ level, slug ]) => `<h${level}>${slug}`
                    + `<a id="${slug}" class="toc-anchor" href="#${slug}">#</a></h${level}>`).join("")}
            </div>
            <ul id="toc">
                ${headings.map(([ , slug ]) => `<li><a href="#${slug}">${slug}</a></li>`).join("")}
            </ul>
        </div>
    `;
    for (const [ , slug, offsetTop ] of headings) {
        const heading = document.getElementById(slug)?.parentElement;
        if (heading) {
            Object.defineProperty(heading, "offsetTop", { value: offsetTop });
        }
    }

    setupToC();
    const container = document.getElementById("right-pane");
    if (!container) {
        throw new Error("The container is missing.");
    }
    return container;
}

function activeEntry() {
    return document.querySelector("#toc a.active")?.textContent;
}
