import "./navigation.css";

export default function setupExpanders() {
    const expanders = document.querySelectorAll("#menu .submenu-item .collapse-button");
    for (const expander of expanders) {
        const li = expander.closest("li");
        if (!li) {
            continue;
        }

        expander.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();

            const ul = li.querySelector("ul");
            if (!ul) {
                return;
            }

            const isExpanded = li.classList.contains("expanded");
            // Only a moving subtree is clipped, so the current note's shadow shows otherwise.
            ul.style.overflow = "hidden";

            if (isExpanded) {
                // Collapsing
                ul.style.height = `${ul.scrollHeight}px`;
                // Force reflow
                ul.offsetHeight;

                li.classList.remove("expanded");
                expander.setAttribute("aria-expanded", "false");
                ul.style.height = "0";
            } else {
                // Expanding
                ul.style.height = "0";
                // Force reflow
                ul.offsetHeight;

                li.classList.add("expanded");
                expander.setAttribute("aria-expanded", "true");
                ul.style.height = `${ul.scrollHeight}px`;
            }

            setTimeout(() => {
                ul.style.height = "";
                ul.style.overflow = "";
            }, 200);
        });
    }
}

const TREE_STATE_KEY = "share-tree-state";

/** What the navigation pane keeps from one page of a site to the next. */
interface TreeState {
    siteId: string | undefined;
    top: number;
    expanded: string[];
}

/**
 * Keeps the navigation pane's expanded pages and scroll position across the pages of a site, which
 * are separate documents, and brings the current note into view when that position would hide it.
 * The state is kept per site, keyed by `data-ancestor-note-id`, in `sessionStorage`.
 */
export function setupTreeState() {
    const pane = document.getElementById("left-pane");
    if (!pane) {
        return;
    }
    const siteId = document.body.dataset.ancestorNoteId;

    const saved = readTreeState();
    if (saved && saved.siteId === siteId) {
        expandItems(pane, saved.expanded);
        pane.scrollTop = saved.top;
    }

    const active = pane.querySelector<HTMLElement>("#menu a.active");
    if (active) {
        const paneRect = pane.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();
        if (activeRect.top < paneRect.top || activeRect.bottom > paneRect.bottom) {
            const centered = (pane.clientHeight - activeRect.height) / 2;
            pane.scrollTop += activeRect.top - paneRect.top - centered;
        }
    }

    window.addEventListener("pagehide", () => {
        const expandedItems = pane.querySelectorAll<HTMLElement>("#menu li.expanded[data-note-id]");
        const expanded = [ ...expandedItems ].map((item) => item.dataset.noteId);
        const state = { siteId, top: pane.scrollTop, expanded };
        try {
            sessionStorage.setItem(TREE_STATE_KEY, JSON.stringify(state));
        } catch {
            // The next page then starts from the server's expansion and the current note.
        }
    });
}

/** Expands the entries of the notes in `noteIds`, every clone of each, without animating. */
function expandItems(pane: HTMLElement, noteIds: string[]) {
    const ids = new Set(noteIds);
    pane.classList.add("tree-restoring");
    for (const item of pane.querySelectorAll<HTMLElement>("#menu li.submenu-item[data-note-id]")) {
        if (!item.dataset.noteId || !ids.has(item.dataset.noteId)) {
            continue;
        }
        item.classList.add("expanded");
        item.querySelector(":scope > * > .collapse-button")?.setAttribute("aria-expanded", "true");
    }
    // Applies the expanded styles while transitions are off, so the chevrons do not rotate.
    void pane.offsetHeight;
    pane.classList.remove("tree-restoring");
}

function readTreeState(): TreeState | null {
    try {
        const state = JSON.parse(sessionStorage.getItem(TREE_STATE_KEY) ?? "null");
        return state && { ...state, expanded: Array.isArray(state.expanded) ? state.expanded : [] };
    } catch {
        return null;
    }
}
