/**
 * Whether a link preview's favicon can actually be seen where we draw it.
 *
 * A site draws its icon for one background, usually its own. GitHub's is a black octocat on nothing,
 * which disappears the moment a dark theme puts it on a dark surface; a mark drawn white for a dark
 * header disappears just as completely on a light one. Both are the same fault seen from two sides,
 * and both are measured here the same way — by asking how much of what the icon draws would stand
 * out against each surface.
 *
 * The measurement is a property of the icon alone, deliberately: it is taken once per icon, cached
 * for as long as the page lives, and expressed as a class the stylesheets act on. Measuring against
 * the *live* background would be a little more accurate and would have to be redone every time the
 * user switches theme, which is exactly the sort of thing a stylesheet does for free.
 */

export interface Rgb {
    r: number;
    g: number;
    b: number;
}

/**
 * The contrast a graphic needs against its background to be made out (WCAG 2.1 SC 1.4.11).
 *
 * The more familiar 4.5:1 is the threshold for *text*, and it is the wrong tool here: against a
 * near-black and a near-white surface the two failing bands overlap, so almost every icon would be
 * judged invisible against one or the other and get inverted somewhere. At 3:1 there is a
 * comfortable middle band that ordinary colourful icons sit in, and only the genuinely too-dark and
 * too-light ones are touched.
 */
export const MIN_ICON_CONTRAST_RATIO = 3;

/**
 * The surfaces an icon is judged against. Real themes differ, but a preview is always drawn on
 * something close to one of these two, and the error at the edges costs far less than making the
 * answer theme-dependent would (see the note at the top of this file).
 */
const DARK_SURFACE: Rgb = { r: 0x1e, g: 0x1e, b: 0x1e };
const LIGHT_SURFACE: Rgb = { r: 0xff, g: 0xff, b: 0xff };

/** An sRGB channel (0–255) as its linear-light value, per WCAG's definition of relative luminance. */
function toLinearChannel(value: number): number {
    const channel = value / 255;

    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance: how much light a colour puts out, 0 for black and 1 for white. */
export function relativeLuminance({ r, g, b }: Rgb): number {
    return 0.2126 * toLinearChannel(r) + 0.7152 * toLinearChannel(g) + 0.0722 * toLinearChannel(b);
}

/** WCAG contrast ratio between two relative luminances, from 1 (identical) to 21 (black on white). */
export function contrastRatio(one: number, other: number): number {
    const lighter = Math.max(one, other);
    const darker = Math.min(one, other);

    return (lighter + 0.05) / (darker + 0.05);
}

/** How much of an icon would be made out against each of the two surfaces. */
export interface FaviconVisibility {
    /** Share of what the icon draws that clears {@link MIN_ICON_CONTRAST_RATIO} on a dark surface. */
    onDark: number;
    /** The same against a light surface. */
    onLight: number;
    /** False when the icon draws nothing at all — a fully transparent bitmap, or one we could not read. */
    hasContent: boolean;
}

/**
 * How much of an icon shows, measured over its own pixels.
 *
 * Each pixel is weighted by how opaque it is, so the transparent field around a glyph counts for
 * nothing and a soft edge counts for part of itself. Working in shares rather than in an average
 * colour is what lets an icon that carries its own background answer for itself: a black tile with a
 * white glyph averages out very dark, yet the glyph is a fifth of what it draws and is perfectly
 * legible on a dark theme, so it is left alone where an average would have condemned it.
 */
export function summarizeFaviconVisibility(pixels: Uint8ClampedArray): FaviconVisibility {
    const darkSurface = relativeLuminance(DARK_SURFACE);
    const lightSurface = relativeLuminance(LIGHT_SURFACE);

    let drawn = 0;
    let visibleOnDark = 0;
    let visibleOnLight = 0;

    for (let i = 0; i + 3 < pixels.length; i += 4) {
        const alpha = pixels[i + 3] / 255;
        if (alpha === 0) {
            continue;
        }

        const luminance = relativeLuminance({ r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] });

        drawn += alpha;
        if (contrastRatio(luminance, darkSurface) >= MIN_ICON_CONTRAST_RATIO) {
            visibleOnDark += alpha;
        }
        if (contrastRatio(luminance, lightSurface) >= MIN_ICON_CONTRAST_RATIO) {
            visibleOnLight += alpha;
        }
    }

    if (drawn === 0) {
        return { onDark: 0, onLight: 0, hasContent: false };
    }

    return { onDark: visibleOnDark / drawn, onLight: visibleOnLight / drawn, hasContent: true };
}

/**
 * Which surface an icon needs help on: `dark` for one that fades into a dark theme, `light` for one
 * that fades into a light theme, `neutral` for one that holds its own on both.
 */
export type FaviconContrast = "dark" | "light" | "neutral";

/**
 * How much of an icon has to survive a surface for it to be left alone there.
 *
 * Not zero, because an icon is allowed a few stray pixels that happen to clear the threshold — a
 * black glyph with an anti-aliased edge or a single light speck is still a black glyph. But barely
 * above it, because the share is measured over the whole icon, and an icon that carries its own
 * background spends most of itself on that background: where the background is the surface's own
 * colour it counts as invisible here, though it is precisely what makes such an icon look right.
 *
 * Wikipedia's home-screen icon is the case that fixed the number — a thin dark W on a white tile,
 * of which the mark is 6% of what is drawn. It reads perfectly on a light theme, and at the seventh
 * this used to ask for it was condemned and inverted into a black square. An icon that genuinely
 * vanishes has no share at all to speak of: GitHub's octocat on a dark surface measures zero.
 */
const MIN_VISIBLE_SHARE = 0.04;

/** Reads {@link summarizeFaviconVisibility}'s measurement as the one decision the stylesheets need. */
export function classifyFaviconContrast(visibility: FaviconVisibility): FaviconContrast {
    if (!visibility.hasContent) {
        return "neutral";
    }

    if (visibility.onDark < MIN_VISIBLE_SHARE) {
        return "dark";
    }

    if (visibility.onLight < MIN_VISIBLE_SHARE) {
        return "light";
    }

    return "neutral";
}

/** The class an icon carries so the stylesheets can act on the measurement, or nothing for a neutral one. */
export function faviconContrastClass(contrast: FaviconContrast): string | undefined {
    return contrast === "neutral" ? undefined : `link-embed-favicon-${contrast}`;
}

/**
 * The square the icon is rasterised into to be measured. Well above the 16px it is drawn at, so a
 * thin glyph keeps enough pixels to weigh, and small enough that reading it back costs nothing.
 */
const SAMPLE_SIZE = 32;

/**
 * Measures a favicon that the browser has already loaded.
 *
 * Works off the rendered pixels rather than the file, which is what makes it indifferent to format:
 * by the time an `<img>` has loaded, an SVG, an ICO and a PNG are all just a bitmap the canvas can
 * read. It is also self-correcting for the icons that carry their own `prefers-color-scheme` rules,
 * since what we measure is the variant the browser chose to draw.
 *
 * Returns undefined when the icon cannot be measured, which the caller should read as "leave it
 * alone" rather than as any particular verdict.
 */
export function measureFaviconVisibility(image: CanvasImageSource): FaviconVisibility | undefined {
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
        return undefined;
    }

    try {
        // The destination size is given explicitly because an SVG that declares only a viewBox has no
        // intrinsic size at all, and reading naturalWidth for one answers 0 in some browsers. Drawing
        // into a fixed box sidesteps the question entirely.
        context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

        return summarizeFaviconVisibility(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
    } catch {
        // getImageData throws on a tainted canvas. A preview's pictures are always same-origin (see
        // isLocalPreviewImageSrc), so this should not happen — but an unreadable icon is a reason to
        // leave the icon as the site drew it, never a reason to fail the render around it.
        return undefined;
    }
}
