import { revealTab } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";

import { closeMobileMenus } from "./layout.js";
import "./toc.css";

/**
 * The ToC is now generated in the page template so
 * it even exists for users without client-side js
 * and that means it loads with the page so it avoids
 * all potential reshuffling or layout recalculations.
 *
 * So, all this function needs to do is make the links
 * perform smooth animation, and adjust the "active"
 * entry as the user scrolls.
 */
export default function setupToC() {
    const container = document.getElementById("right-pane");
    const toc = document.getElementById("toc");
    if (!toc || !container) return;

    // Get all relevant elements
    const sections = [ ...document.querySelectorAll("#content .toc-anchor") ]
        .map((anchor) => anchor.parentElement);
    const links = toc.querySelectorAll("a");

    // Setup smooth scroll on click
    for (const link of links) {
        link.addEventListener("click", e => {
            const target = document.getElementById(link.getAttribute("href")?.slice(1) ?? "");
            if (!target) return;
            e.preventDefault();
            e.stopPropagation();

            revealTab(target);
            target.scrollIntoView({behavior: "smooth"});
            closeMobileMenus();
        });
    }

    // Setup a moving "active" in the ToC that adjusts with the scroll state
    function changeLinkState() {
        let index = sections.length;

        // Work backwards to find the first matching section
        while (--index && container!.scrollTop + 50 < (sections[index] as HTMLElement).offsetTop) {} // eslint-disable-line no-empty

        // Update the "active" item in ToC
        links.forEach((link) => link.classList.remove("active"));
        links[index].classList.add("active");
    }

    // Initial render
    changeLinkState();
    container.addEventListener("scroll", changeLinkState);
}
