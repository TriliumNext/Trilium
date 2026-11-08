/**
 * The steps of a full-page screenshot that change the page:
 * - `first`, before the first capture, hides the scrollbars, turns off scroll snapping, pins sticky
 *   elements where they are in the page and hides the fixed elements that are not at the top of the
 *   viewport;
 * - `rest`, after the first capture, hides the fixed elements at the top too, so a header appears
 *   once, at the top of the screenshot;
 * - `restore` puts back every inline style the other steps changed.
 */
export type FloatingElementsStep = "first" | "rest" | "restore";

/** A fixed element covering this much of the viewport's width and height is a backdrop and stays. */
const BACKDROP_COVERAGE = 0.9;
/** How long changes are kept when the background script does not ask to restore them. */
const RESTORE_TIMEOUT_MS = 180_000;

const PINNED_STICKY: [ string, string ][] = [
    [ "position", "relative" ],
    [ "top", "auto" ],
    [ "right", "auto" ],
    [ "bottom", "auto" ],
    [ "left", "auto" ]
];
const HIDDEN: [ string, string ][] = [ [ "display", "none" ] ];

/**
 * Hides the page's scrollbars, which would otherwise be in every capture, and turns off scroll
 * snapping, which can move the page past the position asked for and leave rows uncaptured. The page
 * can still be scrolled. `scrollbar-width` is for Firefox and Chrome 121 or later,
 * `::-webkit-scrollbar` for older Chrome.
 */
const CAPTURE_CSS = `
    html, body { scrollbar-width: none !important; scroll-snap-type: none !important; }
    html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; }`;

interface SavedStyle {
    /** The element's `style` attribute before any change, or null when it had none. */
    attribute: string | null;
    /** `style.cssText` before any change, which is how the browser writes `attribute` back. */
    cssText: string;
    properties: Map<string, { value: string, priority: string }>;
}

const saved = new Map<HTMLElement, SavedStyle>();
let topFixedElements: HTMLElement[] = [];
let restoreTimer: ReturnType<typeof setTimeout> | undefined;
let captureStyle: HTMLStyleElement | undefined;

export function setFloatingElements(step: FloatingElementsStep) {
    if (step === "first") {
        restoreFloatingElements();
        prepareFirstCapture();
        restoreTimer = setTimeout(restoreFloatingElements, RESTORE_TIMEOUT_MS);
    } else if (step === "rest") {
        for (const element of topFixedElements) {
            override(element, HIDDEN);
        }
        topFixedElements = [];
    } else {
        restoreFloatingElements();
    }
}

function prepareFirstCapture() {
    captureStyle = document.createElement("style");
    captureStyle.textContent = CAPTURE_CSS;
    document.documentElement.append(captureStyle);

    for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
        const style = getComputedStyle(element);
        if (style.display === "none") continue;

        if (style.position === "sticky") {
            override(element, PINNED_STICKY);
        } else if (style.position === "fixed" && !isBackdrop(element)) {
            if (element.getBoundingClientRect().top < window.innerHeight / 2) {
                topFixedElements.push(element);
            } else {
                override(element, HIDDEN);
            }
        }
    }
}

function isBackdrop(element: HTMLElement) {
    const { width, height } = element.getBoundingClientRect();
    return width >= window.innerWidth * BACKDROP_COVERAGE
        && height >= window.innerHeight * BACKDROP_COVERAGE;
}

/**
 * Sets inline `!important` properties, first saving what the element had. Each element is changed
 * by one step only, so what is saved is always the page's own style.
 */
function override(element: HTMLElement, properties: [ string, string ][]) {
    const original: SavedStyle = {
        attribute: element.getAttribute("style"),
        cssText: element.style.cssText,
        properties: new Map()
    };
    for (const [ name, value ] of properties) {
        original.properties.set(name, {
            value: element.style.getPropertyValue(name),
            priority: element.style.getPropertyPriority(name)
        });
        element.style.setProperty(name, value, "important");
    }
    saved.set(element, original);
}

/**
 * Puts back each property that was changed, leaving the others as the page has them now. When the
 * page changed nothing else, the `style` attribute is also put back as the page wrote it, or
 * removed if it had none.
 */
function restoreFloatingElements() {
    clearTimeout(restoreTimer);
    restoreTimer = undefined;
    captureStyle?.remove();
    captureStyle = undefined;

    for (const [ element, original ] of saved) {
        for (const [ name, { value, priority } ] of original.properties) {
            if (value) {
                element.style.setProperty(name, value, priority);
            } else {
                element.style.removeProperty(name);
            }
        }
        if (element.style.cssText !== original.cssText) continue;
        if (original.attribute === null) {
            element.removeAttribute("style");
        } else {
            element.setAttribute("style", original.attribute);
        }
    }

    saved.clear();
    topFixedElements = [];
}
