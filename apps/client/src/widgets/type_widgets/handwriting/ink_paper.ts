import { getPageTop, type InkLayout, PAGE_GAP, PAGE_HEIGHT, PAGE_WIDTH, type PaperStyle } from "./ink_document";

/** What the paper is drawn from: the note's paper and layout, the view and the theme's colors. */
export interface PaperScene {
    paper: PaperStyle;
    layout: InkLayout;
    pageCount: number;
    /** The device position of the world origin. */
    tx: number;
    ty: number;
    /** Device pixels per world unit. */
    scale: number;
    dpr: number;
    textColor: string;
    backgroundColor: string;
    /** The theme's `--note-list-view-content-background` around the pages, if it has one. */
    deskColor: string | undefined;
}

/**
 * The paper as Xournal++ draws it, in world units, which are pixels at 96 DPI: rules 24 pt apart
 * below a header of 80 pt and above a footer of 60 pt, and 5 mm squares, 42 across an A4 page.
 */
const RULED_STEP = 32;
const RULED_HEADER = 80 * 96 / 72;
const RULED_FOOTER = 60 * 96 / 72;
const GRID_STEP = PAGE_WIDTH / 42;
/** How close to the edge of a page a line of the grid or a dot can be, in world units. */
const PAPER_EDGE_CLEARANCE = 0.5;
/** The opacity of the paper's lines over the background, in the text color. */
const PAPER_LINE_ALPHA = 0.16;
/**
 * The opacity of the text color over the background around the pages, in a theme without a
 * `--note-list-view-content-background`, and along their edges.
 */
const DESK_ALPHA = 0.06;
const PAGE_EDGE_ALPHA = 0.18;

/**
 * Fills a rectangle of `ctx`, in device pixels, with the background and the paper: on pages, the
 * sheets on a tinted desk, with the paper's lines inside them.
 */
export function drawPaper(
    ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, scene: PaperScene
) {
    const { scale, tx, ty } = scene;
    ctx.fillStyle = scene.backgroundColor;
    ctx.fillRect(x, y, width, height);
    if (scene.layout === "infinite") {
        drawPattern(ctx, x, y, width, height, tx, ty, false, scene);
        return;
    }

    ctx.fillStyle = scene.deskColor ?? scene.textColor;
    ctx.globalAlpha = scene.deskColor ? 1 : DESK_ALPHA;
    ctx.fillRect(x, y, width, height);
    ctx.globalAlpha = 1;

    const edge = Math.max(1, Math.round(scene.dpr));
    const left = Math.round(tx);
    const right = Math.round(tx + PAGE_WIDTH * scale);
    if (right + edge <= x || left - edge >= x + width) return;

    const first = Math.max(0, Math.floor((y - ty) / scale / (PAGE_HEIGHT + PAGE_GAP)));
    for (let page = first; page < scene.pageCount; page++) {
        const top = Math.round(ty + getPageTop(page) * scale);
        const bottom = Math.round(ty + (getPageTop(page) + PAGE_HEIGHT) * scale);
        if (top - edge >= y + height) break;
        if (bottom + edge <= y) continue;

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.clip();
        ctx.fillStyle = scene.textColor;
        ctx.globalAlpha = PAGE_EDGE_ALPHA;
        ctx.fillRect(left - edge, top - edge, right - left + 2 * edge, bottom - top + 2 * edge);
        ctx.globalAlpha = 1;
        ctx.fillStyle = scene.backgroundColor;
        ctx.fillRect(left, top, right - left, bottom - top);

        const clipLeft = Math.max(x, left);
        const clipTop = Math.max(y, top);
        const clipRight = Math.min(x + width, right);
        const clipBottom = Math.min(y + height, bottom);
        if (clipRight > clipLeft && clipBottom > clipTop) {
            ctx.beginPath();
            ctx.rect(clipLeft, clipTop, clipRight - clipLeft, clipBottom - clipTop);
            ctx.clip();
            drawPattern(ctx, clipLeft, clipTop, clipRight - clipLeft, clipBottom - clipTop, left, top, true, scene);
        }
        ctx.restore();
    }
}

/**
 * Draws the paper's lines over a rectangle of `ctx`, in device pixels, from the device position
 * of the world point they start at. Each line is placed from the view's transform and rounded to
 * a whole device pixel on its own, so the lines stay sharp and in line with the strokes at any
 * zoom. On a `page`, the lines start from its top left corner and stay off its edges, and the
 * rules leave a header and a footer.
 */
function drawPattern(
    ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
    originX: number, originY: number, page: boolean, scene: PaperScene
) {
    if (scene.paper === "blank") return;
    const { scale } = scene;
    const thickness = Math.max(1, Math.round(scene.dpr));
    // The device positions of the lines at world `start + k * step` in `from`..`from + length`,
    // and between world `min` and `max`.
    const lines = (
        origin: number, from: number, length: number, start: number, step: number, min: number, max: number
    ) => {
        const positions: number[] = [];
        const first = Math.max(
            Math.ceil(((from - thickness - origin) / scale - start) / step),
            Math.ceil((min - start) / step)
        );
        for (let k = first; start + k * step <= max; k++) {
            const position = origin + (start + k * step) * scale;
            if (position >= from + length) break;
            positions.push(Math.round(position));
        }
        return positions;
    };
    const gridLines = (origin: number, from: number, length: number, pageLength: number) => page
        ? lines(origin, from, length, 0, GRID_STEP, PAPER_EDGE_CLEARANCE, pageLength - PAPER_EDGE_CLEARANCE)
        : lines(origin, from, length, 0, GRID_STEP, -Infinity, Infinity);

    ctx.fillStyle = scene.textColor;
    ctx.globalAlpha = PAPER_LINE_ALPHA;
    if (scene.paper === "ruled") {
        const rules = page
            ? lines(originY, y, height, RULED_HEADER, RULED_STEP, RULED_HEADER, PAGE_HEIGHT - RULED_FOOTER)
            : lines(originY, y, height, 0, RULED_STEP, -Infinity, Infinity);
        for (const py of rules) {
            ctx.fillRect(x, py, width, thickness);
        }
    } else if (scene.paper === "grid") {
        for (const py of gridLines(originY, y, height, PAGE_HEIGHT)) {
            ctx.fillRect(x, py, width, thickness);
        }
        for (const px of gridLines(originX, x, width, PAGE_WIDTH)) {
            ctx.fillRect(px, y, thickness, height);
        }
    } else {
        const dot = thickness * 2;
        const rows = gridLines(originY, y, height, PAGE_HEIGHT);
        for (const px of gridLines(originX, x, width, PAGE_WIDTH)) {
            for (const py of rows) {
                ctx.fillRect(px, py, dot, dot);
            }
        }
    }
    ctx.globalAlpha = 1;
}
