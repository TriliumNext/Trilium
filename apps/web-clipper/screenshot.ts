/** One capture of the visible part of a page, taken with the page scrolled to `y` CSS pixels. */
export interface ScreenshotSlice {
    dataUrl: string;
    y: number;
}

export interface StitchRequest {
    /** The height of the page to stitch, in CSS pixels. */
    pageHeight: number;
    /** The page's `devicePixelRatio`: the device pixels of a capture per CSS pixel, zoom included. */
    devicePixelRatio: number;
}

/** How the background script has the offscreen document stitch a screenshot, one step a message. */
export type StitchMessage =
    | { type: "STITCH_BEGIN", request: StitchRequest }
    | { type: "STITCH_ADD", slice: ScreenshotSlice }
    | { type: "STITCH_FINISH" }
    | { type: "STITCH_PART", index: number };

/**
 * The tallest image of a screenshot, in device pixels; a longer page is saved as several images.
 * Small enough for one image, as a PNG data URL, to fit in one extension message (64 MiB in Chrome).
 */
export const MAX_PART_HEIGHT = 8192;

/**
 * Draws the captures of a scrolled page, given in order from the top, into images of at most
 * {@link MAX_PART_HEIGHT}. Each image is encoded as soon as the next one begins, so only one is
 * held as pixels.
 */
export class ScreenshotStitcher {

    private width = 0;
    private readonly height: number;
    /** The device pixel row above which the captures have drawn the page. */
    private drawnTo = 0;
    private part: { index: number, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D } | undefined;
    private readonly parts: string[] = [];

    constructor(private readonly request: StitchRequest) {
        this.height = Math.round(request.pageHeight * request.devicePixelRatio);
    }

    async add({ dataUrl, y }: ScreenshotSlice) {
        const image = await loadImage(dataUrl);
        this.width ||= image.naturalWidth;

        const top = Math.round(y * this.request.devicePixelRatio);
        // An overlapping capture draws only the rows below `drawnTo`: only the first shows a fixed header.
        const start = Math.max(top, this.drawnTo);
        const bottom = Math.min(top + image.naturalHeight, this.height);
        for (let index = Math.floor(start / MAX_PART_HEIGHT); index * MAX_PART_HEIGHT < bottom; index++) {
            const from = Math.max(start, index * MAX_PART_HEIGHT);
            const rows = Math.min(bottom, (index + 1) * MAX_PART_HEIGHT) - from;
            this.openPart(index).drawImage(image,
                0, from - top, image.naturalWidth, rows,
                0, from - index * MAX_PART_HEIGHT, image.naturalWidth, rows);
        }
        this.drawnTo = Math.max(this.drawnTo, bottom);
    }

    /**
     * Returns the images as PNG data URLs, from the top of the page. The last one ends at the last
     * row captured, which is short of the page's height when the page stopped scrolling early.
     */
    finish() {
        if (!this.part) {
            throw new Error("There is no screenshot to stitch.");
        }
        const { canvas } = this.part;
        const rows = this.drawnTo - this.part.index * MAX_PART_HEIGHT;
        if (rows < canvas.height) {
            const cropped = createCanvas(canvas.width, rows);
            cropped.context.drawImage(canvas, 0, 0, canvas.width, rows, 0, 0, canvas.width, rows);
            this.closePart(cropped);
        } else {
            this.closePart(this.part);
        }
        return this.parts;
    }

    private openPart(index: number) {
        if (this.part?.index === index) return this.part.context;
        if (this.part) this.closePart(this.part);

        const height = Math.min(MAX_PART_HEIGHT, this.height - index * MAX_PART_HEIGHT);
        this.part = { index, ...createCanvas(this.width, height) };
        return this.part.context;
    }

    private closePart(part: { canvas: HTMLCanvasElement }) {
        this.parts.push(part.canvas.toDataURL("image/png"));
        this.part = undefined;
    }

}

function createCanvas(width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("The screenshot could not be drawn.");
    }
    return { canvas, context };
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("A part of the screenshot could not be read."));
        image.src = src;
    });
}
