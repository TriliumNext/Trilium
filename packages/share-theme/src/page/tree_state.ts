const TREE_STATE_KEY = "share-tree-state";

/** What the navigation pane keeps from one page of a site to the next. */
interface TreeState {
    siteId: string | undefined;
    top: number;
    expanded: string[];
    /** The note IDs from the top of the tree down to the entry that was clicked. */
    activePath?: string[];
}

/**
 * Keeps the navigation pane's expanded pages and scroll position across the pages of a site, which
 * are separate documents, and brings the current note into view when that position would hide it.
 * Of a cloned note, the entry that was clicked stays the selected one. The state is kept per site,
 * keyed by `data-ancestor-note-id`, in `sessionStorage`.
 */
export default function setupTreeState() {
    const pane = document.getElementById("left-pane");
    if (!pane) {
        return;
    }
    const siteId = document.body.dataset.ancestorNoteId;

    const saved = readTreeState();
    let activePath: string[] | undefined;
    if (saved && saved.siteId === siteId) {
        activePath = restoreTree(pane, saved);
        pane.scrollTop = saved.top;
    }

    const active = pane.querySelector<HTMLElement>("#menu a.active");
    if (active) {
        const paneRect = pane.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();
        // The sticky `#site-header` covers the top of the pane.
        const visibleTop = pane.querySelector("#site-header")?.getBoundingClientRect().bottom
            ?? paneRect.top;
        if (activeRect.top < visibleTop || activeRect.bottom > paneRect.bottom) {
            const visibleHeight = pane.clientHeight - (visibleTop - paneRect.top);
            const centered = (visibleHeight - activeRect.height) / 2;
            pane.scrollTop += activeRect.top - visibleTop - centered;
        }
    }

    pane.addEventListener("click", (e) => {
        const link = e.target instanceof Element && e.target.closest("#menu a");
        const item = link && !link.closest(".tree-toc") && link.closest("li");
        if (!item) {
            return;
        }
        activePath = getItemPath(item);
        // An entry of the page shown, maybe another clone of it, is selected in place.
        const opensNewTab = e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0;
        if (!opensNewTab && item.getAttribute("data-note-id") === document.body.dataset.noteId) {
            e.preventDefault();
            selectItem(pane, item);
        }
    });

    // `pageswap` fires before a prerendered page is shown, `pagehide` only once this one unloads.
    const saveState = () => {
        const expandedItems = pane.querySelectorAll<HTMLElement>("#menu li.expanded[data-note-id]");
        const expanded = [ ...expandedItems ].map((item) => item.dataset.noteId);
        const state = { siteId, top: pane.scrollTop, expanded, activePath };
        try {
            sessionStorage.setItem(TREE_STATE_KEY, JSON.stringify(state));
        } catch {
            // The next page then starts from the server's expansion and the current note.
        }
    };
    window.addEventListener("pageswap", saveState);
    window.addEventListener("pagehide", saveState);
}

/**
 * Expands the saved entries, every clone of each, and selects the clicked entry of the current
 * note, all without animating. Returns the path to that entry when the tree still has it.
 */
function restoreTree(pane: HTMLElement, state: TreeState) {
    pane.classList.add("tree-restoring");

    const ids = new Set(state.expanded);
    for (const item of pane.querySelectorAll<HTMLElement>("#menu li.submenu-item[data-note-id]")) {
        if (item.dataset.noteId && ids.has(item.dataset.noteId)) {
            expandItem(item);
        }
    }

    const path = state.activePath;
    const clicked = path?.at(-1) === document.body.dataset.noteId && path && findItem(pane, path);
    if (clicked) {
        selectItem(pane, clicked);
        const ancestors = getAncestorItems(clicked);
        for (const ancestor of ancestors) {
            expandItem(ancestor);
        }
        // The server expands the way to another clone, which would push the clicked one down.
        for (const item of pane.querySelectorAll<HTMLElement>("#menu li.expanded[data-note-id]")) {
            const keep = item === clicked || ancestors.includes(item)
                || ids.has(String(item.dataset.noteId));
            if (!keep) {
                collapseItem(item);
            }
        }
    }

    // Applies the expanded styles while transitions are off, so the chevrons do not rotate.
    void pane.offsetHeight;
    pane.classList.remove("tree-restoring");
    return clicked ? path : undefined;
}

/** Moves the current note's card and its table of contents to `item`, one of its entries. */
function selectItem(pane: HTMLElement, item: Element) {
    for (const selected of pane.querySelectorAll("#menu .active")) {
        if (!selected.closest(".tree-toc")) {
            selected.classList.remove("active");
        }
    }
    const rowAndLink = ":scope > .tree-item-row, :scope > * > a, :scope > a";
    for (const selected of item.querySelectorAll(rowAndLink)) {
        selected.classList.add("active");
    }
    const toc = pane.querySelector("#menu .tree-toc");
    if (toc) {
        item.querySelector(":scope > .tree-item-row")?.after(toc);
    }
}

function expandItem(item: Element) {
    item.classList.add("expanded");
    item.querySelector(":scope > * > .collapse-button")?.setAttribute("aria-expanded", "true");
}

function collapseItem(item: Element) {
    item.classList.remove("expanded");
    item.querySelector(":scope > * > .collapse-button")?.setAttribute("aria-expanded", "false");
}

/** Returns the note IDs from the top of the tree down to `item`. */
function getItemPath(item: Element) {
    return [ ...getAncestorItems(item).reverse(), item ]
        .map((entry) => entry.getAttribute("data-note-id") ?? "");
}

/** Returns the entries that contain `item`, from its parent up. */
function getAncestorItems(item: Element) {
    const ancestors: Element[] = [];
    let entry = item.parentElement?.closest("li");
    while (entry) {
        ancestors.push(entry);
        entry = entry.parentElement?.closest("li");
    }
    return ancestors;
}

/** Returns the entry that `path` leads to from the top of the tree, if the tree has it. */
function findItem(pane: HTMLElement, path: string[]) {
    let item: Element | undefined;
    let list = pane.querySelector("#menu > ul");
    for (const noteId of path) {
        const children = [ ...list?.children ?? [] ];
        item = children.find((child) => child.getAttribute("data-note-id") === noteId);
        list = item?.querySelector(":scope > ul") ?? null;
    }
    return item;
}

function readTreeState(): TreeState | null {
    try {
        const state = JSON.parse(sessionStorage.getItem(TREE_STATE_KEY) ?? "null");
        return state && {
            ...state,
            expanded: Array.isArray(state.expanded) ? state.expanded : [],
            activePath: Array.isArray(state.activePath) ? state.activePath : undefined
        };
    } catch {
        return null;
    }
}
