import "./title_row.css";

/**
 * Shows the note's icon and title in the title row once the header's title scrolls under the top
 * bar, as the app's title row does, and gives the stylesheet the heights the panes keep clear of.
 */
export default function setupTitleRow() {
    const topBar = document.getElementById("top-bar");
    const row = document.getElementById("title-row");
    if (!topBar || !row) {
        return;
    }

    // A page without a note header, such as a PDF's, holds its title in the row itself.
    const header = document.getElementById("note-header");
    const title = header?.querySelector<HTMLElement>("#title");
    const rowTitle = row.querySelector(".title-row-title");
    const isFloating = row.classList.contains("floating");

    const update = () => {
        if (header && title) {
            const barBottom = topBar.getBoundingClientRect().bottom;
            const scrolledAway = title.getBoundingClientRect().bottom <= barBottom;
            row.classList.toggle("hide-title", !scrolledAway);
            header.classList.toggle("hidden", scrolledAway);
        }

        const rowHeight = isFloating ? row.offsetHeight : 0;
        const shownRowHeight = row.classList.contains("hide-title") ? 0 : rowHeight;
        const { style } = document.documentElement;
        style.setProperty("--top-bar-height", `${topBar.offsetHeight}px`);
        style.setProperty("--title-row-height", `${shownRowHeight}px`);
        style.setProperty("--top-bar-scrolled-height", `${topBar.offsetHeight + rowHeight}px`);
    };

    if (title && rowTitle) {
        title.addEventListener("input", () => {
            rowTitle.textContent = title.textContent;
        });
    }
    // The note scrolls in its own container on a wide screen, and the page on a narrow one.
    document.addEventListener("scroll", update, { capture: true, passive: true });
    new ResizeObserver(update).observe(topBar);
    update();
}
