import { BinaryFileData } from "@excalidraw/excalidraw/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import { buildNewImageAttachments, loadImageAttachments } from "./image_attachments";

function file(dataURL: string, mimeType = "image/png"): BinaryFileData {
    return { id: "x", dataURL, mimeType, created: 0 } as BinaryFileData;
}

describe("buildNewImageAttachments", () => {
    it("emits a base64 image attachment titled with the fileId for each new image", () => {
        const activeFiles = {
            a: file("data:image/png;base64,AAAA"),
            b: file("data:image/jpeg;base64,BBBB", "image/jpeg")
        };

        const attachments = buildNewImageAttachments(activeFiles, new Set());

        expect(attachments).toEqual([
            { role: "image", title: "a", mime: "image/png", content: "AAAA", position: 10, encoding: "base64" },
            { role: "image", title: "b", mime: "image/jpeg", content: "BBBB", position: 20, encoding: "base64" }
        ]);
    });

    it("skips files already persisted (loaded at start or uploaded earlier this session)", () => {
        const activeFiles = {
            old: file("data:image/png;base64,AAAA"),
            new: file("data:image/png;base64,CCCC")
        };

        const attachments = buildNewImageAttachments(activeFiles, new Set([ "old" ]));

        expect(attachments).toEqual([
            { role: "image", title: "new", mime: "image/png", content: "CCCC", position: 10, encoding: "base64" }
        ]);
    });

    it("skips files whose source is not an inline data URL (nothing to upload)", () => {
        const activeFiles = { a: file("api/attachments/x/image/x.png") };
        expect(buildNewImageAttachments(activeFiles, new Set())).toEqual([]);
    });

    it("migrates a legacy note's inline base64 images to attachments, preserving the exact bytes", () => {
        // A legacy note loads its images inline (content.files) into memory, so on the first save
        // every active file is unseen (empty persisted set) and must be written out verbatim — the
        // stored content is the original base64, not a recompressed copy.
        const activeFiles = { legacy: file("data:image/png;base64,iVBORw0KGgoAAAA=") };

        const attachments = buildNewImageAttachments(activeFiles, new Set());

        expect(attachments).toEqual([
            { role: "image", title: "legacy", mime: "image/png", content: "iVBORw0KGgoAAAA=", position: 10, encoding: "base64" }
        ]);
    });
});

describe("loadImageAttachments", () => {
    afterEach(() => vi.unstubAllGlobals());

    function noteWithAttachments(attachments: { attachmentId: string; title: string }[]) {
        return { getAttachmentsByRole: vi.fn(async () => attachments) } as unknown as FNote;
    }

    it("fetches each image attachment, rebuilds its data URL and maps it to its fileId, ignoring the SVG export", async () => {
        const note = noteWithAttachments([
            { attachmentId: "att-export", title: "canvas-export.svg" },
            { attachmentId: "att-1", title: "fileId-1" }
        ]);
        const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob([ "ABC" ], { type: "image/png" }) }));
        vi.stubGlobal("fetch", fetchMock);

        const { files, metadata } = await loadImageAttachments(note);

        // Only the image is fetched (the export is filtered out by title), via the attachment image endpoint.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith("api/attachments/att-1/image/fileId-1");
        // "ABC" base64-encodes to "QUJD" — the bytes survive the round-trip unchanged.
        expect(files).toEqual([ { id: "fileId-1", dataURL: "data:image/png;base64,QUJD", mimeType: "image/png", created: expect.any(Number) } ]);
        expect(metadata).toEqual([ { fileId: "fileId-1", attachmentId: "att-1" } ]);
    });

    it("skips attachments whose fetch fails without rejecting", async () => {
        const note = noteWithAttachments([ { attachmentId: "att-1", title: "fileId-1" } ]);
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, blob: async () => new Blob() })));

        const { files, metadata } = await loadImageAttachments(note);

        expect(files).toEqual([]);
        expect(metadata).toEqual([]);
    });
});
