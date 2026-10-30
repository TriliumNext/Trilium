// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import setupNoteTabs, { type PageHistory, placePage, type TabState } from "./note_tabs.js";

const TABS_KEY = "share-tabs:site";
const HISTORY_KEY = "share-history:site";

describe("setupNoteTabs", () => {
    /** Whether the last click or middle click on the page was taken by the tab bar. */
    let intercepted = false;
    /** The listeners the page and the test put on the document and the window, removed after each test. */
    const listeners: [ EventTarget, string, EventListenerOrEventListenerObject ][] = [];

    beforeEach(() => {
        for (const target of [ document, window ]) {
            const addEventListener = target.addEventListener.bind(target);
            vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
                if (listener) {
                    listeners.push([ target, type, listener ]);
                }
                addEventListener(type, listener, options);
            });
        }
        intercepted = false;
        // happy-dom would follow a link; the test only wants to know whether the bar took the click.
        for (const type of [ "click", "auxclick" ]) {
            window.addEventListener(type, (event) => {
                intercepted = event.defaultPrevented;
                event.preventDefault();
            });
        }
        // One URL stands in for the location, so that a navigation shows in its `href`.
        const url = new URL("https://example.com/share/page?x=1#top");
        vi.spyOn(window, "location", "get").mockImplementation(() => url as unknown as Location);
        document.body.dataset.noteId = "page";
        document.body.dataset.ancestorNoteId = "site";
    });

    afterEach(() => {
        for (const [ target, type, listener ] of listeners) {
            target.removeEventListener(type, listener);
        }
        listeners.length = 0;
        vi.restoreAllMocks();
        sessionStorage.clear();
        window.history.replaceState(null, "");
        document.body.innerHTML = "";
        delete document.body.dataset.noteId;
        delete document.body.dataset.ancestorNoteId;
        Reflect.deleteProperty(document, "prerendering");
    });

    it("opens the page's note in a tab of its own, and the start page from the + button", () => {
        renderPage();
        setupNoteTabs();

        const tabs = document.querySelectorAll(".note-tab");
        expect(tabs).toHaveLength(1);
        expect(tabs[0].classList.contains("active")).toBe(true);
        expect(tabs[0].querySelector(".note-tab-link")?.getAttribute("href"))
            .toBe("https://example.com/share/page?x=1");
        expect(tabs[0].querySelector(".note-tab-title")?.textContent).toBe("Page");
        expect(tabs[0].querySelector(".note-tab-link > span")?.className).toBe("tn-icon bx bx-file");
        // The one tab stays open.
        expect(tabs[0].querySelector(".note-tab-close")).toBeNull();
        expect(readTabs()).toStrictEqual({
            tabs: [ { noteId: "page", title: "Page", icon: "tn-icon bx bx-file", href: "https://example.com/share/page?x=1" } ],
            active: 0
        });

        document.querySelector<HTMLAnchorElement>("#new-tab")?.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(intercepted).toBe(false);
        expect(readTabs()).toStrictEqual({
            tabs: [
                { noteId: "page", title: "Page", icon: "tn-icon bx bx-file", href: "https://example.com/share/page?x=1" },
                { noteId: "site", title: "", icon: "", href: "https://example.com/share/site" }
            ],
            active: 1
        });
    });

    it("keeps the tabs of the session, refreshing the page's own and picking the active one", () => {
        const other = { noteId: "other", title: "Other", icon: "tn-icon bx bx-note", href: "https://example.com/share/other" };
        const stale = { noteId: "page", title: "Old title", icon: "tn-icon bx bx-note", href: "https://example.com/share/old" };
        writeTabs({ tabs: [ other, stale, { ...stale, title: "Second" } ], active: 2 });
        renderPage();
        setupNoteTabs();

        // The active tab shows this note, so it is the page's tab, with the page's title.
        let tabs = document.querySelectorAll(".note-tab");
        expect(tabs).toHaveLength(3);
        expect(tabs[2].classList.contains("active")).toBe(true);
        expect(tabs[2].querySelector(".note-tab-title")?.textContent).toBe("Page");
        expect(tabs[1].querySelector(".note-tab-title")?.textContent).toBe("Old title");
        expect(readTabs().active).toBe(2);

        // Otherwise the first tab of the note is the page's.
        writeTabs({ tabs: [ other, stale ], active: 0 });
        document.body.innerHTML = "";
        renderPage();
        setupNoteTabs();
        tabs = document.querySelectorAll(".note-tab");
        expect(tabs[1].classList.contains("active")).toBe(true);
        expect(tabs[1].querySelector(".note-tab-title")?.textContent).toBe("Page");

        // The page's tab follows the title as it is edited.
        const title = document.getElementById("title");
        if (title) {
            title.textContent = " Renamed ";
        }
        title?.dispatchEvent(new Event("input"));
        tabs = document.querySelectorAll(".note-tab");
        expect(tabs[1].querySelector(".note-tab-title")?.textContent).toBe("Renamed");
        expect(readTabs().tabs[1].title).toBe("Renamed");

        // A click on a tab marks it active for the page that loads.
        tabs[0].querySelector(".note-tab-link")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(readTabs().active).toBe(0);
    });

    it("opens a note of the tree behind the open tab on a modified or middle click", () => {
        renderPage();
        setupNoteTabs();
        const treeLink = document.querySelector<HTMLAnchorElement>("#menu a[href$='/child']");
        const external = document.querySelector<HTMLAnchorElement>("#menu a[target]");
        const press = (target: Element | null | undefined, init: MouseEventInit, type = "click") => {
            intercepted = false;
            target?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
            return intercepted;
        };
        expect(press(treeLink, {})).toBe(false);
        expect(document.querySelectorAll(".note-tab")).toHaveLength(1);

        expect(press(treeLink?.querySelector(".tree-item-title"), { metaKey: true })).toBe(true);
        // A link that opens elsewhere, a link of the content and any other button are not the bar's.
        press(external, { ctrlKey: true });
        expect(press(document.querySelector("#content a"), { button: 1 }, "auxclick")).toBe(false);
        expect(document.querySelectorAll(".note-tab")).toHaveLength(2);
        expect(press(treeLink, { button: 1 }, "auxclick")).toBe(true);
        expect(press(document.body, { button: 2 }, "auxclick")).toBe(false);

        const tabs = document.querySelectorAll(".note-tab");
        expect(tabs).toHaveLength(3);
        expect(tabs[0].classList.contains("active")).toBe(true);
        expect(tabs[1].querySelector(".note-tab-title")?.textContent).toBe("Child");
        expect(tabs[1].querySelector(".note-tab-link > span")?.className).toBe("tn-icon bx bx-folder");
        expect(tabs[2].querySelector(".note-tab-link")?.getAttribute("href")).toBe("https://example.com/share/child");
        expect(readTabs().tabs.map((tab) => tab.noteId)).toEqual([ "page", "child", "child" ]);
        for (const close of document.querySelectorAll(".note-tab-close")) {
            expect(close.getAttribute("aria-label")).toBe("Close");
        }
    });

    it("closes a tab, going to its neighbour when it was the open one", () => {
        const tab = (noteId: string) => ({ noteId, title: noteId, icon: "tn-icon bx bx-note", href: `https://example.com/share/${noteId}` });
        writeTabs({ tabs: [ tab("a"), tab("b"), tab("page"), tab("c") ], active: 2 });
        renderPage();
        setupNoteTabs();

        const close = (position: number) =>
            document.querySelectorAll<HTMLButtonElement>(".note-tab-close")[position].click();
        close(3);
        expect(readTabs()).toMatchObject({ active: 2 });
        expect(document.querySelectorAll(".note-tab")).toHaveLength(3);
        close(0);
        expect(readTabs()).toMatchObject({ active: 1 });
        expect(document.querySelectorAll(".note-tab")[1].classList.contains("active")).toBe(true);

        close(1);
        expect(readTabs()).toStrictEqual({ tabs: [ tab("b") ], active: 0 });
        expect(window.location.href).toBe("https://example.com/share/b");
    });

    it("goes to the last tab left when the open one was the last", () => {
        const tab = (noteId: string) => ({ noteId, title: noteId, icon: "", href: `https://example.com/share/${noteId}` });
        writeTabs({ tabs: [ tab("a"), tab("page") ], active: 1 });
        renderPage();
        setupNoteTabs();
        document.querySelectorAll<HTMLButtonElement>(".note-tab-close")[1].click();
        expect(readTabs()).toStrictEqual({ tabs: [ tab("a") ], active: 0 });
        expect(window.location.href).toBe("https://example.com/share/a");
    });

    it("scrolls the bar sideways with the wheel once the tabs do not fit", () => {
        renderPage();
        setupNoteTabs();
        const bar = document.getElementById("note-tabs");
        const wheel = (deltaY: number, deltaX = 0) =>
            bar?.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaX, cancelable: true }));

        expect(wheel(40)).toBe(true);
        if (bar) {
            Object.defineProperty(bar, "scrollWidth", { value: 800 });
            Object.defineProperty(bar, "clientWidth", { value: 400 });
        }
        expect(wheel(40)).toBe(false);
        expect(bar?.scrollLeft).toBe(40);
        expect(wheel(10, 20)).toBe(true);
    });

    it("starts afresh from unreadable storage, and goes on without storage", () => {
        sessionStorage.setItem(TABS_KEY, "{ not json");
        sessionStorage.setItem(HISTORY_KEY, JSON.stringify({ entries: [ 1 ], index: 0 }));
        renderPage();
        setupNoteTabs();
        expect(readTabs().tabs.map((tab) => tab.noteId)).toEqual([ "page" ]);
        expect(JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? "")).toStrictEqual({
            entries: [ "/share/page?x=1" ], index: 0, start: 0
        });
        // The page's browser history entry records where it stands.
        expect(window.history.state).toStrictEqual({ sharePagePosition: 0 });

        sessionStorage.setItem(TABS_KEY, JSON.stringify({
            tabs: [ null, { noteId: 1 }, { noteId: "kept", title: "Kept", icon: "", href: "./kept" } ], active: "0"
        }));
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("quota");
        });
        document.body.innerHTML = "";
        renderPage();
        setupNoteTabs();
        expect([ ...document.querySelectorAll(".note-tab-title") ].map((title) => title.textContent))
            .toEqual([ "Kept", "Page" ]);
    });

    it("moves back and forward through the pages seen, at the position the entry holds", () => {
        const entries = [ "/share/a", "/share/page?x=1", "/share/c" ];
        // As a page before positions kept it, without `start`.
        sessionStorage.setItem(HISTORY_KEY, JSON.stringify({ entries, index: 0 }));
        window.history.replaceState({ other: "kept", sharePagePosition: 1 }, "");
        const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
        const forward = vi.spyOn(window.history, "forward").mockImplementation(() => {});
        renderPage();
        setupNoteTabs();

        const backButton = document.querySelector<HTMLButtonElement>("#history-back");
        const forwardButton = document.querySelector<HTMLButtonElement>("#history-forward");
        expect(backButton?.disabled).toBe(false);
        expect(forwardButton?.disabled).toBe(false);
        expect(window.history.state).toStrictEqual({ other: "kept", sharePagePosition: 1 });
        expect(JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? ""))
            .toStrictEqual({ entries, index: 1, start: 0 });
        backButton?.click();
        forwardButton?.click();
        expect(back).toHaveBeenCalledOnce();
        expect(forward).toHaveBeenCalledOnce();
    });

    it("keeps what it can read of the storage, and manages with what a page lacks", () => {
        sessionStorage.setItem(TABS_KEY, JSON.stringify({ tabs: "none", active: 0 }));
        sessionStorage.setItem(HISTORY_KEY, JSON.stringify({ entries: [ "/share/a" ], index: "0" }));
        window.history.replaceState("not an object", "");
        document.body.innerHTML = `
            <nav id="menu"><ul>
                <li><a href="https://example.com/share/orphan">Orphan</a></li>
                <li data-note-id="plain"><a href="https://example.com/share/plain">Plain</a></li>
            </ul></nav>
            <div><nav id="note-tabs"></nav></div>`;
        setupNoteTabs();

        expect(readTabs()).toStrictEqual({
            tabs: [ { noteId: "page", title: "", icon: "tn-icon bx bx-note", href: "https://example.com/share/page?x=1" } ],
            active: 0
        });
        expect(JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? "")).toStrictEqual({
            entries: [ "/share/page?x=1" ], index: 0, start: 0
        });
        expect(window.history.state).toStrictEqual({ sharePagePosition: 0 });

        const links = document.querySelectorAll<HTMLAnchorElement>("#menu a");
        links[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
        links[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true, button: 2 }));
        expect(document.querySelectorAll(".note-tab")).toHaveLength(1);
        links[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
        const tabs = document.querySelectorAll(".note-tab");
        expect(tabs).toHaveLength(2);
        expect(tabs[1].querySelector(".note-tab-title")?.textContent).toBe("Plain");
        expect(tabs[1].querySelector(".note-tab-link > span")?.className).toBe("tn-icon bx bx-note");
        expect(tabs[1].querySelector(".note-tab-close")?.getAttribute("aria-label")).toBe("");

        sessionStorage.setItem(TABS_KEY, JSON.stringify({ tabs: [
            { noteId: "a", title: 1, icon: "", href: "" },
            { noteId: "b", title: "", icon: 1, href: "" },
            { noteId: "c", title: "", icon: "", href: 1 }
        ] }));
        document.body.innerHTML = `<nav id="note-tabs"></nav>`;
        setupNoteTabs();
        expect(readTabs().tabs.map((tab) => tab.noteId)).toEqual([ "page" ]);
    });

    it("takes the tabs and the place later pages left on a back/forward cache return", () => {
        renderPage();
        setupNoteTabs();
        const page = readTabs().tabs[0];
        const later = {
            noteId: "later", title: "Later", icon: "tn-icon bx bx-note",
            href: "https://example.com/share/later"
        };
        writeTabs({ tabs: [ page, later ], active: 1 });
        const entries = [ "/share/page?x=1", "/share/later" ];
        sessionStorage.setItem(HISTORY_KEY, JSON.stringify({ entries, index: 1, start: 0 }));
        const pageShow = (persisted: boolean) =>
            window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));

        pageShow(false);
        expect(document.querySelectorAll(".note-tab")).toHaveLength(1);

        pageShow(true);
        const tabs = document.querySelectorAll(".note-tab");
        expect([ ...tabs ].map((tab) => tab.querySelector(".note-tab-title")?.textContent))
            .toEqual([ "Page", "Later" ]);
        expect(tabs[0].classList.contains("active")).toBe(true);
        expect(readTabs().active).toBe(0);
        expect(document.querySelector<HTMLButtonElement>("#history-back")?.disabled).toBe(true);
        expect(document.querySelector<HTMLButtonElement>("#history-forward")?.disabled).toBe(false);
        expect(JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? ""))
            .toStrictEqual({ entries, index: 0, start: 0 });

        // The restored page adds a tab once per click, as before.
        document.querySelector("#menu a[href$='/child']")?.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
        expect(readTabs().tabs.map((tab) => tab.noteId)).toEqual([ "page", "later", "child" ]);
    });

    it("waits for a prerendered page to be shown, and leaves a page without the bar alone", () => {
        Object.defineProperty(document, "prerendering", { value: true, configurable: true });
        renderPage();
        setupNoteTabs();
        expect(document.querySelector(".note-tab")).toBeNull();
        document.dispatchEvent(new Event("prerenderingchange"));
        expect(document.querySelector(".note-tab")).not.toBeNull();

        document.body.innerHTML = "";
        setupNoteTabs();
        renderPage();
        delete document.body.dataset.ancestorNoteId;
        setupNoteTabs();
        expect(document.querySelector(".note-tab")).toBeNull();
        document.body.dataset.ancestorNoteId = "site";
        delete document.body.dataset.noteId;
        setupNoteTabs();
        expect(document.querySelector(".note-tab")).toBeNull();
    });

    function renderPage() {
        document.body.innerHTML = `
            <nav id="menu">
                <ul>
                    <li data-note-id="child"><div class="tree-item-row">
                        <a href="https://example.com/share/child"><span class="tn-icon bx bx-folder"></span><span class="tree-item-title">Child</span></a>
                    </div></li>
                    <li data-note-id="ext"><a href="https://elsewhere.example" target="_blank">Away</a></li>
                </ul>
            </nav>
            <div id="tab-row" data-close-tab="Close">
                <button type="button" id="history-back"></button>
                <button type="button" id="history-forward"></button>
                <nav id="note-tabs"></nav>
                <a href="https://example.com/share/site" id="new-tab"></a>
            </div>
            <div id="title-row"><span class="tn-icon bx bx-file"></span><span class="title-row-title">Page</span></div>
            <div id="content"><h1 id="title">Page</h1><a href="./inside">Inside</a></div>`;
    }

    function readTabs(): TabState {
        return JSON.parse(sessionStorage.getItem(TABS_KEY) ?? "");
    }

    function writeTabs(state: TabState) {
        sessionStorage.setItem(TABS_KEY, JSON.stringify(state));
    }
});

describe("placePage", () => {
    // A → B → A, standing on B.
    const history: PageHistory = { entries: [ "/a", "/b", "/a" ], index: 1, start: 0 };

    it("goes to the position the history entry holds, else to a new entry after the page", () => {
        // Back to the first A, or forward to the second: the entry tells the two apart.
        expect(placePage(history, "/a", 0)).toStrictEqual({ ...history, index: 0 });
        expect(placePage(history, "/a", 2)).toStrictEqual({ ...history, index: 2 });
        expect(placePage(history, "/b", 1)).toStrictEqual(history);

        // A new entry, or one whose position names another page, drops what lay ahead.
        const added = { entries: [ "/a", "/b", "/c" ], index: 2, start: 0 };
        expect(placePage(history, "/c", undefined)).toStrictEqual(added);
        expect(placePage(history, "/c", 2)).toStrictEqual(added);
        expect(placePage({ entries: [], index: -1, start: 0 }, "/a", undefined))
            .toStrictEqual({ entries: [ "/a" ], index: 0, start: 0 });
    });

    it("keeps the last fifty pages, counting positions from the first page", () => {
        const entries = Array.from({ length: 50 }, (_, i) => `/${i}`);
        const long = { entries, index: 49, start: 0 };
        const next = placePage(long, "/50", undefined);
        expect(next).toMatchObject({ index: 50, start: 1 });
        expect(next.entries).toHaveLength(50);
        expect(next.entries[0]).toBe("/1");
        expect(placePage(next, "/50", 50)).toStrictEqual(next);
        // A position before the pages kept is taken as a new entry.
        expect(placePage(next, "/0", 0)).toMatchObject({ index: 51, start: 2 });
    });
});
