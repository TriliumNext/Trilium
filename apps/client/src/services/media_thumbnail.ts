import { toAspectRatio } from "@triliumnext/commons";

import { getUrlForDownload } from "./open.js";
import server from "./server.js";
import { isStandalone } from "./utils.js";

/** The longest edge of a thumbnail, in pixels, as of the largest YouTube thumbnail kept. */
const MAX_THUMBNAIL_EDGE = 1280;

/** How far into a video its thumbnail is taken: a tenth of it, at most this many seconds. */
const MAX_THUMBNAIL_TIME = 5;

/** How long a capture waits for the video to load and seek, in milliseconds. */
const CAPTURE_TIMEOUT_MS = 20 * 1000;

const THUMBNAIL_QUALITY = 0.85;

/** A frame of a video, as a JPEG, and the size of the video. */
interface CapturedFrame {
    picture: Blob;
    width: number;
    height: number;
}

/**
 * Captures the picture of a frame of the video file at `url`, stores it as the thumbnail of its
 * preview in the note `noteId`, and resolves to its URL and the shape of the video, or to `null`
 * when the video cannot be read.
 *
 * The frame is read through the proxy of the server, so that the host of the video sees the
 * server rather than the browser, and a host without CORS headers does not taint the canvas.
 * Standalone has no proxy and reads the frame from the host, which works with CORS headers only.
 */
export async function captureVideoThumbnail(url: string, noteId: string) {
    const frame = await (isStandalone
        ? captureFrame(url, { isCrossOrigin: true })
        : captureThroughProxy(url)
    ).catch(() => null);
    if (!frame) {
        return null;
    }

    const { image } = await server.postWithSilentErrors<{ image: string }>(
        "link-embed/thumbnail", { noteId, url, image: await toBase64(frame.picture) });
    return { image, aspectRatio: toAspectRatio(frame.width, frame.height) };
}

async function captureThroughProxy(url: string) {
    const proxy = await server.postWithSilentErrors<{ url: string }>(
        "link-embed/media-proxy", { url });
    return await captureFrame(getUrlForDownload(proxy.url), { isCrossOrigin: false });
}

/**
 * Loads the video at `src` into a detached `<video>`, seeks into it and draws that frame, scaled
 * down to {@link MAX_THUMBNAIL_EDGE}, as a JPEG. Rejects when the video does not load, or when its
 * frame taints the canvas.
 */
function captureFrame(src: string, { isCrossOrigin }: { isCrossOrigin: boolean }) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    if (isCrossOrigin) {
        video.crossOrigin = "anonymous";
    }

    const frame = new Promise<CapturedFrame>((resolve, reject) => {
        const fail = () => reject(new Error(`The video at ${src} could not be read.`));
        const timeout = setTimeout(fail, CAPTURE_TIMEOUT_MS);
        video.addEventListener("error", fail, { once: true });
        video.addEventListener("loadedmetadata", () => {
            const { duration } = video;
            video.currentTime = Number.isFinite(duration)
                ? Math.min(duration / 10, MAX_THUMBNAIL_TIME)
                : 0;
        }, { once: true });
        video.addEventListener("seeked", () => {
            clearTimeout(timeout);
            drawFrame(video).then(resolve, reject);
        }, { once: true });
    });
    video.src = src;

    return frame.finally(() => {
        video.removeAttribute("src");
        video.load();
    });
}

async function drawFrame(video: HTMLVideoElement): Promise<CapturedFrame> {
    const { videoWidth: width, videoHeight: height } = video;
    if (!width || !height) {
        throw new Error("The video has no picture.");
    }

    const scale = Math.min(1, MAX_THUMBNAIL_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);

    // `toBlob()` throws for a tainted canvas.
    const picture = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", THUMBNAIL_QUALITY));
    if (!picture) {
        throw new Error("The frame could not be encoded.");
    }
    return { picture, width, height };
}

/** The content of `blob`, base64. */
function toBase64(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(String(reader.result).split(",")[1] ?? ""));
        reader.addEventListener("error", () => reject(reader.error));
        reader.readAsDataURL(blob);
    });
}
