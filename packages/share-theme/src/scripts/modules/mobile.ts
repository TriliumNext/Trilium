export default function setupMobileMenu() {
    // A listener on the backdrop itself, not on `window`: iOS Safari dispatches no `click` for a
    // tap on an element it does not consider clickable, and `window` listeners do not count.
    document.getElementById("mobile-backdrop")?.addEventListener("click", closeMobileMenus);
}

export function closeMobileMenus() {
    document.body.classList.remove("menu-open");
    document.body.classList.remove("toc-open");
}
