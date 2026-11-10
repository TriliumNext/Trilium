import { afterEach, describe, expect, it, vi } from "vitest";

import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import server from "../../../services/server";
import { fetchHttpStatus, getExternalMediaSource, getMediaSource } from "./media_source";

const note = { noteId: "vid1", title: "Holiday", mime: "video/mp4", blobId: "blob1" } as FNote;
const attachment = { attachmentId: "att1", title: "Recording", mime: "audio/mpeg", utcDateModified: "2026-07-23 10:00:00.000Z" } as FAttachment;

describe("getMediaSource", () => {
    it("resolves a note to its streaming and whole-file endpoints, versioned by its content hash", () => {
        expect(getMediaSource(note)).toEqual({
            id: "vid1",
            title: "Holiday",
            mime: "video/mp4",
            kind: "video",
            streamUrl: "api/notes/vid1/open-partial?v=blob1",
            fullUrl: "api/notes/vid1/open?v=blob1"
        });
    });

    it("resolves an attachment to the attachment endpoints, versioned by its modification stamp", () => {
        expect(getMediaSource(attachment)).toEqual({
            id: "att1",
            title: "Recording",
            mime: "audio/mpeg",
            kind: "audio",
            streamUrl: "api/attachments/att1/open-partial?v=2026-07-23%2010%3A00%3A00.000Z",
            fullUrl: "api/attachments/att1/open?v=2026-07-23%2010%3A00%3A00.000Z"
        });
    });

    it("resolves the file at the URL of a link preview, with its thumbnail as the poster", () => {
        const url = "https://example.com/media/My%20Clip.webm";
        expect(getExternalMediaSource({ url, image: "api/attachments/a1/image/a.jpg" }, "video"))
            .toEqual({
                id: url, title: "My Clip.webm", mime: "", kind: "video", streamUrl: url,
                fullUrl: url, isExternal: true, poster: "api/attachments/a1/image/a.jpg"
            });
        expect(getExternalMediaSource({ url, title: "Clip", image: "https://evil/x.jpg" }, "audio"))
            .toMatchObject({ title: "Clip", kind: "audio", poster: undefined });
    });

    it("re-versions the urls when the content is replaced under the same id", () => {
        // The id is unchanged, so an open player would otherwise keep streaming what it already had.
        const replaced = { ...attachment, utcDateModified: "2026-07-23 11:00:00.000Z" } as FAttachment;
        expect(getMediaSource(replaced).streamUrl).not.toBe(getMediaSource(attachment).streamUrl);
    });
});

describe("fetchHttpStatus", () => {
    afterEach(() => vi.restoreAllMocks());

    it("reads the status of an address, and none where the server has none", async () => {
        const url = "https://example.com/clip.mp4";
        const post = vi.spyOn(server, "postWithSilentErrors")
            .mockImplementationOnce(async () => ({ status: 404 }))
            .mockImplementationOnce(async () => ({}))
            .mockImplementationOnce(async () => {
                throw new Error("offline");
            });

        expect(await fetchHttpStatus(url)).toBe(404);
        expect(post).toHaveBeenCalledExactlyOnceWith("link-embed/status", { url });
        expect(await fetchHttpStatus(url)).toBeNull();
        expect(await fetchHttpStatus(url)).toBeNull();
    });
});
