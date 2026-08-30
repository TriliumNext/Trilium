import { expect, type FrameLocator, type Page, test } from "@playwright/test";

/**
 * Covers what the sidebar is told about the annotations in the document.
 *
 * The list is built from the loaded document, which is the file as it was opened — pdf.js keeps
 * what the reader draws in its editor layer until the file is written back. Annotations made in
 * this session therefore have to be merged in from the editor, or the panel stays empty however
 * much is annotated (#11059).
 */

test("lists an annotation as soon as it is drawn, with no save", async ({ page, context }) => {
    await context.route("**/sample.pdf", (route) => route.fulfill({
        body: textPdf(), contentType: "application/pdf"
    }));
    await recordAnnotationLists(page);
    const viewer = await openHarness(page);

    await enterHighlightMode(viewer);
    await highlightFirstWords(page, viewer);

    // No save has happened, and none is needed: the entry is in the editor, so it is in the list.
    await expect.poll(() => lastList(page)).toEqual([
        expect.objectContaining({ type: "highlight", pageNumber: 1 })
    ]);
    const [ entry ] = await lastList(page);

    // Its id is the editor's, which is the id of the element it renders — so the sidebar can
    // navigate to it. Nothing in the document carries a matching data-annotation-id yet.
    const frame = page.frame({ url: /viewer\.html/ });
    if (!frame) throw new Error("Viewer frame not found");
    expect(await frame.evaluate((id) => !!document.getElementById(id), entry.id)).toBe(true);
});

test("keeps listing it once the editing state changes again", async ({ page, context }) => {
    await context.route("**/sample.pdf", (route) => route.fulfill({
        body: textPdf(), contentType: "application/pdf"
    }));
    await recordAnnotationLists(page);
    const viewer = await openHarness(page);

    await enterHighlightMode(viewer);
    await highlightFirstWords(page, viewer);
    await expect.poll(() => lastList(page)).toHaveLength(1);

    // The list is rebuilt on every editing event. Rebuilt from the document alone it came back
    // empty, so an annotation appeared only in the gap between a save and the next edit.
    const frame = page.frame({ url: /viewer\.html/ });
    if (!frame) throw new Error("Viewer frame not found");
    await frame.evaluate(() => {
        (window as any).PDFViewerApplication.eventBus.dispatch("editingstateschanged", {
            source: null, details: { hasSomethingToUndo: true }
        });
    });

    await page.waitForTimeout(1000);
    expect(await lastList(page)).toHaveLength(1);
});

/** Records every annotation list the parent receives, as the Trilium client would. */
async function recordAnnotationLists(page: Page) {
    await page.addInitScript(() => {
        if (window.top !== window) return;
        (window as any).annotationLists = [];
        window.addEventListener("message", (event: any) => {
            if (event.data?.type === "pdfjs-viewer-annotations") {
                (window as any).annotationLists.push(event.data.annotations);
            }
        });
    });
}

function lastList(page: Page): Promise<any[]> {
    return page.evaluate(() => (window as any).annotationLists.at(-1) ?? []);
}

async function enterHighlightMode(viewer: FrameLocator) {
    await viewer.locator("#editorHighlightButton").click();
    await viewer.locator(".annotationEditorLayer").first().waitFor({ state: "attached" });
}

/** Drags across the page's only line of text, which pdf.js turns into a highlight. */
async function highlightFirstWords(page: Page, viewer: FrameLocator) {
    const span = viewer.locator(".textLayer span").first();
    const box = await span.boundingBox();
    if (!box) throw new Error("Text layer not rendered");

    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
}

/** A one-page PDF with selectable text, so a highlight can be made over it. */
function textPdf(): Buffer {
    const stream = "BT /F1 24 Tf 72 700 Td (Hello highlight world) Tj ET\n";
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            + "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    ];

    let out = "%PDF-1.7\n";
    const offsets: number[] = [];
    objects.forEach((body, index) => {
        offsets.push(out.length);
        out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefOffset = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
        out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
}

async function openHarness(page: Page): Promise<FrameLocator> {
    await page.goto("/parent.html");
    const viewer = page.frameLocator("#viewer");
    await viewer.locator(".page canvas").first().waitFor({ state: "visible" });
    await page.waitForTimeout(1000);
    return viewer;
}
