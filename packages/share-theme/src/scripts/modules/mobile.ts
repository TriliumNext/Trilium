import parents from "../common/parents.js";


export default function setupMobileMenu() {
    function toggleMobileMenu(event: MouseEvent) {
        event.stopPropagation(); // Don't prevent default for links

        const isOpen = document.body.classList.contains("menu-open");
        if (isOpen) return document.body.classList.remove("menu-open");
        return document.body.classList.add("menu-open");
    }

    const showMenuButton = document.getElementById("show-menu-button");
    showMenuButton?.addEventListener("click", toggleMobileMenu);

    window.addEventListener("click", e => {
        const isOpen = document.body.classList.contains("menu-open");
        if (!isOpen) return; // This listener is only to close

        // If the click was anywhere in  the mobile nav, don't close
        if (parents(e.target as HTMLElement, "#left-pane").length) return;
        return toggleMobileMenu(e);
    });

}
