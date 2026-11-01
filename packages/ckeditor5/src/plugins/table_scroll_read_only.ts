import {
    getScrollFadeClasses, SCROLL_FADE_CLASSES, type ScrollFadeState, type ScrollFadeWatch,
    watchScrollFade
} from "@triliumnext/commons/src/lib/scroll_fade.js";

/**
 * Sizes the tables of saved content in `container` the way `TriliumTableScroll` sizes them in the
 * editor. Each table at the top level of `container` or in its lists gets its width as
 * `--table-width`, with a percentage turned into a share of `--table-reference-width`, and
 * `table_scroll.css` lets a table wider than the content scroll sideways. The saved `width` stays
 * on the figure, so a copied table keeps it. `scroll_fade.css` fades the edges that a scrolling
 * table continues past.
 *
 * Returns a function that stops watching the tables for their fades. The module imports nothing
 * from CKEditor, so pages that only display content can load it.
 */
export function applyTableScroll(container: Element) {
    const selector = "figure.table:not(.layout-table)";
    const figures = [ ...container.querySelectorAll<HTMLElement>(selector) ]
        .filter((figure) => isScrollable(figure, container));
    for (const figure of figures) {
        figure.style.setProperty("--table-width", toReferenceWidth(figure.style.width));
    }

    // After every width is set, so that only the first measurement lays out the page.
    const started: [HTMLElement, ScrollFadeWatch][] = [];
    for (const figure of figures) {
        if (!fades.has(figure)) {
            const fade = fadeEdges(figure);
            fades.set(figure, fade);
            started.push([ figure, fade ]);
        }
    }

    return () => {
        for (const [ figure, fade ] of started.splice(0)) {
            fade.disconnect();
            fades.delete(figure);
        }
    };
}

/** The `scroll_fade.css` classes of a table in `state`, none while it fits. */
export function getTableFadeClasses(state: ScrollFadeState) {
    return state.overflow > 0 ? getScrollFadeClasses("horizontal", state) : [];
}

/** The fade of each figure, so that a second pass over the same content adds no watcher. */
const fades = new WeakMap<HTMLElement, ScrollFadeWatch>();

function fadeEdges(figure: HTMLElement) {
    return watchScrollFade(figure, (state) => {
        figure.classList.remove(...SCROLL_FADE_CLASSES);
        figure.classList.add(...getTableFadeClasses(state));
    }, { direction: "horizontal" });
}

/**
 * Whether `figure` is at the top level of `container` or in its lists, where the editor keeps
 * tables at the top level of the document.
 */
function isScrollable(figure: HTMLElement, container: Element) {
    for (let parent = figure.parentElement; parent !== container; parent = parent.parentElement) {
        if (!parent || !LIST_ELEMENTS.has(parent.tagName)) {
            return false;
        }
    }
    return true;
}

const LIST_ELEMENTS = new Set(["UL", "OL", "LI"]);

/** Converts the saved table `width` to a CSS width relative to `--table-reference-width`. */
function toReferenceWidth(width: string) {
    if (!width) {
        return "var(--table-reference-width, 100%)";
    }
    if (width.endsWith("%")) {
        return `calc(var(--table-reference-width, 100%) * ${parseFloat(width)} / 100)`;
    }
    return width;
}
