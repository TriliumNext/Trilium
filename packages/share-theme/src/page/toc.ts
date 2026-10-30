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

    // The ToC pane, and the copy in the navigation pane that narrow screens show instead.
    const tocs = [ ...document.querySelectorAll("#toc, .tree-toc") ];
    if (!tocs.length) return;

    const sections = [ ...document.querySelectorAll("#content .toc-anchor") ]
        .map((anchor) => anchor.parentElement)
        .filter((heading) => heading !== null);
    const linkLists = tocs.map((toc) => [ ...toc.querySelectorAll("a") ]);

    for (const link of linkLists.flat()) {
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

    const tocPane = document.getElementById("toc-pane");
    let activeIndex = -1;

    // Marks the entry of the last section scrolled under the top bar, whose height `title_row.ts`
    // gives, or the first entry above every section.
    const changeLinkState = () => {
        const { style } = document.documentElement;
        const limit = (parseFloat(style.getPropertyValue("--top-bar-scrolled-height")) || 0) + 50;
        let index = sections.length;
        while (--index > 0 && sections[index].getBoundingClientRect().top > limit) {
            // Walk back to the last section scrolled past.
        }
        if (index === activeIndex) return;
        activeIndex = index;

        for (const links of linkLists) {
            for (const [ linkIndex, link ] of links.entries()) {
                link.classList.toggle("active", linkIndex === index);
            }
        }

        const activeLink = tocPane?.querySelectorAll("a")[index];
        if (tocPane && activeLink) {
            keepInView(tocPane, activeLink);
        }
    };

    changeLinkState();
    // The note scrolls in its own container on a wide screen, and the page on a narrow one.
    document.addEventListener("scroll", changeLinkState, { capture: true, passive: true });
}

/**
 * Scrolls `pane` to put `entry` in its middle when the entry is not entirely visible. Only the pane
 * scrolls: `scrollIntoView()` would also move the page, which is scrolling already.
 */
function keepInView(pane: HTMLElement, entry: HTMLElement) {
    const paneRect = pane.getBoundingClientRect();
    const entryRect = entry.getBoundingClientRect();
    if (entryRect.top >= paneRect.top && entryRect.bottom <= paneRect.bottom) return;

    pane.scrollTop += entryRect.top - paneRect.top - (pane.clientHeight - entryRect.height) / 2;
}

/** How long a heading link shows its check mark after copying, in milliseconds. */
const COPIED_DURATION = 1500;

/**
 * Makes a click on the link of a heading put the address of its section in the location bar, in
 * place of the current one and without scrolling, and copy it, showing a check mark for a moment.
 * The address leaves out the `block` parameter of a block link, which would scroll to the block.
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
            const url = new URL(link.href);
            url.searchParams.delete("block");
            history.replaceState(history.state, "", url);
            navigator.clipboard?.writeText(url.href).then(() => {
                setCopied(true);
                clearTimeout(resetTimer);
                resetTimer = setTimeout(() => setCopied(false), COPIED_DURATION);
            }, () => undefined);
        });
    }
}
