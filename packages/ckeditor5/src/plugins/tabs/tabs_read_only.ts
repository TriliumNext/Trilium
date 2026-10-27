import type { Editor } from "ckeditor5";

import {
    attachScrollableBar, createScrollableBar, type ScrollableBar, type ScrollableBarLabels
} from "../scrollable_bar.js";
import { CLASSES } from "./constants.js";
import type TabsEditing from "./tabs_editing.js";

export interface ApplyTabsOptions {
    /** The text a title without text shows, the editor's "Tab title" placeholder. */
    placeholder: string;
    /** The labels of the buttons that scroll the titles, the editor's. */
    scrollLabels: ScrollableBarLabels;
}

/**
 * Turns the saved tabs blocks in `container` into working tabs outside the editor: the titles of
 * each block move into a scrollable title bar and the first tab shows. A click on a title, Enter or
 * Space shows that tab and scrolls its title into view. The arrow keys, Home and End move between
 * the titles of a block. A block that is already set up keeps its listeners and its active tab.
 *
 * Returns a function that stops the title bars that this call started. The module imports only
 * types from CKEditor, so pages that only display content can load it.
 */
export function applyTabs(container: ParentNode, { placeholder, scrollLabels }: ApplyTabsOptions) {
    const blocks = [...container.querySelectorAll<HTMLElement>(`.${CLASSES.tabs}`)];
    for (const block of blocks) {
        if (!tabsBlocks.has(block)) {
            setUpBlock(block, placeholder, scrollLabels);
        }
    }

    // After every block is built, so that only the first measurement lays out the page.
    const started: TabsBlock[] = [];
    for (const block of blocks) {
        const tabsBlock = tabsBlocks.get(block);
        if (tabsBlock && !tabsBlock.scrollableBar) {
            tabsBlock.scrollableBar = attachScrollableBar(tabsBlock.bar, tabsBlock.viewport);
            started.push(tabsBlock);
        }
    }

    return () => {
        for (const tabsBlock of started.splice(0)) {
            tabsBlock.scrollableBar?.disconnect();
            tabsBlock.scrollableBar = undefined;
        }
    };
}

/**
 * Shows every tab that encloses `element`, such as the one holding a find result, in blocks that
 * {@link applyTabs} set up. Inside an editor, `TabsEditing` shows the tabs instead, without moving
 * the selection.
 */
export function revealTab(element: Element) {
    const editor = getEditor(element);
    if (editor) {
        if (editor.plugins.has("TabsEditing")) {
            (editor.plugins.get("TabsEditing") as TabsEditing).showTabsAroundDomNode(element);
        }
        return;
    }

    // From the outermost tab, so that each title bar shows when it reveals its title.
    const tabs: Element[] = [];
    for (let tab = element.closest(`.${CLASSES.tab}`); tab;
        tab = tab.parentElement?.closest(`.${CLASSES.tab}`) ?? null) {
        tabs.unshift(tab);
    }
    for (const tab of tabs) {
        const block = tab.parentElement;
        const title = sectionTitles.get(tab);
        if (block && title) {
            tabsBlocks.get(block)?.activate(title);
        }
    }
}

/**
 * Returns the title of `section`, a saved tab, from the title bar where {@link applyTabs} moved it
 * or from the section itself.
 */
export function getTabTitle(section: Element): HTMLElement | null {
    return sectionTitles.get(section)
        ?? section.querySelector<HTMLElement>(`:scope > .${CLASSES.tabTitle}`);
}

/**
 * Returns the element that the URL fragment `hash` (`#id`, percent-encoded) names, after showing
 * every tab that encloses it, or `null` when no element has that ID.
 */
export function revealFragment(hash: string): Element | null {
    let id: string;
    try {
        id = decodeURIComponent(hash.slice(1));
    } catch {
        return null;
    }
    const target = id ? document.getElementById(id) : null;
    if (target) {
        revealTab(target);
    }
    return target;
}

/** Returns the editor whose editing view holds `element`; only the root editable carries it. */
function getEditor(element: Element): Editor | null {
    let editable: Element | null | undefined = element.closest(".ck-editor__editable");
    while (editable) {
        const editor = (editable as Element & { ckeditorInstance?: Editor | null }).ckeditorInstance;
        if (editor) {
            return editor;
        }
        editable = editable.parentElement?.closest(".ck-editor__editable");
    }
    return null;
}

interface TabsBlock {
    /** Shows the tab of `title` and scrolls the title into view. */
    activate(title: HTMLElement): void;
    bar: HTMLElement;
    viewport: HTMLElement;
    /** The title bar while it scrolls, between {@link applyTabs} and its returned function. */
    scrollableBar?: ScrollableBar;
}

/**
 * Moves the titles of `block` into a title bar at its start, links each title to its panel and
 * shows the first tab.
 */
function setUpBlock(block: HTMLElement, placeholder: string, scrollLabels: ScrollableBarLabels) {
    const tabs: { section: HTMLElement; title: HTMLElement; panel: HTMLElement }[] = [];
    for (const section of block.querySelectorAll<HTMLElement>(`:scope > .${CLASSES.tab}`)) {
        const title = section.querySelector<HTMLElement>(`:scope > .${CLASSES.tabTitle}`);
        const panel = section.querySelector<HTMLElement>(`:scope > .${CLASSES.tabPanel}`);
        if (title && panel) {
            tabs.push({ section, title, panel });
        }
    }
    if (!tabs.length) {
        return;
    }

    const { bar, viewport } = createScrollableBar(block.ownerDocument, scrollLabels);
    bar.classList.add(CLASSES.titleBar);
    for (const [index, { section, title, panel }] of tabs.entries()) {
        // CKEditor saves an empty title as `&nbsp;`.
        if (!title.textContent?.trim() && !title.querySelector(":not(br)")) {
            title.replaceChildren();
            title.dataset.placeholder = placeholder;
            title.setAttribute("aria-label", placeholder);
        }

        const id = `trilium-tab-view-${++lastTabId}`;
        title.id = `${id}-title`;
        title.tabIndex = 0;
        title.setAttribute("role", "button");
        title.setAttribute("aria-controls", `${id}-panel`);
        panel.id = `${id}-panel`;
        panel.setAttribute("role", "region");
        panel.setAttribute("aria-labelledby", title.id);

        // A printout puts each title back above its panel.
        title.style.setProperty(TAB_INDEX_PROPERTY, String(index));
        panel.style.setProperty(TAB_INDEX_PROPERTY, String(index));
        viewport.append(title);
        sectionTitles.set(section, title);
    }
    block.prepend(bar);

    const titles = tabs.map(({ title }) => title);
    const tabsBlock: TabsBlock = {
        bar,
        viewport,
        activate(activeTitle) {
            for (const { section, title } of tabs) {
                const isActive = title === activeTitle;
                section.classList.toggle(CLASSES.activeTab, isActive);
                title.classList.toggle(CLASSES.activeTitle, isActive);
                title.setAttribute("aria-expanded", String(isActive));
            }
            tabsBlock.scrollableBar?.reveal(activeTitle);
        }
    };
    tabsBlocks.set(block, tabsBlock);

    const focusAndActivate = (index: number) => {
        const title = titles[(index + titles.length) % titles.length];
        title.focus({ preventScroll: true });
        tabsBlock.activate(title);
    };
    for (const [index, title] of titles.entries()) {
        title.addEventListener("click", () => tabsBlock.activate(title));
        title.addEventListener("keydown", (e) => {
            const step = getComputedStyle(block).direction === "rtl" ? -1 : 1;
            switch (e.key) {
                case "Enter":
                case " ":
                    tabsBlock.activate(title);
                    break;
                case "ArrowRight":
                    focusAndActivate(index + step);
                    break;
                case "ArrowLeft":
                    focusAndActivate(index - step);
                    break;
                case "Home":
                    focusAndActivate(0);
                    break;
                case "End":
                    focusAndActivate(titles.length - 1);
                    break;
                default:
                    return;
            }
            e.preventDefault();
        });
    }
    tabsBlock.activate(titles[0]);
}

/** The CSS property with the position of a title and its panel in their block. */
const TAB_INDEX_PROPERTY = "--trilium-tab-index";

/** The blocks that {@link applyTabs} set up. */
const tabsBlocks = new WeakMap<HTMLElement, TabsBlock>();

/** The title of each tab that {@link applyTabs} moved into a title bar, keyed by its section. */
const sectionTitles = new WeakMap<Element, HTMLElement>();
let lastTabId = 0;
