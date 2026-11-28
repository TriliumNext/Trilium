import {
    AUTO_COLOR, type Bounds, getStrokePath, HIGHLIGHTER_ALPHA, type InkImage, type InkLayout, PAGE_HEIGHT,
    PAGE_WIDTH, type Stroke
} from "./ink_document";
import type { Picture } from "./ink_images";
import { drawTextBox, type MeasuredTextBox } from "./ink_text";

/** The largest size of a thumbnail, in pixels: a page fits it exactly. */
const MAX_WIDTH = 600;
const MAX_HEIGHT = Math.round(MAX_WIDTH * PAGE_HEIGHT / PAGE_WIDTH);
/** The space around the strokes of a canvas without bounds, in world units. */
const MARGIN = 16;
/** The ink that follows the theme, drawn dark and turned light by {@link DARK_FILTER}. */
const THUMBNAIL_AUTO_COLOR = "#000";
/** Matches `DRAWING_DARK_FILTER` of the canvas notes, so both pictures darken alike. */
const DARK_FILTER = "invert(93%) hue-rotate(180deg)";
/**
 * The format of a thumbnail that shows pictures, which a PNG would make several times heavier.
 * WebP keeps the transparency around them, and a browser that cannot write it writes a PNG.
 */
const PICTURE_TYPE = "image/webp";
const PICTURE_QUALITY = 0.85;

/** The strokes, the images and the text of the note that a thumbnail draws. */
export interface ThumbnailContent {
    getAll(): Iterable<Stroke>;
    /** Returns the strokes whose bounds intersect `bounds`, in drawing order. */
    query(bounds: Bounds): Stroke[];
    /** Returns the bounds of the first sheet, which is what the thumbnail of pages shows. */
    getFirstSheet(): Bounds;
    /** Returns the images in drawing order. */
    getImages(): InkImage[];
    /** Returns the picture of `image`, or `undefined` for one that is not loaded. */
    getPicture(image: InkImage): Picture | undefined;
    /** Resolves once the pictures of the images and of the background have loaded or failed. */
    whenImagesLoaded(): Promise<void>;
    /** Returns the picture under the images, such as the first page of a PDF, and where it lies. */
    getBackground?(): { picture: Picture, rect: { x: number, y: number, width: number, height: number } } | undefined;
    /**
     * Returns the text of the text boxes, as it is laid out now. With `within`, only the boxes
     * that can reach into it are asked for.
     */
    getTexts?(within?: Bounds): MeasuredTextBox[];
}

/** A picture of a thumbnail, and the version of the thumbnail that it shows. */
export interface ThumbnailExport {
    svg: string;
    version: number;
}

/**
 * The picture of a handwriting note that previews and image embeds show: the first page, or all
 * the strokes, the images and the text boxes of a canvas without bounds. A finished stroke is
 * drawn onto it at once, and a removed stroke, a stroke outside the area it shows or under a text
 * box, or a change to an image or a text box makes it draw everything again at the next export.
 */
export default class InkThumbnail {

    private canvas: HTMLCanvasElement | undefined;
    private ctx: CanvasRenderingContext2D | undefined;
    private layout: InkLayout = "pages";
    /** The part of the world that the canvas shows, or `undefined` while there are no strokes. */
    private area: Bounds | undefined;
    private isStale = true;
    /** The text boxes on the canvas, which lie over the ink. */
    private texts: MeasuredTextBox[] = [];
    /** Counts the changes to the picture; it is saved while `savedVersion` matches. */
    private version = 0;
    private savedVersion = 0;
    /** Counts the documents loaded, so that an export can tell it outlived its own. */
    private loads = 0;
    /** Whether the canvas holds the picture of an image, and not only ink. */
    private hasPictures = false;

    constructor(private content: ThumbnailContent) {}

    /** Starts over for a document just loaded, whose saved picture is taken to be current. */
    reset(layout: InkLayout) {
        this.layout = layout;
        this.isStale = true;
        this.savedVersion = this.version;
        this.loads++;
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
        } else if (this.texts.some((text) => intersects(text.bounds, stroke.bounds))) {
            this.isStale = true;
        } else {
            fillStroke(this.ctx, stroke);
        }
    }

    /**
     * Draws everything again at the next export, for `item`, a stroke, an image or a text box,
     * removed, added under the ink, changed or put back in its place.
     */
    markChanged(item: { bounds: Bounds }) {
        if (this.shows(item.bounds)) this.invalidate();
    }

    /**
     * Returns the picture as an SVG document, or `undefined` while the saved one is current or
     * once another document is loaded before the picture is ready.
     */
    async export(): Promise<ThumbnailExport | undefined> {
        if (!this.isChanged) return undefined;
        const { version, loads } = this;
        if (this.isStale) {
            await this.content.whenImagesLoaded();
            if (loads !== this.loads) return undefined;
            this.redraw();
        }
        const { canvas, area } = this;
        if (!canvas || !area || !canvas.width || !canvas.height) {
            return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>`, version };
        }

        const png = await toDataUrl(canvas, this.hasPictures ? PICTURE_TYPE : "image/png");
        if (loads !== this.loads) return undefined;
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
        return this.layout === "infinite" || intersects(this.content.getFirstSheet(), bounds);
    }

    private redraw() {
        this.isStale = false;
        const images = this.content.getImages();
        const firstSheet = this.layout === "pages" ? this.content.getFirstSheet() : undefined;
        const texts = this.content.getTexts?.(firstSheet) ?? [];
        const area = firstSheet ?? getContentArea([ ...this.content.getAll(), ...images, ...texts ]);
        this.area = area;
        this.texts = [];
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
        this.hasPictures = false;
        const background = this.content.getBackground?.();
        if (background) {
            const { x, y, width, height } = background.rect;
            ctx.drawImage(background.picture, x, y, width, height);
            this.hasPictures = true;
        }
        for (const image of images) {
            const picture = intersects(area, image.bounds) && this.content.getPicture(image);
            if (!picture) continue;
            ctx.drawImage(picture, image.x, image.y, image.width, image.height);
            this.hasPictures = true;
        }
        for (const stroke of this.content.query(area)) {
            fillStroke(ctx, stroke);
        }
        this.texts = texts.filter((text) => intersects(area, text.bounds));
        for (const text of this.texts) {
            drawTextBox(ctx, text, THUMBNAIL_AUTO_COLOR);
        }
    }
}

function fillStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
    ctx.globalAlpha = stroke.tool === "highlighter" ? HIGHLIGHTER_ALPHA : 1;
    ctx.fillStyle = stroke.color === AUTO_COLOR ? THUMBNAIL_AUTO_COLOR : stroke.color;
    ctx.fill(getStrokePath(stroke));
    ctx.globalAlpha = 1;
}

/** The bounds of all `items` with a margin around them, or `undefined` for no items. */
function getContentArea(items: Iterable<{ bounds: Bounds }>): Bounds | undefined {
    let area: Bounds | undefined;
    for (const { bounds } of items) {
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

/** Encodes `canvas` as a data URL of `type` without blocking the page, as `toDataURL()` would. */
function toDataUrl(canvas: HTMLCanvasElement, type: string) {
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
        }, type, PICTURE_QUALITY);
    });
}
