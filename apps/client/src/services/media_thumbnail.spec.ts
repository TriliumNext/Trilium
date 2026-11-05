import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ postWithSilentErrors: vi.fn(), isStandalone: false }));
vi.mock("./server.js", () => ({ default: { postWithSilentErrors: mocks.postWithSilentErrors } }));
vi.mock("./open.js", () => ({ getUrlForDownload: (url: string) => url }));
vi.mock("./utils.js", () => ({
    get isStandalone() {
        return mocks.isStandalone;
    }
}));

import { captureVideoThumbnail } from "./media_thumbnail.js";

const URL = "https://example.com/clip.mp4";
const PROXY_URL = "api/link-embed/media-proxy/token";
const THUMBNAIL = "api/attachments/t1/image/clip.jpg";

describe("captureVideoThumbnail", () => {
    const { postWithSilentErrors } = mocks;
    let videos: HTMLVideoElement[];
    let drawImage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mocks.isStandalone = false;
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
                ? { url: PROXY_URL }
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

    it("reads the frame through the server and stores it with the shape of the video", async () => {
        const capture = captureVideoThumbnail(URL, "note1");
        const { video, src } = await loadVideo(0, 1920, 1080);

        expect(await capture).toEqual({ image: THUMBNAIL, aspectRatio: "16/9" });
        expect(postWithSilentErrors)
            .toHaveBeenNthCalledWith(1, "link-embed/media-proxy", { url: URL });
        expect([ videos.length, src, video.crossOrigin, video.muted, video.currentTime ])
            .toEqual([ 1, PROXY_URL, null, true, 5 ]);
        expect(drawImage).toHaveBeenCalledExactlyOnceWith(video, 0, 0, 1280, 720);
        expect(postWithSilentErrors).toHaveBeenNthCalledWith(2, "link-embed/thumbnail",
            { noteId: "note1", url: URL, image: btoa("jpeg") });
        expect(video.hasAttribute("src")).toBe(false);
    });

    it("reads the frame from the host itself in standalone, which has no proxy", async () => {
        mocks.isStandalone = true;
        const capture = captureVideoThumbnail(URL, "note1");
        const { video, src } = await loadVideo(0, 720, 1280);

        expect(await capture).toEqual({ image: THUMBNAIL, aspectRatio: "9/16" });
        expect([ src, video.crossOrigin ]).toEqual([ URL, "anonymous" ]);
        expect(postWithSilentErrors).toHaveBeenCalledExactlyOnceWith("link-embed/thumbnail",
            expect.anything());
    });

    it("stores nothing when the server cannot read the video and never asks the host", async () => {
        const capture = captureVideoThumbnail(URL, "note1");
        await vi.waitFor(() => expect(videos[0]).toBeDefined());
        expect(videos[0].getAttribute("src")).toBe(PROXY_URL);
        videos[0].dispatchEvent(new Event("error"));

        expect(await capture).toBeNull();
        expect(videos).toHaveLength(1);
        expect(postWithSilentErrors).toHaveBeenCalledExactlyOnceWith("link-embed/media-proxy",
            { url: URL });

        postWithSilentErrors.mockRejectedValueOnce(new Error("No proxy"));
        expect(await captureVideoThumbnail(URL, "note1")).toBeNull();
        expect(videos).toHaveLength(1);
    });
});
