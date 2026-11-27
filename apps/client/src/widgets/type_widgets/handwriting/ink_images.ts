import {
    type Bounds, boundsIntersect, createImage, getPageTop, type InkImage, type InkLayout, PAGE_GAP, PAGE_HEIGHT,
    PAGE_WIDTH
} from "./ink_document";

/** The corner of the selected image that a resize drags. */
export type ImageHandle = "nw" | "ne" | "sw" | "se";
const HANDLES: ImageHandle[] = [ "nw", "ne", "sw", "se" ];

/** The shortest side an image can be resized to, in world units. */
export const MIN_IMAGE_SIZE = 24;
/** How much of the view a new image fills at most on a canvas without bounds. */
const VIEW_FILL = 0.8;
/** The opacity of the text color that fills the place of an image not loaded yet, or not found. */
const PLACEHOLDER_ALPHA = 0.08;

/** The longest side of the copy of a picture that a dark theme shows, in pixels. */
const MAX_DARK_PICTURE_SIZE = 2048;

/** A decoded picture that a canvas can draw. */
export type Picture = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export interface ImageLayerHost {
    /** Loads the picture at `url`, or returns `undefined` when it cannot be shown. */
    loadImage(url: string): Promise<Picture | undefined>;
    toWorld(clientX: number, clientY: number): { x: number, y: number };
    /** The zoom, and the position of the world origin in the container, in CSS pixels. */
    getView(): { zoom: number, x: number, y: number };
    redrawBounds(bounds: Bounds): void;
    /** Called when a move or a resize ends, with the image as it was and as it is now. */
    onChange(before: InkImage, after: InkImage): void;
    onSelectionChange(): void;
}

interface Drag {
    /** The corner that resizes the image, or `undefined` for a move. */
    handle: ImageHandle | undefined;
    /** The image when the drag began, and as the drag last left it. */
    original: InkImage;
    current: InkImage;
    /** Where the drag began, in world units. */
    startX: number;
    startY: number;
}

/**
 * The images of a handwriting note, which `InkSurface` draws under the ink, and the selected one:
 * a box over the surface with a handle at each corner. A drag inside the box moves the image and a
 * drag of a handle resizes it, keeping its proportions.
 */
export default class ImageLayer {

    private images = new Set<InkImage>();
    /** The picture of each URL once loaded, or `null` for one that could not be. */
    private pictures = new Map<string, Picture | null>();
    /** The copy of each picture that a dark theme shows, made when first drawn. */
    private darkPictures = new Map<string, Picture>();
    private loading = new Map<string, Promise<void>>();
    private box: HTMLElement;
    private selected: InkImage | undefined;
    private drag: Drag | undefined;
    /** Where the pointer of the drag is, in world units, until the next animation frame applies it. */
    private pendingPoint: { x: number, y: number } | undefined;
    private dragFrame: number | undefined;

    constructor(container: HTMLElement, private host: ImageLayerHost) {
        this.box = document.createElement("div");
        this.box.className = "handwriting-image-box";
        this.box.hidden = true;
        for (const handle of HANDLES) {
            const element = document.createElement("div");
            element.className = "handwriting-image-handle";
            element.dataset.handle = handle;
            this.box.append(element);
        }
        container.append(this.box);
    }

    destroy() {
        if (this.dragFrame !== undefined) cancelAnimationFrame(this.dragFrame);
        this.box.remove();
    }

    /** Replaces the images with those of a document just loaded. */
    load(images: InkImage[]) {
        this.cancel();
        for (const [ url, picture ] of this.pictures) {
            if (!picture) this.pictures.delete(url);
        }
        this.images = new Set(images);
        this.select(undefined);
        for (const image of images) {
            this.request(image);
        }
    }

    /** The images in drawing order. */
    getAll() {
        return [ ...this.images ].sort((a, b) => a.order - b.order);
    }

    get size() {
        return this.images.size;
    }

    get selection() {
        return this.selected;
    }

    /** Whether a drag is moving or resizing an image. */
    get isDragging() {
        return !!this.drag;
    }

    add(image: InkImage) {
        this.images.add(image);
        this.request(image);
        this.host.redrawBounds(image.bounds);
    }

    remove(image: InkImage) {
        if (!this.images.delete(image)) return;
        if (this.selected === image) this.select(undefined);
        this.host.redrawBounds(image.bounds);
    }

    /** Resolves once every picture requested so far has loaded or failed. */
    async whenLoaded() {
        await Promise.all(this.loading.values());
    }

    /** The picture of `image` once loaded, or with `dark`, its copy for a dark theme. */
    getPicture(image: InkImage, dark = false) {
        const picture = this.pictures.get(image.url) ?? undefined;
        if (!picture || !dark) return picture;
        let darkPicture = this.darkPictures.get(image.url);
        if (!darkPicture) {
            darkPicture = darkenPicture(picture);
            this.darkPictures.set(image.url, darkPicture);
        }
        return darkPicture;
    }

    /**
     * Draws the images that intersect `bounds` on `ctx`, which is in world units, with `dark` as
     * a dark theme shows them. An image without a picture is a rectangle of `placeholderColor`.
     */
    draw(ctx: CanvasRenderingContext2D, bounds: Bounds, placeholderColor: string, dark: boolean) {
        if (!this.images.size) return;
        for (const image of this.getAll()) {
            if (!boundsIntersect(image.bounds, bounds)) continue;
            const picture = this.getPicture(image, dark);
            if (picture) {
                ctx.imageSmoothingQuality = "high";
                ctx.drawImage(picture, image.x, image.y, image.width, image.height);
            } else {
                ctx.globalAlpha = PLACEHOLDER_ALPHA;
                ctx.fillStyle = placeholderColor;
                ctx.fillRect(image.x, image.y, image.width, image.height);
                ctx.globalAlpha = 1;
            }
        }
    }

    select(image: InkImage | undefined) {
        if (image === this.selected) return;
        this.selected = image;
        this.updateBox();
        this.host.onSelectionChange();
    }

    /**
     * Starts a drag for the pointer of `e`: a resize on a handle of the selected image, and a move
     * on an image, which it selects. Returns `false` for a pointer on no image, which clears the
     * selection.
     */
    begin(e: PointerEvent) {
        const target = e.target instanceof HTMLElement ? e.target : undefined;
        const handle = HANDLES.find((name) => name === target?.dataset.handle);
        const point = this.host.toWorld(e.clientX, e.clientY);
        const image = handle && this.selected ? this.selected : this.hit(point.x, point.y);
        this.select(image);
        if (!image) return false;
        this.drag = { handle, original: image, current: image, startX: point.x, startY: point.y };
        return true;
    }

    move(e: PointerEvent) {
        if (!this.drag) return;
        this.pendingPoint = this.host.toWorld(e.clientX, e.clientY);
        this.dragFrame ??= requestAnimationFrame(() => {
            this.dragFrame = undefined;
            this.applyDrag();
        });
    }

    /** Ends the drag, keeping the image where it is. */
    end() {
        if (!this.drag) return;
        this.applyDrag();
        const { original, current } = this.drag;
        this.drag = undefined;
        if (current !== original) this.host.onChange(original, current);
    }

    /** Ends the drag, putting the image back as it was. */
    cancel() {
        if (!this.drag) return;
        this.clearDragFrame();
        const { original, current } = this.drag;
        this.drag = undefined;
        this.replace(current, original);
    }

    /** Places the box of the selected image over it in the current view. */
    updateBox() {
        const image = this.selected;
        this.box.hidden = !image;
        if (!image) return;
        const { zoom, x, y } = this.host.getView();
        this.box.style.left = `${image.x * zoom + x}px`;
        this.box.style.top = `${image.y * zoom + y}px`;
        this.box.style.width = `${image.width * zoom}px`;
        this.box.style.height = `${image.height * zoom}px`;
    }

    /** The topmost image at a point, in world units. */
    private hit(x: number, y: number) {
        return this.getAll().reverse().find(({ bounds }) =>
            x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY);
    }

    private applyDrag() {
        this.clearDragFrame();
        const { drag, pendingPoint: point } = this;
        this.pendingPoint = undefined;
        if (!drag || !point) return;
        const { original, handle } = drag;
        const next = handle
            ? resizeImage(original, handle, point.x, point.y)
            : createImage({ ...original, x: original.x + point.x - drag.startX, y: original.y + point.y - drag.startY });
        this.replace(drag.current, next);
        drag.current = next;
    }

    private clearDragFrame() {
        if (this.dragFrame !== undefined) cancelAnimationFrame(this.dragFrame);
        this.dragFrame = undefined;
    }

    /** Puts `next` in the place of `image`, keeping it selected. */
    private replace(image: InkImage, next: InkImage) {
        if (image === next) return;
        this.images.delete(image);
        this.images.add(next);
        if (this.selected === image) {
            this.selected = next;
            this.updateBox();
        }
        this.host.redrawBounds(image.bounds);
        this.host.redrawBounds(next.bounds);
    }

    private request({ url }: InkImage) {
        if (this.pictures.has(url) || this.loading.has(url)) return;
        const load = this.host.loadImage(url)
            .catch(() => undefined)
            .then((picture) => {
                this.loading.delete(url);
                this.pictures.set(url, picture ?? null);
                if (!picture) return;
                for (const image of this.images) {
                    if (image.url === url) this.host.redrawBounds(image.bounds);
                }
            });
        this.loading.set(url, load);
    }
}

/**
 * Returns a copy of `picture` as a dark theme shows it: with the same `invert(93%)
 * hue-rotate(180deg)` that turns the thumbnail of a note dark (`DARK_FILTER` in ink_thumbnail.ts),
 * so that a white sheet with dark print becomes a dark one with light print, under ink that is
 * light too. The filter is computed here because Safari's canvas has no `filter`. Returns
 * `picture` itself when its pixels cannot be read.
 */
export function darkenPicture(picture: Picture): Picture {
    const naturalWidth = "naturalWidth" in picture ? picture.naturalWidth : picture.width;
    const naturalHeight = "naturalHeight" in picture ? picture.naturalHeight : picture.height;
    const scale = Math.min(1, MAX_DARK_PICTURE_SIZE / Math.max(naturalWidth, naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(naturalHeight * scale));
    try {
        const ctx = canvas.getContext("2d");
        if (!ctx) return picture;
        ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (!pixels) return picture;
        const { data } = pixels;
        for (let i = 0; i < data.length; i += 4) {
            const r = 237.15 - 0.86 * data[i];
            const g = 237.15 - 0.86 * data[i + 1];
            const b = 237.15 - 0.86 * data[i + 2];
            // `Uint8ClampedArray` rounds and clamps what the hue rotation gives.
            data[i] = -0.574 * r + 1.43 * g + 0.144 * b;
            data[i + 1] = 0.426 * r + 0.43 * g + 0.144 * b;
            data[i + 2] = 0.426 * r + 1.43 * g - 0.856 * b;
        }
        ctx.putImageData(pixels, 0, 0);
        return canvas;
    } catch {
        return picture;
    }
}

/**
 * Returns `image` resized by dragging its `handle` corner to a point, in world units. The opposite
 * corner stays in place and the image keeps its proportions, following the pointer along the axis
 * on which it went farther.
 */
export function resizeImage(image: InkImage, handle: ImageHandle, x: number, y: number): InkImage {
    const isWest = handle.endsWith("w");
    const isNorth = handle.startsWith("n");
    const anchorX = isWest ? image.x + image.width : image.x;
    const anchorY = isNorth ? image.y + image.height : image.y;
    const smallest = MIN_IMAGE_SIZE / Math.min(image.width, image.height);
    const scale = Math.max(smallest, Math.abs(x - anchorX) / image.width, Math.abs(y - anchorY) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    return createImage({
        ...image,
        x: isWest ? anchorX - width : anchorX,
        y: isNorth ? anchorY - height : anchorY,
        width,
        height
    });
}

/** The part of the world on screen: its middle and its size, in world units. */
export interface VisibleArea {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Returns where a new picture of `naturalWidth` by `naturalHeight` pixels goes: around the middle
 * of the view, at its own size or smaller. On pages, it fits inside the page at the middle of the
 * view, and on a canvas without bounds, in most of the view.
 */
export function placeImage(naturalWidth: number, naturalHeight: number, visible: VisibleArea, layout: InkLayout) {
    const maxWidth = layout === "pages" ? PAGE_WIDTH : visible.width * VIEW_FILL;
    const maxHeight = layout === "pages" ? PAGE_HEIGHT : visible.height * VIEW_FILL;
    const scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    let x = visible.x - width / 2;
    let y = visible.y - height / 2;
    if (layout === "pages") {
        const page = Math.max(0, Math.floor(visible.y / (PAGE_HEIGHT + PAGE_GAP)));
        const top = getPageTop(page);
        x = Math.min(PAGE_WIDTH - width, Math.max(0, x));
        y = Math.min(top + PAGE_HEIGHT - height, Math.max(top, y));
    }
    return { x, y, width, height };
}
