/**
 * View orientation for the media viewer, kept engine-agnostic: rotate/flip are applied to the
 * image bitmap itself (canvas → blob URL) rather than to the viewer's transform, so zoom, pan,
 * thumbnails and "download what you see" all work on the oriented image with no engine support.
 *
 * The display transform is R(quarterTurns) ∘ F(flipX): the mirror happens in the source image's
 * space, then the rotation turns the mirrored result.
 */
export interface Orientation {
    /** Clockwise quarter turns (0-3) applied to the (possibly mirrored) image. */
    quarterTurns: number;
    /** Mirror around the vertical axis, applied before the rotation. */
    flipX: boolean;
}

export const DEFAULT_ORIENTATION: Orientation = { quarterTurns: 0, flipX: false };

export function isDefaultOrientation(orientation: Orientation): boolean {
    return orientation.quarterTurns === 0 && !orientation.flipX;
}

/** Turns the visible image by a multiple of 90°; positive is clockwise. */
export function rotateOrientation(orientation: Orientation, degrees: number): Orientation {
    const turns = Math.round(degrees / 90);
    return { ...orientation, quarterTurns: normalizeTurns(orientation.quarterTurns + turns) };
}

/** Mirrors the *visible* image: Fx ∘ R(θ) = R(−θ) ∘ Fx, so the stored rotation flips sign. */
export function flipOrientationHorizontal(orientation: Orientation): Orientation {
    return { quarterTurns: normalizeTurns(-orientation.quarterTurns), flipX: !orientation.flipX };
}

/** An oriented bitmap ready to be shown; call {@link release} once it leaves the DOM. */
export interface OrientedRender {
    url: string;
    width: number;
    height: number;
    release(): void;
}

/**
 * Draws `src` with the given orientation onto a canvas and returns it as an object URL.
 * The source is re-loaded from its URL each time (a cache hit thanks to the immutable image
 * caching) so repeated rotations never re-encode an already re-encoded bitmap.
 */
export async function renderOrientedImage(
    src: string,
    orientation: Orientation,
    loadImage: (src: string) => Promise<HTMLImageElement> = loadImageElement
): Promise<OrientedRender> {
    const image = await loadImage(src);
    const { naturalWidth, naturalHeight } = image;
    if (!naturalWidth || !naturalHeight) {
        throw new Error("Cannot orient an image with no decodable dimensions");
    }

    const oddTurns = orientation.quarterTurns % 2 === 1;
    const width = oddTurns ? naturalHeight : naturalWidth;
    const height = oddTurns ? naturalWidth : naturalHeight;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("2D canvas is unavailable");
    }
    context.translate(width / 2, height / 2);
    context.rotate((orientation.quarterTurns * Math.PI) / 2);
    context.scale(orientation.flipX ? -1 : 1, 1);
    context.drawImage(image, -naturalWidth / 2, -naturalHeight / 2);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
        throw new Error("Canvas could not encode the oriented image");
    }

    const url = URL.createObjectURL(blob);
    let released = false;
    return {
        url,
        width,
        height,
        release: () => {
            if (released) return;
            released = true;
            URL.revokeObjectURL(url);
        }
    };
}

function normalizeTurns(turns: number): number {
    return ((turns % 4) + 4) % 4;
}

async function loadImageElement(src: string): Promise<HTMLImageElement> {
    const image = new Image();
    image.decoding = "async";
    image.src = src;
    await image.decode();
    return image;
}
