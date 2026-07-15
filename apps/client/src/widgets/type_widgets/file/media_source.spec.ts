import { describe, expect, it } from "vitest";

import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import { getMediaSource } from "./media_source";

const note = { noteId: "vid1", title: "Holiday", mime: "video/mp4" } as FNote;
const attachment = { attachmentId: "att1", title: "Recording", mime: "audio/mpeg" } as FAttachment;

describe("getMediaSource", () => {
    it("resolves a note to its streaming and whole-file endpoints", () => {
        expect(getMediaSource(note)).toEqual({
            id: "vid1",
            title: "Holiday",
            mime: "video/mp4",
            streamUrl: "api/notes/vid1/open-partial",
            fullUrl: "api/notes/vid1/open"
        });
    });

    it("resolves an attachment to the attachment endpoints", () => {
        expect(getMediaSource(attachment)).toEqual({
            id: "att1",
            title: "Recording",
            mime: "audio/mpeg",
            streamUrl: "api/attachments/att1/open-partial",
            fullUrl: "api/attachments/att1/open"
        });
    });
});
