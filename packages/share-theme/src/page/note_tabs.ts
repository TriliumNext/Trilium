import "./note_tabs.css";

import { whenActivated } from "./speculation.js";

/** A note open in the tab bar, as session storage keeps it between page loads. */
export interface NoteTab {
    noteId: string;
    title: string;
    /** The classes of the note's icon. */
    icon: string;
    href: string;
}

/** The tab bar of one site: its tabs, and the index of the one whose note the page shows. */
export interface TabState {
    tabs: NoteTab[];
    active: number;
}

/** The pages of one site this browser tab went through, oldest first, and where it stands. */
export interface PageHistory {
    entries: string[];
    /** The position of the shown page, counted from the first page the tab saw. */
    index: number;
    /** The position of `entries[0]`, past the pages dropped to keep the list short. */
    start: number;
}

const MAX_HISTORY = 50;
/** Where a page's browser history entry keeps its position in the {@link PageHistory}. */
const POSITION_KEY = "sharePagePosition";

/**
 * The app's tab bar: the notes opened in this browser session, kept in session storage, behind
 * back and forward buttons. ⌘+click or a middle click on a tree note opens it in a new tab.
 */
export default function setupNoteTabs() {
    const bar = document.getElementById("note-tabs");
    const noteId = document.body.dataset.noteId;
    const siteId = document.body.dataset.ancestorNoteId;
    if (!bar || !noteId || !siteId) {
        return;
    }

    // A prerendered page is not open yet: its tab and its place in the history wait for the
    // visitor.
    whenActivated(() => {
        setupTabBar(bar, `share-tabs:${siteId}`, noteId, siteId);
        setupHistoryButtons(`share-history:${siteId}`);
    });
}

function setupTabBar(bar: HTMLElement, key: string, noteId: string, siteId: string) {
    const page = readPageTab(noteId);
    let state = openPageTab(readTabs(key), page);
    const closeLabel = bar.parentElement?.dataset.closeTab ?? "";

    const render = () => {
        writeStorage(key, state);
        bar.replaceChildren(...state.tabs.map((tab, position) => renderTab(tab, position)));
        bar.querySelector(".note-tab.active")
            ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };

    const renderTab = (tab: NoteTab, position: number) => {
        const element = document.createElement("div");
        element.className = position === state.active ? "note-tab active" : "note-tab";
        const link = document.createElement("a");
        link.className = "note-tab-link no-arrow";
        link.href = tab.href;
        // The page that loads marks this tab active.
        link.addEventListener("click", () => {
            state.active = position;
            writeStorage(key, state);
        });
        const icon = document.createElement("span");
        icon.className = tab.icon;
        icon.setAttribute("aria-hidden", "true");
        const title = document.createElement("span");
        title.className = "note-tab-title";
        title.textContent = tab.title;
        link.append(icon, title);
        element.append(link);

        if (state.tabs.length > 1) {
            const close = document.createElement("button");
            close.type = "button";
            close.className = "note-tab-close tn-icon bx bx-x";
            close.title = closeLabel;
            close.setAttribute("aria-label", closeLabel);
            close.addEventListener("click", () => closeTab(position));
            element.append(close);
        }
        return element;
    };

    const closeTab = (position: number) => {
        state.tabs.splice(position, 1);
        if (position === state.active) {
            state.active = Math.min(position, state.tabs.length - 1);
            writeStorage(key, state);
            location.href = state.tabs[state.active].href;
            return;
        }
        if (position < state.active) {
            state.active--;
        }
        render();
    };

    // The tree's note links open in a tab behind the open one, as in the app; a link that opens
    // elsewhere is the browser's.
    const openBehind = (event: MouseEvent) => {
        const target = event.target as Element | null;
        const link = target?.closest<HTMLAnchorElement>("#menu a[href]:not([target])");
        const linkedNoteId = link?.closest<HTMLElement>("#menu [data-note-id]")?.dataset.noteId;
        if (!link || !linkedNoteId) {
            return;
        }
        event.preventDefault();
        state.tabs.push({
            noteId: linkedNoteId,
            title: String(link.querySelector(".tree-item-title")?.textContent ?? link.textContent)
                .trim(),
            icon: link.querySelector(".tn-icon")?.className ?? "tn-icon bx bx-note",
            href: link.href
        });
        render();
    };
    document.addEventListener("click", (event) => {
        if (event.button === 0 && (event.metaKey || event.ctrlKey)) {
            openBehind(event);
        }
    });
    document.addEventListener("auxclick", (event) => {
        if (event.button === 1) {
            openBehind(event);
        }
    });

    // The site's start page fills its tab in once it loads.
    const newTab = document.querySelector<HTMLAnchorElement>("#new-tab[href]");
    newTab?.addEventListener("click", () => {
        const tab = { noteId: siteId, title: "", icon: "", href: newTab.href };
        state.active = state.tabs.push(tab) - 1;
        writeStorage(key, state);
    });

    // The page's tab follows the title as a guest edits it.
    document.getElementById("title")?.addEventListener("input", () => {
        page.title = readPageTab(noteId).title;
        render();
    });

    // A page restored from the back/forward cache shows the tabs the pages after it left.
    window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
            state = openPageTab(readTabs(key), page);
            render();
        }
    });

    // The bar hides its scrollbar, so the wheel moves it sideways.
    bar.addEventListener("wheel", (event) => {
        if (bar.scrollWidth > bar.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            bar.scrollLeft += event.deltaY;
            event.preventDefault();
        }
    }, { passive: false });

    render();
}

/**
 * Marks the page's tab active in `state`: the active one when it shows the page's note, else the
 * first that does, else a new one at the end. The tab takes the page's current title and icon.
 */
function openPageTab(state: TabState, page: NoteTab): TabState {
    let index = state.tabs[state.active]?.noteId === page.noteId
        ? state.active
        : state.tabs.findIndex((tab) => tab.noteId === page.noteId);
    if (index < 0) {
        index = state.tabs.push(page) - 1;
    } else {
        state.tabs[index] = page;
    }
    state.active = index;
    return state;
}

/** The page's own tab, from its title row. */
function readPageTab(noteId: string): NoteTab {
    const url = new URL(location.href);
    url.hash = "";
    return {
        noteId,
        title: String(document.getElementById("title")?.textContent ?? "").trim(),
        icon: document.querySelector("#title-row .tn-icon")?.className ?? "tn-icon bx bx-note",
        href: url.href
    };
}

function readTabs(key: string): TabState {
    const stored = readStorage(key) as Partial<TabState> | null;
    const tabs = Array.isArray(stored?.tabs)
        ? stored.tabs.filter((tab): tab is NoteTab => !!tab && typeof tab.noteId === "string"
            && typeof tab.title === "string" && typeof tab.icon === "string"
            && typeof tab.href === "string")
        : [];
    return { tabs, active: typeof stored?.active === "number" ? stored.active : -1 };
}

/**
 * Back and forward through this browser tab's pages of the site. Each page's browser history entry
 * keeps its position, which a reload, back, forward and the back/forward cache come back to.
 */
function setupHistoryButtons(key: string) {
    const back = document.querySelector<HTMLButtonElement>("button#history-back");
    const forward = document.querySelector<HTMLButtonElement>("button#history-forward");
    const page = location.pathname + location.search;
    const place = () => {
        const history = placePage(readHistory(key), page, readEntryPosition());
        writeStorage(key, history);
        writeEntryPosition(history.index);
        if (back) {
            back.disabled = history.index <= history.start;
        }
        if (forward) {
            forward.disabled = history.index >= history.start + history.entries.length - 1;
        }
    };

    back?.addEventListener("click", () => window.history.back());
    forward?.addEventListener("click", () => window.history.forward());
    place();
    window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
            place();
        }
    });
}

/**
 * Where a page stands in the site's history in this browser tab: at `recorded`, the position its
 * history entry holds, else on a new entry after the current page, dropping what lay ahead.
 */
export function placePage(
    history: PageHistory, path: string, recorded: number | undefined
): PageHistory {
    const { entries, index, start } = history;
    if (recorded !== undefined && entries[recorded - start] === path) {
        return { ...history, index: recorded };
    }
    const kept = [ ...entries.slice(0, index - start + 1), path ];
    const dropped = Math.max(0, kept.length - MAX_HISTORY);
    return { entries: kept.slice(dropped), index: index + 1, start: start + dropped };
}

function readEntryPosition() {
    const state: unknown = window.history.state;
    const position = state && typeof state === "object"
        ? (state as Record<string, unknown>)[POSITION_KEY] : undefined;
    return typeof position === "number" ? position : undefined;
}

/** Keeps whatever else the entry's state holds. */
function writeEntryPosition(position: number) {
    const state: unknown = window.history.state;
    const kept = state && typeof state === "object" ? state : {};
    window.history.replaceState({ ...kept, [POSITION_KEY]: position }, "");
}

function readHistory(key: string): PageHistory {
    const stored = readStorage(key) as Partial<PageHistory> | null;
    if (Array.isArray(stored?.entries) && typeof stored.index === "number"
            && stored.entries.every((entry) => typeof entry === "string")) {
        const start = typeof stored.start === "number" ? stored.start : 0;
        return { entries: stored.entries, index: stored.index, start };
    }
    return { entries: [], index: -1, start: 0 };
}

/** What session storage holds under `key`, or `null` when it holds nothing readable. */
function readStorage(key: string): unknown {
    try {
        return JSON.parse(sessionStorage.getItem(key) ?? "null");
    } catch {
        return null;
    }
}

/** Without storage, the tabs and the history hold for this page only. */
function writeStorage(key: string, value: unknown) {
    try {
        sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Nothing to keep it in.
    }
}
