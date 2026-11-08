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

/**
 * The font families installed on this device, sorted, for the font picker to offer. Deduplicated
 * by family: `queryLocalFonts()` reports one entry per face, so a family with four weights arrives
 * four times.
 *
 * No family is drawn here, because drawing a family loads its font file, and loading every installed
 * one blocks the main thread for seconds where an antivirus scans each file. {@link rendersFamily}
 * checks the one family the user picks.
 *
 * Empty wherever the runtime does not answer — the API is Chromium-only, needs a secure context, and
 * rejects while the `local-fonts` permission is denied. Callers fall back to the stock list, which is
 * what every runtime other than the desktop app gets.
 *
 * The device is asked once per session, so a font installed meanwhile is listed after a reload.
 */
export function listSystemFonts(): Promise<string[]> {
    systemFamilies ??= querySystemFamilies();
    return systemFamilies;
}

/** The answer {@link listSystemFonts} gives for the session, once asked. */
let systemFamilies: Promise<string[]> | undefined;

async function querySystemFamilies(): Promise<string[]> {
    if (typeof window.queryLocalFonts !== "function") {
        return [];
    }

    try {
        const faces = await window.queryLocalFonts();
        return [ ...new Set(faces.map(({ family }) => family)) ].sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
}

/**
 * Whether text set in `family` appears at all, for a family to be checked before it is applied. A
 * family can resolve, lend its metrics to the layout and still draw nothing — GNU Unifont installs
 * bitmap faces beside its outline one, and the name matches a bitmap face that the engine measures
 * but will not rasterize. Applying such a family to the interface would leave it correctly laid out
 * and invisible, including the settings needed to undo it.
 *
 * Each family is drawn once per session. True where the runtime offers no canvas to draw on, an
 * answer that is not kept.
 */
export function rendersFamily(family: string): boolean {
    const known = renderedFamilies.get(family);
    if (known !== undefined) {
        return known;
    }

    const context = createProbeContext();
    if (!context) {
        return true;
    }

    const { width, height } = context.canvas;
    context.font = `${PROBE_FONT_SIZE}px ${quoteFamily(family)}`;
    context.fillText(PROBE_CHARACTER, 0, PROBE_FONT_SIZE * 1.5);

    const renders = isAnythingPainted(context.getImageData(0, 0, width, height));
    renderedFamilies.set(family, renders);
    return renders;
}

/** What {@link rendersFamily} found for each family drawn this session. */
const renderedFamilies = new Map<string, boolean>();

/** The character `rendersFamily()` draws to check that a family paints anything. */
const PROBE_CHARACTER = "A";

/** Big enough that a light glyph still covers a pixel once it is rasterized. */
const PROBE_FONT_SIZE = 20;

/**
 * The families of `candidates` this device can render, for a list of guesses to be narrowed to what
 * is actually there. Everything is kept where there is no canvas to measure on.
 *
 * Used where the fonts cannot be enumerated outright — that is, everywhere but the desktop app, so
 * the stock list stops offering families the browser would only fall back from.
 *
 * Each family is measured once per session, since measuring a family loads its font file.
 */
export function filterAvailableFamilies(candidates: string[]): string[] {
    const unmeasured = candidates.filter((family) => !availableFamilies.has(family));
    const context = unmeasured.length ? createProbeContext() : null;
    if (context) {
        for (const family of unmeasured) {
            availableFamilies.set(family, isAvailable(context, family));
        }
    }

    return candidates.filter((family) => availableFamilies.get(family) !== false);
}

/** What {@link filterAvailableFamilies} found for each family measured this session. */
const availableFamilies = new Map<string, boolean>();

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

/** The surface a family is drawn or measured on, or `null` where the runtime offers no canvas. */
function createProbeContext() {
    const canvas = document.createElement("canvas");
    canvas.width = PROBE_FONT_SIZE * 2;
    canvas.height = PROBE_FONT_SIZE * 2;

    return canvas.getContext("2d", { willReadFrequently: true });
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
