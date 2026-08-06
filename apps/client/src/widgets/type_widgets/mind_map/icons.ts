import { renderIconImage } from "../../../services/icon_glyphs";

/** Marks the icon moved ahead of a node's text, both to dress it and to know it has been moved. */
export const LEAD_ICON_CLASS = "mind-map-lead-icon";

/**
 * Dresses the node icons a map carries as Trilium icon classes, and sets the first of them ahead of
 * the node's text.
 *
 * Mind Elixir renders an icon as text — its topic renderer escapes what it is given and drops it
 * into a `<span>` — so a class such as `bx bx-star` arrives as those very words. Putting the class
 * onto the span the text landed in and emptying it leaves the icon pack's own CSS to draw it, the
 * same way an icon is drawn anywhere else in Trilium.
 *
 * Called for the whole map after every layout, which is what follows any change to a node.
 *
 * @param container the element holding the rendered nodes.
 * @returns whether anything was changed, and with it the width of the node it sits on — the class
 *          takes far more room as words than as the icon it becomes, so a caller that has measured
 *          the map has to measure it again.
 */
export function renderIconClasses(container: HTMLElement) {
    let changed = false;

    for (const iconEl of container.querySelectorAll<HTMLElement>(".icons > span")) {
        const iconClass = iconEl.textContent?.trim() ?? "";
        if (!isIconClass(iconClass)) continue;

        iconEl.className = iconClass;
        // Emptied down to an empty text node rather than to nothing at all: Mind Elixir's SVG
        // exporter reads `span.childNodes[0].textContent` for every icon it comes across, and a
        // span holding no children at all throws — which failed the save of any map with an icon,
        // the preview being rendered through that exporter.
        iconEl.replaceChildren(document.createTextNode(""));
        changed = true;
    }

    return leadWithFirstIcon(container) || changed;
}

/**
 * Moves the first icon of every node ahead of its text, where a note wears its own.
 *
 * Mind Elixir builds a topic in an order of its own — the icons after the text — and the parts of
 * it are laid inline, so there is no reordering them but by moving one. It is moved back on every
 * render of the node, and this runs after every one of those.
 *
 * The ones that follow stay where they are, which is also what keeps the exporter reading them: it
 * looks for the icons inside their wrapper, and what leaves it is not drawn there. That costs
 * nothing today, an exported map carrying no icon font to draw any of them with.
 */
function leadWithFirstIcon(container: HTMLElement) {
    let moved = false;

    for (const topic of container.querySelectorAll<HTMLElement>("me-tpc")) {
        // One already at the front is this same pass having run before, the node not having been
        // rendered since; moving again would take the second icon along with it.
        if (topic.querySelector(`:scope > .${LEAD_ICON_CLASS}`)) continue;

        const firstIcon = topic.querySelector<HTMLElement>(":scope > .icons > span");
        const text = topic.querySelector(":scope > .text");
        if (!firstIcon || !text) continue;

        firstIcon.classList.add(LEAD_ICON_CLASS);
        topic.insertBefore(firstIcon, text);
        moved = true;
    }

    return moved;
}

/**
 * Tells a Trilium icon class from an icon that came from elsewhere — a map made in another tool
 * carries emoji, which are icons in their own right and are left as they are.
 */
function isIconClass(text: string) {
    const [ prefix, name, ...rest ] = text.split(" ");
    return !rest.length && !!name && (glob.iconRegistry?.sources ?? []).some((source) => source.prefix === prefix);
}

/** An icon of the map as the exported SVG has to carry it. See {@link renderExportedIcons}. */
export interface ExportedIcon {
    /** Where it sits and how large, in the coordinates the exported map layers are drawn in. */
    x: number;
    y: number;
    size: number;
    /** What it is drawn in, which is the colour of the text it sits beside. */
    color: string;
    /** A drawing of the icon, as a `data:` URL — for an icon a pack draws out of a font. */
    image?: string;
    /** The character itself — for an icon that is one, an emoji off a map made elsewhere. */
    text?: string;
}

/**
 * Every icon the map wears, drawn as the exported SVG has to carry it.
 *
 * An icon is a class and a font, and an exported map is read as a picture: it may fetch nothing and
 * is given none of the page's fonts, so the class that draws the icon everywhere else draws nothing
 * at all there. Each is therefore drawn here into a picture of its own, which the SVG carries inside
 * it (see `export.ts`). The drawings are kept between exports, an icon being asked for again at every
 * pause in the editing.
 *
 * Note that the exporter itself already writes out the icons that follow a node's text, which are
 * left where they are: it finds them by their wrapper, and reads each as the text it holds. That
 * leaves two it cannot draw — an icon a pack draws, whose text is a class and whose class means
 * nothing to a picture, and the first icon of every node, which {@link renderIconClasses} moves out
 * of the wrapper the exporter looks in. Both are drawn afresh here; the exporter's own empty boxes
 * are left behind it, being invisible.
 */
export async function renderExportedIcons(nodes: HTMLElement): Promise<ExportedIcon[]> {
    const worn = nodes.querySelectorAll<HTMLElement>(`me-tpc > .${LEAD_ICON_CLASS}, me-tpc > .icons > span`);

    const drawn = await Promise.all(Array.from(worn, async (element) => {
        const placement = measureIcon(element, nodes);
        const iconClass = getIconClass(element);

        if (iconClass) {
            const image = await renderIconImage(iconClass, {
                size: ICON_RASTER_SIZE,
                color: placement.color,
                scale: 1
            });
            return (image ? { ...placement, image } : null);
        }

        // An icon that is a character of its own is already drawn wherever the exporter found it,
        // and the only one it did not find is the one moved ahead of the text.
        const text = element.textContent?.trim();
        return (text && element.classList.contains(LEAD_ICON_CLASS) ? { ...placement, text } : null);
    }));

    return drawn.filter((icon) => icon !== null);
}

/**
 * How large an icon is drawn, whatever size it is shown at: the drawing is carried in a square of
 * its own and scaled to each place it is stamped (see `export.ts`), so one drawing serves a node
 * whose text is small and another whose text is large. Comfortably larger than any icon is shown
 * at, so that it holds up both on a dense display and in a PNG export, which rasterizes the SVG at
 * a scale of its own — and a fixed size rather than the display's, so that the same map exports the
 * same picture wherever it is exported from.
 */
const ICON_RASTER_SIZE = 48;

/** The icon class an element was dressed with, or `null` for one carrying an icon of its own. */
function getIconClass(element: HTMLElement) {
    const iconClass = element.className.split(/\s+/)
        .filter((name) => name && name !== LEAD_ICON_CLASS)
        .join(" ");
    return iconClass || null;
}

/**
 * The square an icon is drawn in, in the coordinates the exported layers use.
 *
 * The icon is a character on a line of text, so the room it takes up is a line's — taller than it is
 * wide, and neither of them the size of the icon. What it is drawn at is the size of the text it is
 * set in, centred in the room it was given.
 */
function measureIcon(element: HTMLElement, nodes: HTMLElement) {
    const style = getComputedStyle(element);
    const size = Number.parseFloat(style.fontSize) || element.offsetHeight;
    const { offsetLeft, offsetTop } = offsetWithin(element, nodes);

    return {
        x: offsetLeft + (element.offsetWidth - size) / 2,
        y: offsetTop + (element.offsetHeight - size) / 2,
        size,
        color: style.color
    };
}

/**
 * Where an element sits within an ancestor, walked up the chain of offset parents as the exporter
 * walks it for everything else it writes out — so that what is measured here lands in the same
 * coordinates as the layers it is written into.
 */
function offsetWithin(element: HTMLElement, ancestor: HTMLElement) {
    let offsetLeft = 0;
    let offsetTop = 0;

    for (let node: HTMLElement | null = element; node && node !== ancestor; node = node.offsetParent as HTMLElement | null) {
        offsetLeft += node.offsetLeft;
        offsetTop += node.offsetTop;
    }

    return { offsetLeft, offsetTop };
}
