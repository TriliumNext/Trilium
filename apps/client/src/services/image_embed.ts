import { getImageDownloadUrl, stripNoteImageVersion } from "./image_urls.js";

/**
 * Largest data: URI (in characters) we put on the clipboard for a single embedded image. Beyond
 * this the image is left as an internal reference (the previous behavior) so the clipboard isn't
 * bloated by a huge photo. A base64 data URI is ~1.37x the encoded byte size.
 */
const MAX_EMBED_DATA_URL_LENGTH = 12_000_000;

/**
 * Largest total embedded payload (in characters) for a single copy. The per-image cap above bounds
 * one photo; this bounds a whole selection, so that `Ctrl+A` on an image-heavy note can't build a
 * clipboard payload so large the browser refuses to write it — which would turn a working copy into
 * a silently failing one. Images past the budget stay references, i.e. the previous behavior.
 */
const MAX_EMBED_TOTAL_LENGTH = 32_000_000;

let remainingEmbedBudget = MAX_EMBED_TOTAL_LENGTH;

/**
 * Start a fresh {@link MAX_EMBED_TOTAL_LENGTH} budget. Called for every copy/cut/drag before any
 * embedding runs, so the budget spans one clipboard operation rather than the session.
 */
export function resetImageEmbedBudget() {
    remainingEmbedBudget = MAX_EMBED_TOTAL_LENGTH;
}

/**
 * Synchronously render an already-loaded internal image to a self-contained `data:` URI so the
 * clipboard image-embed plugin can inline it for pasting into external applications. Returns
 * `null` (leave the image as a reference) when the `src` isn't an internal note/attachment image,
 * the image hasn't finished loading, it can't be drawn, or the result would exceed
 * {@link MAX_EMBED_DATA_URL_LENGTH} or what is left of {@link MAX_EMBED_TOTAL_LENGTH}.
 *
 * Must stay synchronous: it runs inside the browser's `copy`/`dragstart` event, which cannot
 * await — ruling out `fetch()`. So the decoded `<img>` is re-encoded through a canvas (lossy for
 * photos, but the only option that doesn't block the clipboard write). A cross-origin image would
 * taint the canvas and make `toDataURL` throw; internal images are same-origin, so that's only a
 * defensive catch.
 */
export function embedReferenceImageAsDataUrl(src: string): string | null {
    if (!getImageDownloadUrl(src)) {
        return null; // not an internal note/attachment image — leave it untouched
    }

    const image = findLoadedImage(src);
    if (!image) {
        return null;
    }

    try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context || !canvas.width || !canvas.height) {
            return null;
        }
        context.drawImage(image, 0, 0);

        const mimeType = inferEncodeMimeType(src);
        const dataUrl = canvas.toDataURL(mimeType, mimeType === "image/png" ? undefined : 0.92);
        if (dataUrl.length > MAX_EMBED_DATA_URL_LENGTH || dataUrl.length > remainingEmbedBudget) {
            return null;
        }

        remainingEmbedBudget -= dataUrl.length;
        return dataUrl;
    } catch {
        return null; // e.g. a tainted canvas — fall back to the reference
    }
}

/** Find a fully-loaded `<img>` currently in the document whose raw `src` attribute matches. */
function findLoadedImage(src: string): HTMLImageElement | null {
    for (const image of document.querySelectorAll("img")) {
        const imageSrc = image.getAttribute("src");
        const isSameImage = !!imageSrc
            && stripNoteImageVersion(imageSrc) === stripNoteImageVersion(src);
        if (isSameImage && image.complete && image.naturalWidth > 0) {
            return image;
        }
    }
    return null;
}

/** Pick an output encoding from the source extension so photos stay JPEG instead of bloating to PNG. */
function inferEncodeMimeType(src: string): string {
    const path = src.split(/[?#]/)[0].toLowerCase();
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) {
        return "image/jpeg";
    }
    if (path.endsWith(".webp")) {
        return "image/webp";
    }
    return "image/png";
}
