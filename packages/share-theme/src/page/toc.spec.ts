// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import setupToC from "./toc.js";

describe("setupToC", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
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

    it("scrolls to the heading of a clicked entry, whose ID can start with a digit or hold a %", () => {
        renderPage([ [ 2, "2024-plans", 100 ], [ 2, "part%20one", 500 ] ]);

        for (const [ id, href ] of [ [ "2024-plans", "#2024-plans" ], [ "part%20one", "#part%2520one" ] ]) {
            const scrollIntoView = vi.fn();
            const heading = document.getElementById(id);
            const entry = document.querySelector<HTMLElement>(`#toc a[href="${href}"]`);
            if (!heading || !entry) {
                throw new Error(`The heading or the entry of ${id} is missing.`);
            }
            heading.scrollIntoView = scrollIntoView;

            entry.click();

            expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
        }
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

    it("copies the address of a heading's section, showing a check mark for a moment", async () => {
        vi.useFakeTimers();
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        renderPage([ [ 2, "intro", 100 ] ]);
        const link = headingLink("intro");
        const icon = () => link.querySelector(".tn-icon")?.className;

        link.click();
        await vi.waitFor(() => expect(icon()).toBe("tn-icon bx bx-check"));
        expect(writeText).toHaveBeenCalledWith(new URL("#intro", location.href).href);
        expect(link.classList.contains("copied")).toBe(true);

        vi.advanceTimersByTime(1000);
        link.click();
        await Promise.resolve();
        vi.advanceTimersByTime(1000);
        expect(icon()).toBe("tn-icon bx bx-check");

        vi.advanceTimersByTime(500);
        expect(icon()).toBe("tn-icon bx bx-link");
        expect(link.classList.contains("copied")).toBe(false);
    });

    it("puts the section's address in the location bar instead of jumping to it", () => {
        vi.stubGlobal("navigator", {});
        renderPage([ [ 2, "intro", 100 ], [ 2, "later", 500 ] ]);
        history.replaceState(null, "", "#later");
        const historyLength = history.length;
        const scrollIntoView = vi.fn();
        const heading = document.getElementById("intro");
        if (!heading) {
            throw new Error("The heading is missing.");
        }
        heading.scrollIntoView = scrollIntoView;

        const click = new MouseEvent("click", { bubbles: true, cancelable: true });
        headingLink("intro").dispatchEvent(click);

        expect(click.defaultPrevented).toBe(true);
        expect(location.hash).toBe("#intro");
        expect(history.length).toBe(historyLength);
        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("leaves a click with a modifier key or another button to the browser", () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        renderPage([ [ 2, "intro", 100 ] ]);

        for (const init of [ { ctrlKey: true }, { metaKey: true }, { shiftKey: true },
            { altKey: true }, { button: 1 } ]) {
            const click = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
            headingLink("intro").dispatchEvent(click);
            expect(click.defaultPrevented).toBe(false);
        }
        expect(writeText).not.toHaveBeenCalled();
    });

    it("shows no check mark when the address cannot be copied", async () => {
        const writeText = vi.fn().mockRejectedValue(new Error("denied"));
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        renderPage([ [ 2, "intro", 100 ] ]);
        const link = headingLink("intro");

        link.click();
        await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
        await Promise.resolve();
        expect(link.classList.contains("copied")).toBe(false);
    });

    it("sets the heading links up on a page without a table of contents", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        document.body.innerHTML = `<div id="content"><h2 id="only">Only${anchor("only")}</h2></div>`;
        setupToC();

        const link = headingLink("only");
        link.querySelector(".tn-icon")?.remove();
        link.click();
        await vi.waitFor(() => expect(link.classList.contains("copied")).toBe(true));
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
                ${headings.map(([ level, slug ]) => `<h${level} id="${slug}">${slug}${anchor(slug)}`
                    + `</h${level}>`).join("")}
            </div>
            <ul id="toc">
                ${headings.map(([ , slug ]) => `<li><a href="#${encodeURIComponent(slug)}">${slug}</a></li>`).join("")}
            </ul>
        </div>
    `;
    for (const [ , slug, offsetTop ] of headings) {
        const heading = document.getElementById(slug);
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

/** The link core's `preparePageContent()` gives a heading. */
function anchor(slug: string) {
    return `<a class="toc-anchor" href="#${encodeURIComponent(slug)}" aria-label="Link to This Section">`
        + `<span class="tn-icon bx bx-link" aria-hidden="true"></span></a>`;
}

function headingLink(slug: string) {
    const link = document.querySelector<HTMLAnchorElement>(`#content a.toc-anchor[href="#${encodeURIComponent(slug)}"]`);
    if (!link) {
        throw new Error(`The link of ${slug} is missing.`);
    }
    return link;
}
