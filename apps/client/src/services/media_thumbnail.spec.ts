import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postWithSilentErrors = vi.hoisted(() => vi.fn());
vi.mock("./server.js", () => ({ default: { postWithSilentErrors } }));
vi.mock("./open.js", () => ({ getUrlForDownload: (url: string) => url }));

import { captureVideoThumbnail } from "./media_thumbnail.js";

const URL = "https://example.com/clip.mp4";
const THUMBNAIL = "api/attachments/t1/image/clip.jpg";

describe("captureVideoThumbnail", () => {
    let videos: HTMLVideoElement[];
    let drawImage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        videos = [];
        drawImage = vi.fn();
        const createElement = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
            if (tagName === "canvas") {
                return {
                    getContext: () => ({ drawImage }),
                    toBlob: (callback: BlobCallback) =>
                        callback(new Blob([ "jpeg" ], { type: "image/jpeg" }))
                } as unknown as HTMLCanvasElement;
            }
            const element = createElement(tagName);
            if (element instanceof HTMLVideoElement) {
                videos.push(element);
            }
            return element;
        });
        postWithSilentErrors.mockImplementation(async (url: string) =>
            url === "link-embed/media-proxy"
                ? { url: "api/link-embed/media-proxy/token" }
                : { image: THUMBNAIL });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** Has the video `index` load a picture of `width` by `height` and seek into it. */
    async function loadVideo(index: number, width: number, height: number) {
        await vi.waitFor(() => expect(videos[index]).toBeDefined());
        const video = videos[index];
        const src = video.getAttribute("src");
        Object.defineProperties(video, {
            duration: { value: 120 },
            videoWidth: { value: width },
            videoHeight: { value: height }
        });
        video.dispatchEvent(new Event("loadedmetadata"));
        video.dispatchEvent(new Event("seeked"));
        return { video, src };
    }

    it("reads a frame from the host itself, and stores it with the shape of the video", async () => {
        const capture = captureVideoThumbnail(URL, "note1");
        const { video, src } = await loadVideo(0, 1920, 1080);

        expect(await capture).toEqual({ image: THUMBNAIL, aspectRatio: "16/9" });
        expect([ src, video.crossOrigin, video.muted, video.currentTime ])
            .toEqual([ URL, "anonymous", true, 5 ]);
        expect(drawImage).toHaveBeenCalledExactlyOnceWith(video, 0, 0, 1280, 720);
        expect(postWithSilentErrors).toHaveBeenCalledExactlyOnceWith("link-embed/thumbnail",
            { noteId: "note1", url: URL, image: btoa("jpeg") });
        expect(video.hasAttribute("src")).toBe(false);
    });

    it("reads the frame through the proxy of the server when the host refuses CORS", async () => {
        const capture = captureVideoThumbnail(URL, "note1");
        await vi.waitFor(() => expect(videos[0]).toBeDefined());
        videos[0].dispatchEvent(new Event("error"));
        const { video: proxied, src } = await loadVideo(1, 720, 1280);

        expect(await capture).toEqual({ image: THUMBNAIL, aspectRatio: "9/16" });
        expect(postWithSilentErrors).toHaveBeenNthCalledWith(1, "link-embed/media-proxy", { url: URL });
        expect([ src, proxied.crossOrigin ]).toEqual([ "api/link-embed/media-proxy/token", null ]);
    });

    it("stores nothing when neither the host nor the proxy gives a frame", async () => {
        postWithSilentErrors.mockRejectedValueOnce(new Error("No proxy in standalone"));
        const capture = captureVideoThumbnail(URL, "note1");
        await vi.waitFor(() => expect(videos[0]).toBeDefined());
        videos[0].dispatchEvent(new Event("error"));

        expect(await capture).toBeNull();
        expect(postWithSilentErrors).toHaveBeenCalledOnce();
    });
});
