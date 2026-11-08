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
