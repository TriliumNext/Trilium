import type { Editor } from "ckeditor5";

import { CLASSES } from "./constants.js";
import type TabsEditing from "./tabs_editing.js";

export interface ApplyTabsOptions {
    /** The text a title without text shows, the editor's "Tab title" placeholder. */
    placeholder: string;
}

/**
 * Turns the saved tabs blocks in `container` into working tabs outside the editor: the first tab
 * of each block shows, and a click on a title, Enter or Space shows that tab. The arrow keys, Home
 * and End move between the titles of a block. A block that is already set up keeps its listeners
 * and its active tab.
 *
 * The module imports only types from CKEditor, so pages that only display content can load it.
 */
export function applyTabs(container: ParentNode, { placeholder }: ApplyTabsOptions) {
    for (const block of container.querySelectorAll<HTMLElement>(`.${CLASSES.tabs}`)) {
        if (activators.has(block)) {
            continue;
        }

        const titles: HTMLElement[] = [];
        for (const tab of block.querySelectorAll<HTMLElement>(`:scope > .${CLASSES.tab}`)) {
            const title = tab.querySelector<HTMLElement>(`:scope > .${CLASSES.tabTitle}`);
            const panel = tab.querySelector<HTMLElement>(`:scope > .${CLASSES.tabPanel}`);
            if (!title || !panel) {
                continue;
            }

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
            titles.push(title);
        }
        if (!titles.length) {
            continue;
        }

        const activate = (activeTitle: HTMLElement) => {
            for (const title of titles) {
                const isActive = title === activeTitle;
                title.parentElement?.classList.toggle(CLASSES.activeTab, isActive);
                title.setAttribute("aria-expanded", String(isActive));
            }
        };
        activators.set(block, activate);
        const focusAndActivate = (index: number) => {
            const title = titles[(index + titles.length) % titles.length];
            title.focus();
            activate(title);
        };

        for (const [index, title] of titles.entries()) {
            title.addEventListener("click", () => activate(title));
            title.addEventListener("keydown", (e) => {
                const step = getComputedStyle(block).direction === "rtl" ? -1 : 1;
                switch (e.key) {
                    case "Enter":
                    case " ":
                        activate(title);
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
        activate(titles[0]);
    }
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

    let tab = element.closest(`.${CLASSES.tab}`);
    while (tab) {
        const block = tab.parentElement;
        const title = tab.querySelector<HTMLElement>(`:scope > .${CLASSES.tabTitle}`);
        if (block && title) {
            activators.get(block)?.(title);
        }
        tab = block?.closest(`.${CLASSES.tab}`) ?? null;
    }
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

/** Shows the tab of the given title, keyed by the tabs block that {@link applyTabs} set up. */
const activators = new WeakMap<HTMLElement, (title: HTMLElement) => void>();
let lastTabId = 0;
