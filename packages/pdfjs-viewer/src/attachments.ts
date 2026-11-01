export async function setupPdfAttachments() {
    // Extract immediately since we're called after documentloaded
    await extractAndSendAttachments();

    // Listen for download requests
    window.addEventListener("message", async (event) => {
        // Only accept messages from the same origin to prevent malicious iframes
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === "trilium-download-attachment") {
            await downloadAttachment(event.data.id);
        }
    });
}

/**
 * Maps the attachments reported by pdf.js into the metadata sent to the client.
 *
 * Since pdf.js 6.1 `getAttachments()` returns a `Map` whose entries no longer carry the file
 * content: it has to be pulled separately via `getAttachmentContent(id)`, keyed by the map key.
 * The content is still needed here to report the file size, but it is deliberately not forwarded
 * to the client — only the metadata crosses the frame boundary, and the bytes are re-read on
 * demand when the user actually downloads an attachment.
 */
export async function collectAttachments(
    attachments: Map<string, { filename?: string }> | null | undefined,
    getContent: (id: string) => Promise<Uint8Array | null | undefined>
): Promise<PdfAttachment[]> {
    if (!attachments?.size) {
        return [];
    }

    return Promise.all(Array.from(attachments, async ([id, attachment]) => ({
        id,
        filename: attachment.filename || id,
        size: (await getContent(id))?.length ?? 0
    })));
}

async function extractAndSendAttachments() {
    const app = window.PDFViewerApplication;
    let attachments: PdfAttachment[] = [];

    try {
        attachments = await collectAttachments(
            await app.pdfDocument.getAttachments(),
            (id) => app.pdfDocument.getAttachmentContent(id));
    } catch (error) {
        console.error("Error extracting attachments:", error);
    }

    window.parent.postMessage({
        type: "pdfjs-viewer-attachments",
        attachments,
        ntxId: window.TRILIUM_NTX_ID,
        noteId: window.TRILIUM_NOTE_ID
    } satisfies PdfViewerAttachmentsMessage, window.location.origin);
}

async function downloadAttachment(id: string) {
    const app = window.PDFViewerApplication;

    try {
        const content = await app.pdfDocument.getAttachmentContent(id);

        if (!content) {
            console.error("Attachment not found:", id);
            return;
        }

        const attachments = await app.pdfDocument.getAttachments();
        const filename = attachments?.get(id)?.filename || id;

        // Create blob and download
        // Copied into a fresh view since pdf.js types the content as a possibly shared buffer.
        const blob = new Blob([new Uint8Array(content)], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();

        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Error downloading attachment:", error);
    }
}
