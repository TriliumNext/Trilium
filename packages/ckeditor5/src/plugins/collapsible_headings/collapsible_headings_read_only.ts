import "../../theme/collapsible_headings.css";

import { CLASSES as FOOTNOTE_CLASSES } from "../footnotes/constants.js";
import type HiddenBlocks from "../hidden_blocks.js";
import { getEditor } from "../tabs/tabs_read_only.js";
import { CLASSES, COLLAPSED_DATA_ATTRIBUTE } from "./constants.js";

/**
 * Makes the headings of `container`, saved content shown outside an editor, collapsible. The
 * sections of the headings saved as collapsed start hidden. A click on the arrow at the end of a
 * heading toggles it, and so do Enter and Space on a heading that Tab reaches. A toggle changes
 * classes only, so the saved state stays as it was.
 *
 * Returns a function that removes the listeners. The module imports only types from CKEditor.
 */
export function applyCollapsedHeadings(container: HTMLElement) {
    // A heading in a list item belongs to the list.
    const headings = [ ...container.querySelectorAll("h1, h2, h3, h4, h5, h6") ]
        .filter((heading) => (heading.parentElement as HTMLElement).tagName !== "LI");
    for (const heading of headings) {
        heading.classList.add(CLASSES.sectionHeading);
    }
    // The headings share the tab index of the container, so that Tab reaches them right after it.
    const tabIndex = String(Math.max(container.tabIndex, 0));
    const parents = new Set<Element>();
    for (const heading of headings) {
        const canCollapse = hasSection(heading);
        const isCollapsed = heading.getAttribute(COLLAPSED_DATA_ATTRIBUTE) === "true";
        heading.classList.toggle(CLASSES.collapsed, isCollapsed && canCollapse);
        if (canCollapse) {
            heading.setAttribute("tabindex", tabIndex);
        }
        parents.add(heading.parentElement as HTMLElement);
    }
    for (const parent of parents) {
        syncParent(parent);
    }

    let hovered: Element | null = null;
    const setHovered = (heading: Element | null, isOnArrow: boolean) => {
        if (hovered !== heading) {
            hovered?.classList.remove(CLASSES.hovered, CLASSES.arrowHovered);
            hovered = heading;
        }
        heading?.classList.add(CLASSES.hovered);
        heading?.classList.toggle(CLASSES.arrowHovered, isOnArrow);
    };
    const onMouseDown = (event: MouseEvent) => {
        // Keeps a press on the arrow from starting a text selection.
        if (getArrowHeading(event)) {
            event.preventDefault();
        }
    };
    const onClick = (event: MouseEvent) => {
        const heading = getArrowHeading(event);
        if (heading) {
            toggle(heading);
        }
    };
    const onKeyDown = (event: KeyboardEvent) => {
        const target = event.target as Element;
        const isToggleKey = (event.key === "Enter" || event.key === " ")
            && !event.ctrlKey && !event.altKey && !event.metaKey;
        if (isToggleKey && target.classList.contains(CLASSES.sectionHeading)) {
            // Keeps Space from scrolling the page.
            event.preventDefault();
            toggle(target);
        }
    };
    const onMouseMove = (event: MouseEvent) => {
        const heading = event.buttons === 0 ? getSectionHeading(event) : null;
        setHovered(heading, !!heading && isOnHeadingArrow(heading, event.clientX));
    };
    const onMouseLeave = () => setHovered(null, false);

    container.addEventListener("mousedown", onMouseDown);
    container.addEventListener("click", onClick);
    container.addEventListener("keydown", onKeyDown);
    container.addEventListener("mousemove", onMouseMove);
    container.addEventListener("mouseleave", onMouseLeave);
    return () => {
        container.removeEventListener("mousedown", onMouseDown);
        container.removeEventListener("click", onClick);
        container.removeEventListener("keydown", onKeyDown);
        container.removeEventListener("mousemove", onMouseMove);
        container.removeEventListener("mouseleave", onMouseLeave);
    };
}

/**
 * Expands every collapsed heading that hides `element`, at every level, in content that
 * {@link applyCollapsedHeadings} set up. Inside an editor, the editor shows the blocks for the
 * moment instead, without changing the note.
 */
export function revealCollapsedHeadings(element: Element) {
    const editor = getEditor(element);
    if (editor) {
        if (editor.plugins.has("HiddenBlocks")) {
            (editor.plugins.get("HiddenBlocks") as HiddenBlocks).revealAroundDomNode(element);
        }
        return;
    }

    const selector = `.${CLASSES.hidden}`;
    for (let hidden = element.closest(selector); hidden; hidden = element.closest(selector)) {
        const hider = hiders.get(hidden) as Element;
        hider.classList.remove(CLASSES.collapsed);
        syncParent(hider.parentElement as HTMLElement);
    }
}

/**
 * Whether the pointer at `clientX` over `heading` is on its arrow: in the padding at the end of
 * the heading, which keeps the text away from the arrow.
 */
export function isOnHeadingArrow(heading: Element, clientX: number) {
    const style = getComputedStyle(heading);
    const rect = heading.getBoundingClientRect();
    const padding = parseFloat(style.paddingInlineEnd);
    if (style.direction === "rtl") {
        const end = rect.left + parseFloat(style.borderLeftWidth);
        return clientX >= end && clientX <= end + padding;
    }
    const end = rect.right - parseFloat(style.borderRightWidth);
    return clientX >= end - padding && clientX <= end;
}

/** The heading that hides each hidden block. */
const hiders = new WeakMap<Element, Element>();

/** Collapses or expands `heading`. */
function toggle(heading: Element) {
    heading.classList.toggle(CLASSES.collapsed);
    syncParent(heading.parentElement as HTMLElement);
}

/** Hides the children of `parent` that collapsed headings hide, and shows the others. */
function syncParent(parent: Element) {
    let hider: Element | null = null;
    let hidingLevel = 0;
    for (const child of parent.children) {
        const level = getLevel(child);
        if (hider && endsSection(child, level, hidingLevel)) {
            hider = null;
        }
        child.classList.toggle(CLASSES.hidden, !!hider);
        if (hider) {
            hiders.set(child, hider);
        } else if (level !== null && child.classList.contains(CLASSES.collapsed)) {
            hider = child;
            hidingLevel = level;
        }
    }
}

/** The level of `element` when it is a heading that owns a section, else `null`. */
function getLevel(element: Element) {
    return element.classList.contains(CLASSES.sectionHeading) ? Number(element.tagName[1]) : null;
}

function endsSection(element: Element, level: number | null, sectionLevel: number) {
    return (level !== null && level <= sectionLevel)
        || element.classList.contains(FOOTNOTE_CLASSES.footnoteSection);
}

/** Whether `heading` has blocks under it. */
function hasSection(heading: Element) {
    const next = heading.nextElementSibling;
    return !!next && !endsSection(next, getLevel(next), Number(heading.tagName[1]));
}

/** The section heading under the pointer of `event`, when it has blocks to hide. */
function getSectionHeading(event: MouseEvent) {
    const heading = (event.target as Element).closest(`.${CLASSES.sectionHeading}`);
    return heading && hasSection(heading) ? heading : null;
}

/** The section heading whose arrow is under the pointer of `event`. */
function getArrowHeading(event: MouseEvent) {
    const heading = getSectionHeading(event);
    return heading && isOnHeadingArrow(heading, event.clientX) ? heading : null;
}
