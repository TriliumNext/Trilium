const MOBILE_BREAKPOINT = 768; // 48em

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

export default function setupSidebars() {
    setupToggle("left-pane-toggle-button", "left-pane-collapsed", "menu-open", "toc-open");
    setupToggle("toc-pane-toggle-button", "toc-pane-collapsed", "toc-open", "menu-open");
}
