import { CLASSES } from "./constants.js";

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
 * The module imports nothing from CKEditor, so pages that only display content can load it.
 */
export function applyTabs(container: ParentNode, { placeholder }: ApplyTabsOptions) {
    for (const block of container.querySelectorAll<HTMLElement>(`.${CLASSES.tabs}`)) {
        if (appliedTabs.has(block)) {
            continue;
        }
        appliedTabs.add(block);

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

const appliedTabs = new WeakSet<HTMLElement>();
let lastTabId = 0;
