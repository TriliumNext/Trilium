import "./layout.css";

export default function setupLayout() {
    setupToggle("left-pane-toggle-button", "menu-open", "toc-open");
    setupToggle("toc-pane-toggle-button", "toc-open", "menu-open");

    // A listener on the backdrop itself, not on `window`: iOS Safari dispatches no `click` for a
    // tap on an element it does not consider clickable, and `window` listeners do not count.
    document.getElementById("mobile-backdrop")?.addEventListener("click", closeMobileMenus);

    // Going back to a page restored from the back/forward cache keeps the panel that was
    // open when the user tapped a link in it.
    window.addEventListener("pageshow", e => {
        if (e.persisted) closeMobileMenus();
    });

    keepNoteScroll();
}

export function closeMobileMenus() {
    document.body.classList.remove("menu-open");
    document.body.classList.remove("toc-open");
}

/** Makes a header button, shown on narrow screens only, slide its pane in or out. */
function setupToggle(buttonId: string, openClass: string, otherOpenClass: string) {
    document.getElementById(buttonId)?.addEventListener("click", () => {
        document.body.classList.toggle(openClass);
        document.body.classList.remove(otherOpenClass);
    });
}

const NOTE_SCROLL_KEY = "share-note-scroll";
/** The most pages whose place `keepNoteScroll` keeps. */
const MAX_NOTE_SCROLLS = 50;

/**
 * Keeps the note's place per page across a reload and a history return, as the browser does for
 * the window: on a wide screen the note scrolls in `#scrolling-container` instead.
 */
function keepNoteScroll() {
    const container = document.getElementById("scrolling-container");
    if (!container) {
        return;
    }

    const page = location.pathname + location.search;
    const timing = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
    const places = readNoteScrolls();
    if (timing?.type === "reload" || timing?.type === "back_forward") {
        container.scrollTop = places[page] ?? 0;
    }

    window.addEventListener("pagehide", () => {
        const kept = Object.entries(readNoteScrolls()).filter(([ key ]) => key !== page);
        kept.push([ page, container.scrollTop ]);
        try {
            sessionStorage.setItem(NOTE_SCROLL_KEY,
                JSON.stringify(Object.fromEntries(kept.slice(-MAX_NOTE_SCROLLS))));
        } catch {
            // The page then opens at the top.
        }
    });
}

function readNoteScrolls(): Record<string, number> {
    try {
        const stored = JSON.parse(sessionStorage.getItem(NOTE_SCROLL_KEY) ?? "{}") as unknown;
        return stored && typeof stored === "object" && !Array.isArray(stored)
            ? Object.fromEntries(Object.entries(stored)
                .filter((entry): entry is [ string, number ] => typeof entry[1] === "number"))
            : {};
    } catch {
        return {};
    }
}
