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
                ul.style.height = "0";
            } else {
                // Expanding
                ul.style.height = "0";
                // Force reflow
                ul.offsetHeight;

                li.classList.add("expanded");
                ul.style.height = `${ul.scrollHeight}px`;
            }

            setTimeout(() => {
                ul.style.height = "";
                ul.style.overflow = "";
            }, 200);
        });
    }
}

const TREE_SCROLL_KEY = "share-tree-scroll";

/**
 * Keeps the navigation pane's scroll position across the pages of a site, which are separate
 * documents, and brings the current note into view when that position would hide it. The position
 * is kept per site, keyed by `data-ancestor-note-id`, in `sessionStorage`.
 */
export function setupTreeScroll() {
    const pane = document.getElementById("left-pane");
    if (!pane) {
        return;
    }
    const siteId = document.body.dataset.ancestorNoteId;

    const saved = readTreeScroll();
    if (saved && saved.siteId === siteId) {
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
        try {
            const position = JSON.stringify({ siteId, top: pane.scrollTop });
            sessionStorage.setItem(TREE_SCROLL_KEY, position);
        } catch {
            // The next page then starts from the current note.
        }
    });
}

function readTreeScroll(): { siteId: string; top: number } | null {
    try {
        return JSON.parse(sessionStorage.getItem(TREE_SCROLL_KEY) ?? "null");
    } catch {
        return null;
    }
}
