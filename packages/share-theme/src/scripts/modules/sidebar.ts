export default function setupSidebars() {
    const splitPane = document.getElementById("split-pane");

    const leftToggle = document.getElementById("left-pane-toggle-button");
    const tocToggle = document.getElementById("toc-pane-toggle-button");

    if (leftToggle && splitPane) {
        leftToggle.addEventListener("click", () => {
            const isMobile = window.innerWidth <= 768; // 48em
            if (isMobile) {
                document.body.classList.toggle("menu-open");
                document.body.classList.remove("toc-open");
            } else {
                const isCollapsed = splitPane.classList.toggle("left-pane-collapsed");
                localStorage.setItem("left-pane-collapsed", isCollapsed ? "true" : "false");
            }
        });
    }

    if (tocToggle && splitPane) {
        tocToggle.addEventListener("click", () => {
            const isMobile = window.innerWidth <= 768; // 48em
            if (isMobile) {
                document.body.classList.toggle("toc-open");
                document.body.classList.remove("menu-open");
            } else {
                const isCollapsed = splitPane.classList.toggle("toc-pane-collapsed");
                localStorage.setItem("toc-pane-collapsed", isCollapsed ? "true" : "false");
            }
        });
    }
}
