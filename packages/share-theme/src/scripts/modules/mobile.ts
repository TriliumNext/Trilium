import parents from "../common/parents.js";


export default function setupMobileMenu() {
    function closeMobileMenus() {
        document.body.classList.remove("menu-open");
        document.body.classList.remove("toc-open");
    }

    window.addEventListener("click", e => {
        const isMenuOpen = document.body.classList.contains("menu-open");
        const isTocOpen = document.body.classList.contains("toc-open");
        if (!isMenuOpen && !isTocOpen) return;

        // If the click was anywhere in the mobile nav or TOC, don't close
        if (parents(e.target as HTMLElement, "#left-pane").length) return;
        if (parents(e.target as HTMLElement, "#toc-pane").length) return;

        // If the click was on one of the toggle buttons, the button's own listener will handle it
        if (parents(e.target as HTMLElement, ".header-button").length) return;

        return closeMobileMenus();
    });

}
