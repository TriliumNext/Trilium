// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { collectAttachments, setupPdfAttachments } from "./attachments";
import { allFeaturesPdf, ATTACHMENT_TEXT, barePdf } from "./test/fixture_pdf";
import { InstalledViewer, installViewerApp, uninstallViewerApp } from "./test/viewer_app";

/** Mirrors what pdf.js hands back since 6.1: a `Map`, with the content stripped from the entries. */
function attachmentMap(...entries: [string, { filename?: string }][]) {
    return new Map(entries);
}

describe("collectAttachments", () => {
    it("maps a pdf.js attachment map into metadata, sizing each entry from its content", async () => {
        const getContent = vi.fn(async (id: string) => new Uint8Array(id === "note" ? 1024 : 3));

        const result = await collectAttachments(attachmentMap(
            ["note", { filename: "Note.trilium" }],
            ["nested/data.bin", { filename: "data.bin" }]
        ), getContent);

        expect(result).toEqual([
            { id: "note", filename: "Note.trilium", size: 1024 },
            { id: "nested/data.bin", filename: "data.bin", size: 3 }
        ]);

        // Content is fetched by map key, which is what the client sends back to download it.
        expect(getContent.mock.calls).toEqual([["note"], ["nested/data.bin"]]);
    });

    it("falls back to the key when an entry has no display filename, and to 0 for missing content", async () => {
        const result = await collectAttachments(attachmentMap(
            ["unnamed", {}],
            ["gone", { filename: "gone.txt" }]
        ), async (id) => (id === "gone" ? null : new Uint8Array(2)));

        expect(result).toEqual([
            { id: "unnamed", filename: "unnamed", size: 2 },
            { id: "gone", filename: "gone.txt", size: 0 }
        ]);
    });

    it("returns an empty list for documents without attachments", async () => {
        const getContent = vi.fn();

        expect(await collectAttachments(null, getContent)).toEqual([]);
        expect(await collectAttachments(undefined, getContent)).toEqual([]);
        expect(await collectAttachments(attachmentMap(), getContent)).toEqual([]);
        expect(getContent).not.toHaveBeenCalled();
    });
});

/**
 * The `attachmentMap()` helper above encodes our belief about what pdf.js returns; these tests
 * check that belief against the real thing, which is where the 6.1 change to a `Map` slipped
 * through. See {@link ./test/fixture_pdf}.
 */
describe("against a real document", () => {
    let viewer: InstalledViewer;

    afterEach(() => uninstallViewerApp());

    it("reports the embedded file with the size pdf.js resolves for it", async () => {
        viewer = await installViewerApp(allFeaturesPdf());

        await setupPdfAttachments();

        expect(viewer.lastMessageOfType("pdfjs-viewer-attachments")).toEqual({
            type: "pdfjs-viewer-attachments",
            attachments: [ { id: "notes.txt", filename: "notes.txt", size: ATTACHMENT_TEXT.length } ]
        });
    });

    it("reports an empty list for a document with no attachments", async () => {
        viewer = await installViewerApp(barePdf());

        await setupPdfAttachments();

        expect(viewer.lastMessageOfType("pdfjs-viewer-attachments").attachments).toEqual([]);
    });

    it("still reports, with an empty list, when extraction throws", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(viewer.pdfDocument, "getAttachments").mockRejectedValue(new Error("boom"));

        await setupPdfAttachments();

        // The sidebar waits for this message, so swallowing it would leave a spinner up.
        expect(viewer.lastMessageOfType("pdfjs-viewer-attachments").attachments).toEqual([]);
    });
});

describe("downloading an attachment", () => {
    let viewer: InstalledViewer;
    let click: ReturnType<typeof vi.spyOn>;

    afterEach(() => uninstallViewerApp());

    /** Captures the anchor the download path builds and clicks. */
    function captureDownload() {
        const anchors: HTMLAnchorElement[] = [];
        click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
            anchors.push(this);
        });
        return anchors;
    }

    it("hands the real attachment bytes to the browser under its filename", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        const anchors = captureDownload();
        const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fixture");
        const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        await setupPdfAttachments();

        viewer.sendFromParent({ type: "trilium-download-attachment", id: "notes.txt" });
        await vi.waitFor(() => expect(click).toHaveBeenCalled());

        expect(anchors[0].download).toBe("notes.txt");
        expect(anchors[0].href).toContain("blob:fixture");

        // The blob must carry the bytes pdf.js actually stored, not a placeholder.
        const [ blob ] = createObjectURL.mock.calls[0];
        expect(await (blob as Blob).text()).toBe(ATTACHMENT_TEXT);
        // The URL is one-shot; leaving it alive pins the blob in memory for the session.
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:fixture");
    });

    it("does nothing for an unknown attachment id", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        captureDownload();
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        await setupPdfAttachments();

        viewer.sendFromParent({ type: "trilium-download-attachment", id: "nope.txt" });
        await vi.waitFor(() => expect(error).toHaveBeenCalled());

        expect(click).not.toHaveBeenCalled();
    });

    it("ignores download requests from another origin", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        captureDownload();
        await setupPdfAttachments();

        window.dispatchEvent(new MessageEvent("message", {
            data: { type: "trilium-download-attachment", id: "notes.txt" },
            origin: "https://evil.example"
        }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(click).not.toHaveBeenCalled();
    });
});
