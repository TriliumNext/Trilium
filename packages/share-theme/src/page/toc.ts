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
    setupHeadingLinks();

    const container = document.getElementById("right-pane");
    const toc = document.getElementById("toc");
    if (!toc || !container) return;

    const sections = [ ...document.querySelectorAll("#content .toc-anchor") ]
        .map((anchor) => anchor.parentElement)
        .filter((heading) => heading !== null);
    const links = [ ...toc.querySelectorAll("a") ];

    for (const link of links) {
        link.addEventListener("click", e => {
            const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
            if (!target) return;
            e.preventDefault();
            e.stopPropagation();

            revealTab(target);
            target.scrollIntoView({behavior: "smooth"});
            closeMobileMenus();
        });
    }

    // Marks the entry of the last section scrolled past, or the first entry above every section.
    const changeLinkState = () => {
        let index = sections.length;
        while (--index > 0 && container.scrollTop + 50 < sections[index].offsetTop) {
            // Walk back to the last section scrolled past.
        }

        for (const [ linkIndex, link ] of links.entries()) {
            link.classList.toggle("active", linkIndex === index);
        }
    };

    changeLinkState();
    container.addEventListener("scroll", changeLinkState);
}

/** How long a heading link shows its check mark after copying, in milliseconds. */
const COPIED_DURATION = 1500;

/**
 * Makes a click on the link of a heading put the address of its section in the location bar, in
 * place of the current one and without scrolling, and copy it, showing a check mark for a moment.
 * A click with a modifier key or another button than the main one is left to the browser.
 */
function setupHeadingLinks() {
    for (const link of document.querySelectorAll<HTMLAnchorElement>("#content .toc-anchor")) {
        let resetTimer: ReturnType<typeof setTimeout> | undefined;
        const setCopied = (copied: boolean) => {
            link.classList.toggle("copied", copied);
            const icon = link.querySelector(".tn-icon");
            icon?.classList.toggle("bx-link", !copied);
            icon?.classList.toggle("bx-check", copied);
        };

        link.addEventListener("click", (e) => {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
                return;
            }

            e.preventDefault();
            history.replaceState(history.state, "", link.href);
            navigator.clipboard?.writeText(link.href).then(() => {
                setCopied(true);
                clearTimeout(resetTimer);
                resetTimer = setTimeout(() => setCopied(false), COPIED_DURATION);
            }, () => undefined);
        });
    }
}
