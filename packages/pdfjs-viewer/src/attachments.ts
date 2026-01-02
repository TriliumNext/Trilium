export async function setupPdfAttachments() {
    // Extract immediately since we're called after documentloaded
    await extractAndSendAttachments();

    // Listen for download requests
    window.addEventListener("message", async (event) => {
        // Only accept messages from the same origin to prevent malicious iframes
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === "trilium-download-attachment") {
            const filename = event.data.filename;
            await downloadAttachment(filename);
        }
    });
}

async function extractAndSendAttachments() {
    const app = window.PDFViewerApplication;

    try {
        const attachments = await app.pdfDocument.getAttachments();

        if (!attachments) {
            window.parent.postMessage({
                type: "pdfjs-viewer-attachments",
                attachments: []
            }, window.location.origin);
            return;
        }

        // Convert attachments object to array
        const attachmentList = Object.entries(attachments).map(([filename, data]: [string, any]) => ({
            filename,
            content: data.content, // Uint8Array
            size: data.content?.length || 0
        }));

        // Send metadata only (not the full content)
        window.parent.postMessage({
            type: "pdfjs-viewer-attachments",
            attachments: attachmentList.map(att => ({
                filename: att.filename,
                size: att.size
            }))
        }, window.location.origin);
    } catch (error) {
        console.error("Error extracting attachments:", error);
        window.parent.postMessage({
            type: "pdfjs-viewer-attachments",
            attachments: []
        }, window.location.origin);
    }
}

async function downloadAttachment(filename: string) {
    const app = window.PDFViewerApplication;

    try {
        const attachments = await app.pdfDocument.getAttachments();
        const attachment = attachments?.[filename];

        if (!attachment) {
            console.error("Attachment not found:", filename);
            return;
        }

        // Create blob and download
        const blob = new Blob([attachment.content], { type: "application/octet-stream" });
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
