// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import setupExpanders, { setupTreeState } from "./navigation.js";

describe("setupExpanders", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.useRealTimers();
    });

    it("expands and collapses a page's subtree, animating its height", () => {
        vi.useFakeTimers();
        document.body.innerHTML = `
            <nav id="menu">
                <ul>
                    <li class="submenu-item">
                        <div class="tree-item-row">
                            <button class="collapse-button" aria-expanded="false"></button>
                            <a href="./parent">Parent</a>
                        </div>
                        <ul><li><a href="./child">Child</a></li></ul>
                    </li>
                </ul>
            </nav>
        `;
        const item = document.querySelector(".submenu-item");
        const subtree = item?.querySelector("ul");
        const expander = item?.querySelector<HTMLElement>(".collapse-button");
        if (!item || !subtree || !expander) {
            throw new Error("The tree is incomplete.");
        }
        Object.defineProperty(subtree, "scrollHeight", { value: 40 });
        setupExpanders();

        const click = new MouseEvent("click", { bubbles: true, cancelable: true });
        expander.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(true);
        expect(item.classList.contains("expanded")).toBe(true);
        expect(expander.getAttribute("aria-expanded")).toBe("true");
        expect(subtree.style.height).toBe("40px");
        expect(subtree.style.overflow).toBe("hidden");
        vi.advanceTimersByTime(200);
        expect(subtree.style.height).toBe("");
        expect(subtree.style.overflow).toBe("");

        expander.click();
        expect(item.classList.contains("expanded")).toBe(false);
        expect(expander.getAttribute("aria-expanded")).toBe("false");
        expect(subtree.style.height).toBe("0px");
        vi.advanceTimersByTime(200);
        expect(subtree.style.height).toBe("");
    });

    it("ignores an expander without a subtree or outside a list item", () => {
        document.body.innerHTML = `
            <nav id="menu">
                <div class="submenu-item"><span class="collapse-button" id="loose"></span></div>
                <ul>
                    <li class="submenu-item"><span class="collapse-button" id="leaf"></span></li>
                </ul>
            </nav>
        `;
        setupExpanders();

        document.getElementById("loose")?.click();
        document.getElementById("leaf")?.click();

        expect(document.querySelector(".expanded")).toBeNull();
    });
});

describe("setupTreeState", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = "";
        delete document.body.dataset.ancestorNoteId;
        sessionStorage.clear();
    });

    it("restores the pane's position on another page of the same site only", () => {
        renderPane("site1", { activeTop: 120 });
        sessionStorage.setItem("share-tree-state", JSON.stringify({ siteId: "site1", top: 80 }));
        setupTreeState();
        expect(pane().scrollTop).toBe(80);

        pane().scrollTop = 30;
        window.dispatchEvent(new Event("pagehide"));
        expect(JSON.parse(sessionStorage.getItem("share-tree-state") ?? "null"))
            .toStrictEqual({ siteId: "site1", top: 30, expanded: [] });

        renderPane("site2", { activeTop: 120 });
        setupTreeState();
        expect(pane().scrollTop).toBe(0);
    });

    it("remembers the expanded pages of a site, also on pages that expand others", () => {
        renderPane("site1", { menu: TREE });
        setupExpanders();
        setupTreeState();
        toggle("section").click();
        window.dispatchEvent(new Event("pagehide"));
        expect(JSON.parse(sessionStorage.getItem("share-tree-state") ?? "null").expanded)
            .toStrictEqual([ "chapter", "section" ]);

        const collapsedChapter = TREE.replace(`"submenu-item expanded" data-note-id="chapter"`,
            `"submenu-item" data-note-id="chapter"`);
        renderPane("site1", { menu: collapsedChapter });
        setupTreeState();
        expect(expandedIds()).toStrictEqual([ "chapter", "section" ]);
        expect([ "chapter", "section" ].map((id) => toggle(id).getAttribute("aria-expanded")))
            .toStrictEqual([ "true", "true" ]);

        renderPane("site2", { menu: TREE });
        setupTreeState();
        expect(expandedIds()).toStrictEqual([ "chapter" ]);

        const malformed = { siteId: "site1", top: 0, expanded: "x" };
        sessionStorage.setItem("share-tree-state", JSON.stringify(malformed));
        renderPane("site1", { menu: TREE });
        setupTreeState();
        expect(expandedIds()).toStrictEqual([ "chapter" ]);
    });

    it("centers the current note when it is out of view, and leaves it when it is in view", () => {
        renderPane("site1", { activeTop: 700 });
        setupTreeState();
        // 700 - 0 - (400 - 32) / 2
        expect(pane().scrollTop).toBe(516);

        renderPane("site1", { activeTop: 380 });
        setupTreeState();
        expect(pane().scrollTop).toBe(196);

        sessionStorage.setItem("share-tree-state", JSON.stringify({ siteId: "site1", top: 300 }));
        renderPane("site1", { activeTop: 250 });
        setupTreeState();
        expect(pane().scrollTop).toBe(66);
        sessionStorage.clear();

        renderPane("site1", { activeTop: 368 });
        setupTreeState();
        expect(pane().scrollTop).toBe(0);
    });

    it("ignores a malformed position and works with blocked storage or without a pane", () => {
        renderPane("site1");
        sessionStorage.setItem("share-tree-state", "{");
        setupTreeState();
        expect(pane().scrollTop).toBe(0);

        const blocked = () => {
            throw new Error("Storage is blocked.");
        };
        vi.stubGlobal("sessionStorage", { getItem: blocked, setItem: blocked });
        renderPane("site1");
        setupTreeState();
        expect(() => window.dispatchEvent(new Event("pagehide"))).not.toThrow();

        vi.unstubAllGlobals();
        renderPane("site1");
        delete document.body.dataset.ancestorNoteId;
        expect(() => setupTreeState()).not.toThrow();

        document.body.innerHTML = "";
        expect(() => setupTreeState()).not.toThrow();
    });
});

/**
 * Renders a 400px tall pane at the top of the window, with a current note of 32px at `activeTop`
 * when it is given; happy-dom has no layout, so the geometry is set by hand.
 */
function renderPane(siteId: string, options: { activeTop?: number; menu?: string } = {}) {
    const { activeTop, menu = NOTE } = options;
    document.body.dataset.ancestorNoteId = siteId;
    document.body.innerHTML = `<div id="left-pane"><nav id="menu">${menu}</nav></div>`;
    const paneEl = pane();
    Object.defineProperty(paneEl, "clientHeight", { value: 400 });
    paneEl.getBoundingClientRect = () => new DOMRect(0, 0, 200, 400);
    const active = paneEl.querySelector<HTMLElement>("a.active");
    if (activeTop === undefined) {
        active?.remove();
    } else if (active) {
        active.getBoundingClientRect = () => new DOMRect(0, activeTop - paneEl.scrollTop, 200, 32);
    }
}

function pane() {
    const paneEl = document.getElementById("left-pane");
    if (!paneEl) {
        throw new Error("The pane is missing.");
    }
    return paneEl;
}

const NOTE = `<ul><li><a class="active" href="./note">Note</a></li></ul>`;

/** A chapter the server expanded, with a section inside it and a section of another chapter. */
const TREE = `
    <ul>
        <li class="submenu-item expanded" data-note-id="chapter">
            <div class="tree-item-row">
                <button class="collapse-button" aria-expanded="true"></button>
                <a href="./chapter">Chapter</a>
            </div>
            <ul>
                <li class="submenu-item" data-note-id="section">
                    <div class="tree-item-row">
                        <button class="collapse-button" aria-expanded="false"></button>
                        <a href="./section">Section</a>
                    </div>
                    <ul><li class="item" data-note-id="page"><a href="./page">Page</a></li></ul>
                </li>
            </ul>
        </li>
        <li class="submenu-item" data-note-id="other">
            <div class="tree-item-row">
                <button class="collapse-button" aria-expanded="false"></button>
                <a href="./other">Other</a>
            </div>
            <ul><li class="item" data-note-id="leaf"><a href="./leaf">Leaf</a></li></ul>
        </li>
    </ul>`;

function toggle(noteId: string) {
    const selector = `li[data-note-id="${noteId}"] .collapse-button`;
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (!button) {
        throw new Error(`The tree has no button for ${noteId}.`);
    }
    return button;
}

function expandedIds() {
    return [ ...document.querySelectorAll<HTMLElement>("#menu li.expanded") ]
        .map((li) => li.dataset.noteId);
}
