import link from "../../../services/link";
import { randomString } from "../../../services/utils";

/** Fills the reference links in `container`, which shows content of `hostNoteId` if given. */
export async function applyReferenceLinks(
    container: HTMLDivElement | HTMLElement,
    hostNoteId?: string
) {
    const referenceLinks = container.querySelectorAll<HTMLDivElement>("a.reference-link");
    for (const referenceLink of referenceLinks) {
        await link.loadReferenceLinkTitle($(referenceLink), null, hostNoteId);

        // Wrap in a <span> to match the design while in CKEditor.
        const spanEl = document.createElement("span");
        spanEl.replaceChildren(...referenceLink.childNodes);
        referenceLink.replaceChildren(spanEl);
    }
}

/**
 * Turns the tabs blocks in `container` into working tabs: the first tab of each block shows, and
 * a click on a title, Enter or Space shows that tab. The arrow keys, Home and End move between
 * the titles of a block. A block that is already set up keeps its listeners and its active tab.
 */
export function applyTabs(container: HTMLElement) {
    for (const block of container.querySelectorAll<HTMLElement>(".trilium-tabs")) {
        if (appliedTabs.has(block)) {
            continue;
        }
        appliedTabs.add(block);

        const titles: HTMLElement[] = [];
        for (const tab of block.querySelectorAll<HTMLElement>(":scope > .trilium-tab")) {
            const title = tab.querySelector<HTMLElement>(":scope > .trilium-tab-title");
            const panel = tab.querySelector<HTMLElement>(":scope > .trilium-tab-panel");
            if (!title || !panel) {
                continue;
            }

            const id = `trilium-tab-${randomString(8)}`;
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
                title.parentElement?.classList.toggle("trilium-tab--active", isActive);
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
