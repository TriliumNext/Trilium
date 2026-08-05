import "./icon_glyphs.css";

/**
 * Icons, for the places they have to leave the page behind.
 *
 * An icon is a class in the page (`bx bx-file`), and only the stylesheet knows what that stands for:
 * the icon pack's CSS sets a private-use character as the `content` of a pseudo-element and names the
 * font it is drawn from. Anywhere the browser is not doing the drawing for us — a canvas, an SVG that
 * will be read as a picture — both of those have to be asked for by hand, which is what this does.
 *
 * The font matters as much as the character: every pack numbers its icons from the same private-use
 * block, so the character alone says nothing about which icon it is. Reading the family back off the
 * element is what lets a user's own icon pack be drawn beside the built-in one.
 */

/** What an icon class stands for, once the stylesheet has been asked. */
export interface IconGlyph {
    /** The pack's font, as a CSS `font-family` value — ready to be put in a canvas `font`. */
    fontFamily: string;
    /** The character the pack draws the icon as. */
    content: string;
}

/**
 * What each of the given icon classes stands for, asked of the browser once per class.
 *
 * @param iconClasses the classes to resolve; repeats cost nothing.
 * @param host an element to hang the probe off, so that it is styled as its surroundings are.
 * @returns a glyph per class that draws one. A class no pack claims is simply absent.
 */
export function resolveIconGlyphs(iconClasses: Iterable<string>, host: HTMLElement = document.body) {
    const glyphs = new Map<string, IconGlyph>();
    const probe = document.createElement("span");
    probe.className = PROBE_CLASS;
    host.appendChild(probe);

    try {
        for (const iconClass of new Set(iconClasses)) {
            probe.className = `${PROBE_CLASS} ${iconClass}`;

            const glyph = readGlyph(probe);
            if (glyph) {
                glyphs.set(iconClass, glyph);
            }
        }
    } finally {
        probe.remove();
    }

    return glyphs;
}

/** The same for a single class, `null` where it draws no icon. See {@link resolveIconGlyphs}. */
export function resolveIconGlyph(iconClass: string, host?: HTMLElement): IconGlyph | null {
    return resolveIconGlyphs([ iconClass ], host).get(iconClass) ?? null;
}

/** The class the probe wears, which puts it out of sight while leaving it laid out (see the CSS). */
const PROBE_CLASS = "icon-glyph-probe";

/** What the stylesheet has made of the class the probe is wearing, or `null` if it draws nothing. */
function readGlyph(probe: Element): IconGlyph | null {
    const style = window.getComputedStyle(probe, "::before");

    // Quoted as it is written in the stylesheet — `"\ead5"` — or `none` for a class that draws no
    // icon at all.
    const content = style.content?.replace(/^["']|["']$/g, "");
    if (!content || content === "none") {
        return null;
    }

    // Without a font there is nothing to look the character up in, and a canvas told to draw in a
    // font of no name quietly keeps the one it had.
    const fontFamily = style.fontFamily;
    if (!fontFamily) {
        return null;
    }

    return { fontFamily, content };
}

/**
 * Waits for the fonts the given glyphs are drawn from to be available.
 *
 * A canvas asked to draw from a font it does not have yet says nothing about it and draws a row of
 * tofu instead — unlike the page, which redraws itself once the font arrives. Note that it is the
 * font's own arrival that is waited on here rather than `document.fonts.ready`, which promises only
 * that the loads already under way have finished: a pack nothing on screen happens to be wearing has
 * not begun loading at all, so waiting on the page would let it through undrawn.
 */
export async function loadIconFonts(glyphs: Iterable<IconGlyph>) {
    /** One character per font, which is all the browser needs to know which faces to fetch. */
    const fonts = new Map<string, string>();
    for (const { fontFamily, content } of glyphs) {
        fonts.set(fontFamily, content);
    }

    await Promise.all(Array.from(fonts, ([ fontFamily, content ]) => loadFont(fontFamily, content)));
}

/**
 * Waits for every icon pack's font, for a drawing that cannot say yet which of them it will need.
 *
 * Each pack names an icon of its own to be known by, so one class per pack is enough to find the
 * fonts without knowing how any of them are named.
 */
export function warmIconFonts(host?: HTMLElement) {
    const packIcons = (glob.iconRegistry?.sources ?? []).map((source) => source.icon);
    return loadIconFonts(resolveIconGlyphs(packIcons, host).values());
}

/** The size a font is asked for at; any valid one will do, the face being the same at every size. */
const FONT_LOAD_SIZE = 16;

async function loadFont(fontFamily: string, content: string) {
    try {
        await document.fonts?.load(`${FONT_LOAD_SIZE}px ${fontFamily}`, content);
    } catch {
        // Not being able to promise a font is no reason not to draw; at worst the icon is missing.
    }
}

/** How an icon is drawn. See {@link renderIconImage}. */
export interface IconImageOptions {
    /** The side of the square it is drawn in, in CSS pixels. */
    size: number;
    /** What it is drawn in — any CSS colour. */
    color?: string;
    /**
     * How many pixels of the drawing go to each CSS pixel. The display's own density by default,
     * which is what keeps an icon sharp where it is shown; a drawing that will be scaled up again
     * afterwards — a PNG rasterized from an SVG — asks for more.
     */
    scale?: number;
}

/**
 * An icon drawn as a picture of its own, as a `data:` URL, or `null` where it cannot be drawn.
 *
 * For wherever an icon has to stand without the stylesheet that draws it: a map library that takes a
 * picture per marker, an exported SVG that will be read as a picture and so may fetch nothing and
 * resolve no fonts of the page.
 *
 * What has been drawn once is kept, since the same handful of icons is asked for over and over — a
 * map is redrawn as it is panned, an SVG is written afresh at every pause in the editing. Failures
 * are kept alongside the rest: a class that draws nothing will not draw anything the second time
 * either, and asking again per frame would cost more than the answer is worth.
 */
export function renderIconImage(iconClass: string, options: IconImageOptions): Promise<string | null> {
    const { size, color = DEFAULT_ICON_COLOR, scale = devicePixelRatio() } = options;
    const key = `${size}|${scale}|${color}|${iconClass}`;

    let image = renderedIcons.get(key);
    if (!image) {
        image = drawIcon(iconClass, { size, color, scale });
        renderedIcons.set(key, image);
    }
    return image;
}

/** What an icon is drawn in unless it is asked for in something else. */
const DEFAULT_ICON_COLOR = "black";

/** What has already been drawn, by the icon and the terms it was drawn on. */
const renderedIcons = new Map<string, Promise<string | null>>();

async function drawIcon(iconClass: string, options: Required<IconImageOptions>) {
    const glyph = resolveIconGlyph(iconClass);
    if (!glyph) {
        return null;
    }

    await loadIconFonts([ glyph ]);
    return drawIconGlyph(glyph, options);
}

/**
 * Draws a glyph centred in a square, as a `data:` URL — the drawing {@link renderIconImage} keeps.
 *
 * The square is `size` CSS pixels across and `size * scale` pixels of actual drawing, the glyph being
 * written at the former into a canvas of the latter. Note that this is the only place the density is
 * applied: a caller that also scales the size it asks for pays for it twice over, and a drawing four
 * times the area it can show is carried in full by whatever ends up holding it.
 *
 * @returns the drawing, or `null` where the browser will not give a canvas to draw on.
 */
export function drawIconGlyph(glyph: IconGlyph, { size, color, scale }: Required<IconImageOptions>) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.max(1, Math.round(size * scale));

    const context = canvas.getContext("2d");
    if (!context) {
        return null;
    }

    context.scale(scale, scale);
    context.font = `${size}px ${glyph.fontFamily}`;
    context.fillStyle = color;

    // The glyph's own box goes in the middle, which is where the stylesheet puts it everywhere else
    // it is drawn. Measuring the ink and centring that instead is not portable: browsers do not
    // answer `actualBoundingBox*` alike, and the same icon came out pixels apart between them.
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(glyph.content, size / 2, size / 2);

    return canvas.toDataURL();
}

/** The display's density, as a number a drawing can be scaled by even where there is no window. */
function devicePixelRatio() {
    return window.devicePixelRatio || 1;
}
