/** Marks the server-generated fonts stylesheet so it can be replaced when a font option changes. */
const FONT_STYLESHEET_ATTR = "data-font-stylesheet";

let version = 0;

/** Creates the (marked) fonts stylesheet link. Used both at boot and when re-applying fonts live. */
export function createFontStylesheetLink(): HTMLLinkElement {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    // A bumped query param busts the browser cache so the server regenerates the CSS from the latest options.
    link.href = version === 0 ? "api/fonts" : `api/fonts?v=${version}`;
    link.setAttribute(FONT_STYLESHEET_ATTR, "true");
    return link;
}

/**
 * Re-fetches the server-generated fonts stylesheet and swaps it in without reloading. The server returns an empty
 * stylesheet when font overrides are disabled, so this also correctly reverts to the theme defaults. The previous
 * stylesheet is removed only once the new one has loaded, keeping the swap free of a flash of unstyled content.
 */
export function applyFontsFromOptions() {
    version++;

    const oldLinks = Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[${FONT_STYLESHEET_ATTR}]`));
    const newLink = createFontStylesheetLink();

    const anchor = oldLinks.at(-1);
    if (anchor) {
        anchor.after(newLink);
    } else {
        document.head.appendChild(newLink);
    }

    newLink.addEventListener("load", () => {
        for (const oldLink of oldLinks) {
            oldLink.remove();
        }
    }, { once: true });
    // If the new stylesheet fails to load, keep the previous one rather than dropping fonts entirely.
    newLink.addEventListener("error", () => newLink.remove(), { once: true });
}

/** An installed font family, and whether it advances every character by the same width. */
export interface SystemFont {
    family: string;
    monospace: boolean;
}

/**
 * The fonts installed on this device, sorted by family, for the font picker to offer. Deduplicated
 * by family: `queryLocalFonts()` reports one entry per face, so a family with four weights arrives
 * four times.
 *
 * Empty wherever the runtime does not answer — the API is Chromium-only, needs a secure context, and
 * rejects while the `local-fonts` permission is denied. Callers fall back to the stock list, which is
 * what every runtime other than the desktop app gets.
 */
export async function listSystemFonts(): Promise<SystemFont[]> {
    if (typeof window.queryLocalFonts !== "function") {
        return [];
    }

    try {
        const faces = await window.queryLocalFonts();
        const families = [ ...new Set(faces.map(({ family }) => family)) ].sort((a, b) => a.localeCompare(b));
        const context = createProbeContext();

        // Nothing to draw on, so nothing is judged and nothing is told apart.
        if (!context) {
            return families.map((family) => ({ family, monospace: false }));
        }

        return families
            .filter((family) => rendersText(context, family))
            .map((family) => ({ family, monospace: isMonospace(context, family) }));
    } catch {
        return [];
    }
}

/**
 * One Latin and one CJK character, each drawn on its own. A character a family does not cover falls
 * back to one that does and paints, so a character that paints nothing can only be one the family
 * claims and cannot draw. Drawing them together would hide that: the covered one paints, and the
 * count says the family is fine.
 */
const PROBE_CHARACTERS = [ "A", "日" ];

/** Big enough that a light glyph still covers a pixel once it is rasterized. */
const PROBE_FONT_SIZE = 20;

/**
 * The families of `candidates` this device can render, for a list of guesses to be narrowed to what
 * is actually there. Everything is kept where there is no canvas to measure on.
 *
 * Used where the fonts cannot be enumerated outright — that is, everywhere but the desktop app, so
 * the stock list stops offering families the browser would only fall back from.
 */
export function filterAvailableFamilies(candidates: string[]): string[] {
    const context = createProbeContext();
    if (!context) {
        return candidates;
    }

    return candidates.filter((family) => isAvailable(context, family));
}

/**
 * A family name as it is named to CSS, whether in a stylesheet, a `style` attribute or a canvas
 * `font`. Unquoted, a name has to be a sequence of identifiers, so one beginning with a digit —
 * Windows ships `8514oem` — is invalid and takes the whole declaration with it. A name carrying a
 * quote would close the string early and leave the rest of it to be read as CSS.
 *
 * The generics are left alone: quoted, they stop naming a browser default and start asking for a
 * font that happens to be called "monospace".
 */
export function quoteFamily(family: string): string {
    if (!family || GENERIC_FAMILIES.has(family)) {
        return family;
    }

    return `"${family.replace(/[\\"]/g, "\\$&")}"`;
}

/** The keywords that name a browser default instead of a font, which only read as one unquoted. */
const GENERIC_FAMILIES = new Set([
    "serif", "sans-serif", "monospace", "cursive", "fantasy", "math", "emoji", "fangsong",
    "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded"
]);

/**
 * Whether naming `family` changes how text is laid out. Asked of each generic in turn, because a
 * family can share its metrics with one of them and still be present: Arial resolves to the same
 * face as the default sans-serif on a Linux box, so it measures identically against that one while
 * differing from serif and monospace.
 */
function isAvailable(context: CanvasRenderingContext2D, family: string): boolean {
    for (const fallback of FALLBACK_FAMILIES) {
        context.font = `${PROBE_FONT_SIZE}px ${fallback}`;
        const fellBack = context.measureText(AVAILABILITY_TEXT).width;

        context.font = `${PROBE_FONT_SIZE}px ${quoteFamily(family)}, ${fallback}`;
        if (context.measureText(AVAILABILITY_TEXT).width !== fellBack) {
            return true;
        }
    }

    return false;
}

/** The generics a candidate is measured against, one of which every fallback lands on. */
const FALLBACK_FAMILIES = [ "monospace", "serif", "sans-serif" ];

/** Wide and narrow letters together, so a family carrying its own metrics shifts the advance. */
const AVAILABILITY_TEXT = "mmmmmmmmmmlli";

/** The surface every family is drawn on, or `null` where the runtime offers no canvas. */
function createProbeContext() {
    const canvas = document.createElement("canvas");
    canvas.width = PROBE_FONT_SIZE * 2;
    canvas.height = PROBE_FONT_SIZE * 2;

    return canvas.getContext("2d", { willReadFrequently: true });
}

/**
 * Whether text set in `family` appears at all. A family can resolve, lend its metrics to the layout
 * and still draw nothing — GNU Unifont installs bitmap faces beside its outline one, and the name
 * matches a bitmap face that the engine measures but will not rasterize. Offering such a family
 * would let the interface be set in a font that leaves it correctly laid out and invisible.
 *
 * One `context` serves every family: each character is cleared before the next is drawn, and the
 * font is named again for each.
 */
function rendersText(context: CanvasRenderingContext2D, family: string): boolean {
    const { width, height } = context.canvas;

    for (const character of PROBE_CHARACTERS) {
        context.clearRect(0, 0, width, height);
        context.font = `${PROBE_FONT_SIZE}px ${quoteFamily(family)}`;
        context.fillText(character, 0, PROBE_FONT_SIZE * 1.5);

        if (!isAnythingPainted(context.getImageData(0, 0, width, height))) {
            return false;
        }
    }

    return true;
}

/**
 * Whether the family advances every character by the same width, compared at the narrowest and the
 * widest Latin letter. It is the one distinction a browser can draw between installed families:
 * nothing reports whether a face is serif or sans, so the picker groups by this alone.
 */
function isMonospace(context: CanvasRenderingContext2D, family: string): boolean {
    context.font = `${PROBE_FONT_SIZE}px ${quoteFamily(family)}`;

    return context.measureText("i").width === context.measureText("W").width;
}

/** Whether any pixel was covered, read from the alpha channel — the colour drawn in does not matter. */
function isAnythingPainted({ data }: ImageData): boolean {
    for (let offset = 3; offset < data.length; offset += 4) {
        if (data[offset] !== 0) {
            return true;
        }
    }

    return false;
}
