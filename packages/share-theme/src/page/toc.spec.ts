// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import setupToC from "./toc.js";

describe("setupToC", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        document.documentElement.removeAttribute("style");
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        history.replaceState(null, "", location.pathname);
    });

    it("marks the entry of the last heading scrolled past, whatever the heading levels", () => {
        const scrollTo = renderPage([ [ 1, "intro", 100 ], [ 2, "details", 500 ], [ 3, "more", 900 ] ]);

        expect(activeEntry()).toBe("intro");

        scrollTo(520);
        expect(activeEntry()).toBe("details");

        scrollTo(900);
        expect(activeEntry()).toBe("more");
    });

    it("counts a heading as scrolled past once it is under the sticky top bar", () => {
        const scrollTo = renderPage([ [ 2, "intro", 100 ], [ 2, "details", 500 ] ], 90);

        scrollTo(340);
        expect(activeEntry()).toBe("intro");
        scrollTo(380);
        expect(activeEntry()).toBe("details");
    });

    it("scrolls the ToC pane to center the marked entry once it leaves the pane", () => {
        // A pane 100px tall whose entries are 20px tall and 40px apart.
        const headings = Array.from({ length: 10 }, (_, i): [ number, string, number ] => [ 2, `h${i}`, 100 + i * 400 ]);
        const scrollTo = renderPage(headings, 0, (pane) => {
            Object.defineProperty(pane, "clientHeight", { value: 100 });
            pane.getBoundingClientRect = () => DOMRect.fromRect({ y: 0, height: 100 });
            for (const [ index, entry ] of [ ...pane.querySelectorAll("a") ].entries()) {
                entry.getBoundingClientRect = () => DOMRect.fromRect({ y: index * 40 - pane.scrollTop, height: 20 });
            }
        });
        const tocPane = document.getElementById("toc-pane");
        if (!tocPane) {
            throw new Error("The ToC pane is missing.");
        }

        // h1 and h2 are inside the pane, so it does not move.
        scrollTo(520);
        scrollTo(920);
        expect(activeEntry()).toBe("h2");
        expect(tocPane.scrollTop).toBe(0);

        // h7 is at 280px, below the pane: it moves to the middle, 40px from the top.
        scrollTo(2920);
        expect(activeEntry()).toBe("h7");
        expect(tocPane.scrollTop).toBe(240);

        // Scrolling back up to h1, at 40px - 240px, brings the pane back with it.
        scrollTo(520);
        expect(activeEntry()).toBe("h1");
        expect(tocPane.scrollTop).toBe(0);
    });

    it("keeps the copy in the navigation pane in step, and closes the pane on a click", () => {
        const scrollTo = renderPage([ [ 2, "intro", 100 ], [ 2, "details", 500 ] ]);
        const treeEntry = (selector: string) =>
            document.querySelector<HTMLAnchorElement>(`.tree-toc a${selector}`);

        expect(treeEntry(".active")?.textContent).toBe("intro");
        scrollTo(520);
        expect(treeEntry(".active")?.textContent).toBe("details");
        expect(activeEntry()).toBe("details");

        const heading = document.getElementById("intro");
        const entry = treeEntry('[href="#intro"]');
        if (!heading || !entry) {
            throw new Error("The heading or its entry in the navigation pane is missing.");
        }
        heading.scrollIntoView = vi.fn();
        document.body.classList.add("menu-open");

        entry.click();

        expect(heading.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
        expect(document.body.classList.contains("menu-open")).toBe(false);
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
            <div>
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

    it("leaves the block of a block link out of the section's address", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        renderPage([ [ 2, "intro", 100 ] ]);
        const expected = new URL(`${location.pathname}?lang=en#intro`, location.href).href;
        history.replaceState(null, "", "?block=a:b&lang=en");

        headingLink("intro").click();

        expect(location.href).toBe(expected);
        await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(expected));
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
 * distance from the top of the page, sets the table of contents up and returns a function that
 * scrolls the page.
 */
function renderPage(
    headings: [ level: number, slug: string, offsetTop: number ][],
    topBarHeight = 0,
    prepareTocPane?: (pane: HTMLElement) => void
) {
    const link = (slug: string) => `<a href="#${encodeURIComponent(slug)}">${slug}</a>`;
    document.body.innerHTML = `
        <div>
            <div id="content">
                ${headings.map(([ level, slug ]) => `<h${level} id="${slug}">${slug}${anchor(slug)}`
                    + `</h${level}>`).join("")}
            </div>
            <div id="toc-pane">
                <ul id="toc">
                    ${headings.map(([ , slug ]) => `<li>${link(slug)}</li>`).join("")}
                </ul>
            </div>
            <nav class="tree-toc">
                ${headings.map(([ , slug ]) => `<div>${link(slug)}</div>`).join("")}
            </nav>
        </div>
    `;
    if (topBarHeight) {
        document.documentElement.style
            .setProperty("--top-bar-scrolled-height", `${topBarHeight}px`);
    }
    let scrolled = 0;
    for (const [ , slug, offsetTop ] of headings) {
        const heading = document.getElementById(slug);
        if (heading) {
            heading.getBoundingClientRect = () => DOMRect.fromRect({ y: offsetTop - scrolled });
        }
    }

    const tocPane = document.getElementById("toc-pane");
    if (prepareTocPane && tocPane) {
        prepareTocPane(tocPane);
    }

    setupToC();
    return (y: number) => {
        scrolled = y;
        // The note's own container scrolls, and its scroll does not bubble.
        document.getElementById("content")?.dispatchEvent(new Event("scroll"));
    };
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
