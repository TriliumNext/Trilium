// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import setupLayout from "./layout.js";

const NOTE_SCROLL_KEY = "share-note-scroll";

describe("setupLayout", () => {
    /** The listeners the page puts on the window, removed after each test. */
    const listeners: [ string, EventListenerOrEventListenerObject ][] = [];

    afterEach(() => {
        for (const [ type, listener ] of listeners) {
            window.removeEventListener(type, listener);
        }
        listeners.length = 0;
        vi.restoreAllMocks();
        sessionStorage.clear();
        document.body.innerHTML = "";
        document.body.className = "";
    });

    it("keeps the note's place per page across a reload and a return, not a new visit", () => {
        recordListeners();
        sessionStorage.setItem(NOTE_SCROLL_KEY,
            JSON.stringify({ "/share/other": 40, "/share/page": "x" }));
        const container = renderScrollingPage("navigate");
        expect(container.scrollTop).toBe(0);

        container.scrollTop = 320;
        window.dispatchEvent(new Event("pagehide"));
        expect(readPlaces()).toStrictEqual({ "/share/other": 40, "/share/page": 320 });

        for (const type of [ "reload", "back_forward" ]) {
            expect(renderScrollingPage(type).scrollTop).toBe(320);
        }
        sessionStorage.setItem(NOTE_SCROLL_KEY, JSON.stringify({ "/share/other": 40 }));
        expect(renderScrollingPage("reload").scrollTop).toBe(0);
    });

    it("keeps the places of the last fifty pages, and starts over from unreadable storage", () => {
        recordListeners();
        const many = Object.fromEntries(
            Array.from({ length: 50 }, (_, i) => [ `/share/n${i}`, i ]));
        sessionStorage.setItem(NOTE_SCROLL_KEY, JSON.stringify(many));
        renderScrollingPage("navigate").scrollTop = 7;
        window.dispatchEvent(new Event("pagehide"));
        const places = readPlaces();
        expect(Object.keys(places)).toHaveLength(50);
        expect(places["/share/n0"]).toBeUndefined();
        expect(places["/share/page"]).toBe(7);

        sessionStorage.removeItem(NOTE_SCROLL_KEY);
        expect(renderScrollingPage("reload").scrollTop).toBe(0);
        for (const stored of [ "{ not json", "[ 1 ]", "null" ]) {
            sessionStorage.setItem(NOTE_SCROLL_KEY, stored);
            expect(renderScrollingPage("reload").scrollTop).toBe(0);
        }

        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("quota");
        });
        expect(() => window.dispatchEvent(new Event("pagehide"))).not.toThrow();
    });

    it("opens a page the browser cannot tell the navigation of at the top", () => {
        recordListeners();
        sessionStorage.setItem(NOTE_SCROLL_KEY, JSON.stringify({ "/share/page": 90 }));
        vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
        document.body.innerHTML = `<div id="scrolling-container"></div>`;
        setupLayout();
        expect(document.getElementById("scrolling-container")?.scrollTop).toBe(0);
    });

    function recordListeners() {
        const addEventListener = window.addEventListener.bind(window);
        vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
            if (listener) {
                listeners.push([ type, listener ]);
            }
            addEventListener(type, listener, options);
        });
        vi.spyOn(window, "location", "get")
            .mockReturnValue(new URL("https://example.com/share/page") as unknown as Location);
    }

    /** Renders a page whose note scrolls in its container, reached by a navigation of `type`. */
    function renderScrollingPage(type: string) {
        vi.spyOn(performance, "getEntriesByType")
            .mockReturnValue([ { type } as PerformanceNavigationTiming ]);
        document.body.innerHTML = `<div id="scrolling-container"></div>`;
        const container = document.getElementById("scrolling-container");
        if (!container) {
            throw new Error("#scrolling-container is missing.");
        }
        // happy-dom does not lay the page out, so the container scrolls as far as it is asked to.
        let top = 0;
        Object.defineProperty(container, "scrollTop", {
            get: () => top,
            set: (value: number) => {
                top = value;
            }
        });
        setupLayout();
        return container;
    }

    function readPlaces(): Record<string, number> {
        return JSON.parse(sessionStorage.getItem(NOTE_SCROLL_KEY) ?? "{}");
    }

    it("opens one pane at a time, closed by the backdrop or a return", () => {
        renderPage();

        click("left-pane-toggle-button");
        expect(document.body.className).toBe("menu-open");
        click("toc-pane-toggle-button");
        expect(document.body.className).toBe("toc-open");
        click("toc-pane-toggle-button");
        expect(document.body.className).toBe("");
        click("toc-pane-toggle-button");

        click("mobile-backdrop");
        expect(document.body.className).toBe("");

        click("left-pane-toggle-button");
        window.dispatchEvent(pageShow(false));
        expect(document.body.className).toBe("menu-open");
        window.dispatchEvent(pageShow(true));
        expect(document.body.className).toBe("");
    });

    it("leaves out the controls a page does not have", () => {
        expect(() => setupLayout()).not.toThrow();
    });
});

function renderPage() {
    document.body.innerHTML = `
        <button id="left-pane-toggle-button"></button>
        <button id="toc-pane-toggle-button"></button>
        <div id="mobile-backdrop"></div>
    `;
    setupLayout();
}

function click(id: string) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`#${id} is missing.`);
    }
    element.click();
}

/** A `pageshow` event, for a page restored from the back/forward cache when `persisted`. */
function pageShow(persisted: boolean) {
    return Object.assign(new Event("pageshow"), { persisted });
}
