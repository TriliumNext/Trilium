
export default function setupMobileMenu() {
    function closeMobileMenus() {
        document.body.classList.remove("menu-open");
        document.body.classList.remove("toc-open");
    }

    window.addEventListener("click", e => {
        const isMenuOpen = document.body.classList.contains("menu-open");
        const isTocOpen = document.body.classList.contains("toc-open");
        if (!isMenuOpen && !isTocOpen) return;

        const target = e.target as HTMLElement;

        // If the click was anywhere in the mobile nav or TOC, don't close
        if (target.closest("#left-pane")) return;
        if (target.closest("#toc-pane")) return;

        // If the click was on one of the toggle buttons, the button's own listener will handle it
        if (target.closest(".header-button")) return;

        return closeMobileMenus();
    });

}
