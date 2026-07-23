import { describe, expect, it } from "vitest";

import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import { getMediaSource } from "./media_source";

const note = { noteId: "vid1", title: "Holiday", mime: "video/mp4", blobId: "blob1" } as FNote;
const attachment = { attachmentId: "att1", title: "Recording", mime: "audio/mpeg", utcDateModified: "2026-07-23 10:00:00.000Z" } as FAttachment;

describe("getMediaSource", () => {
    it("resolves a note to its streaming and whole-file endpoints, versioned by its content hash", () => {
        expect(getMediaSource(note)).toEqual({
            id: "vid1",
            title: "Holiday",
            mime: "video/mp4",
            streamUrl: "api/notes/vid1/open-partial?v=blob1",
            fullUrl: "api/notes/vid1/open?v=blob1"
        });
    });

    it("resolves an attachment to the attachment endpoints, versioned by its modification stamp", () => {
        expect(getMediaSource(attachment)).toEqual({
            id: "att1",
            title: "Recording",
            mime: "audio/mpeg",
            streamUrl: "api/attachments/att1/open-partial?v=2026-07-23%2010%3A00%3A00.000Z",
            fullUrl: "api/attachments/att1/open?v=2026-07-23%2010%3A00%3A00.000Z"
        });
    });

    it("re-versions the urls when the content is replaced under the same id", () => {
        // The id is unchanged, so an open player would otherwise keep streaming what it already had.
        const replaced = { ...attachment, utcDateModified: "2026-07-23 11:00:00.000Z" } as FAttachment;
        expect(getMediaSource(replaced).streamUrl).not.toBe(getMediaSource(attachment).streamUrl);
    });
});
