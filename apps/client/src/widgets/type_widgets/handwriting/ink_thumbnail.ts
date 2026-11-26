import {
    AUTO_COLOR, type Bounds, getStrokePath, HIGHLIGHTER_ALPHA, type InkLayout, PAGE_HEIGHT, PAGE_WIDTH,
    type Stroke
} from "./ink_document";

/** The largest size of a thumbnail, in pixels: a page fits it exactly. */
const MAX_WIDTH = 600;
const MAX_HEIGHT = Math.round(MAX_WIDTH * PAGE_HEIGHT / PAGE_WIDTH);
/** The space around the strokes of a canvas without bounds, in world units. */
const MARGIN = 16;
/** The ink that follows the theme, drawn dark and turned light by {@link DARK_FILTER}. */
const THUMBNAIL_AUTO_COLOR = "#000";
/** Matches `DRAWING_DARK_FILTER` of the canvas notes, so both pictures darken alike. */
const DARK_FILTER = "invert(93%) hue-rotate(180deg)";
const FIRST_PAGE: Bounds = { minX: 0, minY: 0, maxX: PAGE_WIDTH, maxY: PAGE_HEIGHT };

/** The strokes of the note that a thumbnail draws. */
export interface ThumbnailStrokes {
    getAll(): Iterable<Stroke>;
    /** Returns the strokes whose bounds intersect `bounds`, in drawing order. */
    query(bounds: Bounds): Stroke[];
}

/** A picture of a thumbnail, and the version of the thumbnail that it shows. */
export interface ThumbnailExport {
    svg: string;
    version: number;
}

/**
 * The picture of a handwriting note that previews and image embeds show: the first page, or all
 * the strokes of a canvas without bounds. A finished stroke is drawn onto it at once, and a removed
 * stroke or a stroke outside the area it shows makes it draw all its strokes again at the next
 * export.
 */
export default class InkThumbnail {

    private canvas: HTMLCanvasElement | undefined;
    private ctx: CanvasRenderingContext2D | undefined;
    private layout: InkLayout = "pages";
    /** The part of the world that the canvas shows, or `undefined` while there are no strokes. */
    private area: Bounds | undefined;
    private isStale = true;
    /** Counts the changes to the picture; it is saved while `savedVersion` matches. */
    private version = 0;
    private savedVersion = 0;

    constructor(private strokes: ThumbnailStrokes) {}

    /** Starts over for a document just loaded, whose saved picture is taken to be current. */
    reset(layout: InkLayout) {
        this.layout = layout;
        this.isStale = true;
        this.savedVersion = this.version;
    }

    /** Whether the picture differs from the saved one. */
    get isChanged() {
        return this.version !== this.savedVersion;
    }

    /** Marks the picture as changed, as for a note whose picture was never saved. */
    invalidate() {
        this.isStale = true;
        this.version++;
    }

    setLayout(layout: InkLayout) {
        this.layout = layout;
        this.invalidate();
    }

    /** Draws `stroke`, just finished, over the others. */
    add(stroke: Stroke) {
        if (!this.shows(stroke.bounds)) return;
        this.version++;
        if (this.isStale || !this.ctx || !this.area) {
            this.isStale = true;
        } else if (this.layout === "infinite" && !contains(this.area, stroke.bounds)) {
            this.isStale = true;
        } else {
            fillStroke(this.ctx, stroke);
        }
    }

    /** Draws the strokes again at the next export, for `stroke` removed or put back in its place. */
    markChanged(stroke: Stroke) {
        if (this.shows(stroke.bounds)) this.invalidate();
    }

    /** Returns the picture as an SVG document, or `undefined` while the saved one is current. */
    async export(): Promise<ThumbnailExport | undefined> {
        if (!this.isChanged) return undefined;
        const version = this.version;
        if (this.isStale) this.redraw();
        const { canvas, area } = this;
        if (!canvas || !area || !canvas.width || !canvas.height) {
            return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>`, version };
        }

        const png = await toDataUrl(canvas);
        const { width, height } = canvas;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
            + `<style>@media (prefers-color-scheme: dark) { svg { filter: ${DARK_FILTER}; } }</style>`
            + `<image href="${png}" width="${width}" height="${height}"/></svg>`;
        return { svg, version };
    }

    /** Records that the picture of `version` was saved. */
    markSaved(version: number) {
        this.savedVersion = Math.max(this.savedVersion, version);
    }

    private shows(bounds: Bounds) {
        return this.layout === "infinite" || intersects(FIRST_PAGE, bounds);
    }

    private redraw() {
        this.isStale = false;
        const area = this.layout === "pages" ? FIRST_PAGE : getContentArea(this.strokes.getAll());
        this.area = area;
        if (!area) {
            if (this.canvas) this.canvas.width = this.canvas.height = 0;
            return;
        }

        const areaWidth = area.maxX - area.minX;
        const areaHeight = area.maxY - area.minY;
        const scale = Math.min(1, MAX_WIDTH / areaWidth, MAX_HEIGHT / areaHeight);
        this.canvas ??= document.createElement("canvas");
        // Setting the size clears the canvas and its transform.
        this.canvas.width = Math.ceil(areaWidth * scale);
        this.canvas.height = Math.ceil(areaHeight * scale);
        this.ctx ??= this.canvas.getContext("2d") ?? undefined;
        const ctx = this.ctx;
        if (!ctx) return;

        ctx.setTransform(scale, 0, 0, scale, -area.minX * scale, -area.minY * scale);
        for (const stroke of this.strokes.query(area)) {
            fillStroke(ctx, stroke);
        }
    }
}

function fillStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
    ctx.globalAlpha = stroke.tool === "highlighter" ? HIGHLIGHTER_ALPHA : 1;
    ctx.fillStyle = stroke.color === AUTO_COLOR ? THUMBNAIL_AUTO_COLOR : stroke.color;
    ctx.fill(getStrokePath(stroke));
    ctx.globalAlpha = 1;
}

/** The bounds of all `strokes` with a margin around them, or `undefined` for no strokes. */
function getContentArea(strokes: Iterable<Stroke>): Bounds | undefined {
    let area: Bounds | undefined;
    for (const { bounds } of strokes) {
        area = area
            ? {
                minX: Math.min(area.minX, bounds.minX), minY: Math.min(area.minY, bounds.minY),
                maxX: Math.max(area.maxX, bounds.maxX), maxY: Math.max(area.maxY, bounds.maxY)
            }
            : { ...bounds };
    }
    return area && {
        minX: area.minX - MARGIN, minY: area.minY - MARGIN,
        maxX: area.maxX + MARGIN, maxY: area.maxY + MARGIN
    };
}

function intersects(a: Bounds, b: Bounds) {
    return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

function contains(outer: Bounds, inner: Bounds) {
    return outer.minX <= inner.minX && outer.minY <= inner.minY
        && inner.maxX <= outer.maxX && inner.maxY <= outer.maxY;
}

/** Encodes `canvas` as a PNG data URL without blocking the page, as `toDataURL()` would. */
function toDataUrl(canvas: HTMLCanvasElement) {
    return new Promise<string>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("The thumbnail could not be encoded."));
                return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        }, "image/png");
    });
}
