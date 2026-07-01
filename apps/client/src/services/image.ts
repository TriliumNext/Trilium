import { t } from "./i18n.js";
import open, { getUrlForDownload } from "./open.js";
import toastService, { showError } from "./toast.js";
import utils from "./utils.js";

/**
 * Whether copying the raw image to the clipboard is supported in the current environment.
 *
 * Electron has a native clipboard bridge. Browsers expose `ClipboardItem` and
 * `navigator.clipboard.write()` only in secure contexts (HTTPS or localhost) — which Trilium
 * isn't guaranteed to run under — so we feature-detect both rather than assume from the
 * protocol. When unsupported, the browser's own context menu still offers a "Copy image" entry.
 */
export function isImageCopySupported() {
    if (utils.isElectron()) {
        return true;
    }

    return window.isSecureContext && typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function";
}

/** Copies the actual image (not a reference to it) to the system clipboard. */
export async function copyImageToClipboard(src: string) {
    try {
        if (utils.isElectron()) {
            const blob = await fetchImageBlob(src);
            const buffer = new Uint8Array(await blob.arrayBuffer());
            window.electronApi?.clipboard.copyImageToClipboard(buffer);
        } else {
            // The Web Clipboard API reliably accepts only PNG, so render the image to PNG through
            // an <img> + canvas. The browser's own image decoder handles every format it can
            // display (JPEG, WebP, GIF, SVG, …), whereas createImageBitmap rejects some of them.
            // A concrete Blob is written (not a Promise), which Firefox needs.
            const pngBlob = await renderImageToPng(src);
            await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
        }

        toastService.showMessage(t("image.image-copied-to-clipboard"));
    } catch (e) {
        logError(`Failed to copy image to clipboard: ${e}`);
        showError(t("image.cannot-copy-image"));
    }
}

/** Downloads the image to the user's device. */
export async function downloadImage(src: string) {
    // Prefer the note/attachment download endpoint: it responds with `Content-Disposition:
    // attachment`, so the browser saves the file (with a correct name) instead of opening it in a
    // new tab, and it works synchronously — without relying on a transient user activation that an
    // `await` would consume (which is why a fetch-then-anchor download silently does nothing).
    const downloadUrl = getImageDownloadUrl(src);
    if (downloadUrl) {
        open.download(getUrlForDownload(downloadUrl));
        return;
    }

    // Fallback for other sources (e.g. data: URLs): fetch into a blob and save via an object URL.
    try {
        const blob = await fetchImageBlob(src);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = getFileNameFromSrc(src, blob.type);
        document.body.appendChild(link);
        link.click();
        link.remove();
        // Defer revocation so the in-flight download isn't cancelled.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
        logError(`Failed to download image: ${e}`);
        showError(t("image.cannot-download"));
    }
}

/** Maps an embedded image's `src` to the download endpoint of its backing note or attachment. */
export function getImageDownloadUrl(src: string) {
    const noteMatch = src.match(/(?:^|\/)api\/images\/([^/?#]+)\//);
    if (noteMatch) {
        return `api/notes/${noteMatch[1]}/download`;
    }

    const attachmentMatch = src.match(/(?:^|\/)api\/attachments\/([^/?#]+)\/image\//);
    if (attachmentMatch) {
        return `api/attachments/${attachmentMatch[1]}/download`;
    }

    return null;
}

/** Fetches the image as a blob, throwing on a non-OK response so error pages aren't copied/saved. */
async function fetchImageBlob(src: string) {
    const response = await fetch(src);
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    return await response.blob();
}

async function renderImageToPng(src: string) {
    // Decode through an <img> element — the browser's full image decoder, which handles every
    // format it can display — rather than createImageBitmap, which rejects some formats (e.g. SVG).
    const image = new Image();
    image.src = src;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) {
        throw new Error("The image has no drawable dimensions.");
    }
    context.drawImage(image, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("The image could not be encoded as PNG."))), "image/png");
    });
}

export function getFileNameFromSrc(src: string, mimeType?: string) {
    // Image URLs look like `api/images/<noteId>/<title>` — use the last path segment as the name.
    const path = src.split("?")[0];
    const lastSegment = path.substring(path.lastIndexOf("/") + 1);
    let name: string;
    try {
        name = decodeURIComponent(lastSegment) || "image";
    } catch {
        // A malformed %-escape in the segment would make decodeURIComponent throw, so the catch is
        // only reached when lastSegment contains a `%` and is therefore always non-empty here —
        // the `|| "image"` fallback is unreachable defensive code.
        /* v8 ignore next -- unreachable: lastSegment is always truthy inside the catch */
        name = lastSegment || "image";
    }

    // Ensure an extension, since a blob: URL carries none: derive it from the MIME type.
    if (mimeType && !name.includes(".")) {
        const extension = mimeType.split("/")[1]?.split("+")[0]; // e.g. "image/svg+xml" → "svg"
        if (extension) {
            name += `.${extension}`;
        }
    }

    return name;
}

export function copyImageReferenceToClipboard($imageWrapper: JQuery<HTMLElement>) {
    try {
        $imageWrapper.attr("contenteditable", "true");
        selectImage($imageWrapper.get(0));

        const success = document.execCommand("copy");

        if (success) {
            toastService.showMessage(t("image.copied-to-clipboard"));
        } else {
            const message = t("image.cannot-copy");
            showError(message);
            logError(message);
        }
    } finally {
        window.getSelection()?.removeAllRanges();
        $imageWrapper.removeAttr("contenteditable");
    }
}

function selectImage(element: HTMLElement | undefined) {
    if (!element) {
        return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
}

/**
 * Largest data: URI (in characters) we put on the clipboard for a single embedded image. Beyond
 * this the image is left as an internal reference (the previous behavior) so the clipboard isn't
 * bloated by a huge photo. A base64 data URI is ~1.37x the encoded byte size.
 */
const MAX_EMBED_DATA_URL_LENGTH = 12_000_000;

/**
 * Synchronously render an already-loaded internal image to a self-contained `data:` URI so the
 * clipboard image-embed plugin can inline it for pasting into external applications. Returns
 * `null` (leave the image as a reference) when the `src` isn't an internal note/attachment image,
 * the image hasn't finished loading, it can't be drawn, or the result would exceed
 * {@link MAX_EMBED_DATA_URL_LENGTH}.
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
        return dataUrl.length <= MAX_EMBED_DATA_URL_LENGTH ? dataUrl : null;
    } catch {
        return null; // e.g. a tainted canvas — fall back to the reference
    }
}

/** Find a fully-loaded `<img>` currently in the document whose raw `src` attribute matches. */
function findLoadedImage(src: string): HTMLImageElement | null {
    for (const image of Array.from(document.images)) {
        if (image.getAttribute("src") === src && image.complete && image.naturalWidth > 0) {
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

export default {
    copyImageReferenceToClipboard,
    copyImageToClipboard,
    downloadImage,
    embedReferenceImageAsDataUrl,
    isImageCopySupported
};
