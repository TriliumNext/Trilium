import "./layout.css";

const MOBILE_BREAKPOINT = 768; // 48em

export default function setupLayout() {
    setupToggle("left-pane-toggle-button", "left-pane-collapsed", "menu-open", "toc-open");
    setupToggle("toc-pane-toggle-button", "toc-pane-collapsed", "toc-open", "menu-open");

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

function setupToggle(buttonId: string, className: string, mobileClass: string, otherMobileClass: string) {
    const button = document.getElementById(buttonId);
    if (!button) return;

    button.addEventListener("click", () => {
        const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
        if (isMobile) {
            document.body.classList.toggle(mobileClass);
            document.body.classList.remove(otherMobileClass);
        } else {
            const isCollapsed = document.documentElement.classList.toggle(className);
            localStorage.setItem(className, String(isCollapsed));
        }
    });
}
