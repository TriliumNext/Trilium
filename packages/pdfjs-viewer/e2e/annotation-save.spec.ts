import { expect, type FrameLocator, type Page, test } from "@playwright/test";

/**
 * Covers the annotation save flow of custom.ts/editing.ts: in-progress ink
 * drawing sessions live outside pdf.js' annotationStorage until committed, so
 * a save request must commit them (without disturbing active interactions) and
 * silent edits must still announce document modifications to the parent.
 */

test("commits an in-progress ink drawing when a save is requested", async ({ page }) => {
    const viewer = await openHarness(page);
    await enterInkMode(viewer);
    const box = await pageBox(viewer);

    // Draw two strokes and stay in ink mode — the annotate button is never
    // pressed again, which previously left the drawing uncommitted forever.
    await drawStroke(page, box, [[200, 200], [300, 250], [380, 210]]);
    await drawStroke(page, box, [[220, 320], [340, 360]]);
    await page.waitForTimeout(500);

    // Every stroke announces a potential modification (the first via pdf.js
    // editing states, later ones via the interaction-end nudge).
    expect(await modifiedCount(page)).toBeGreaterThanOrEqual(2);

    // The save must contain the drawing even though its session was never
    // committed by the user.
    const bytes = await requestBlob(page, 1);
    expect(countInkAnnotations(bytes)).toBe(1);

    // Drawing after the save starts a fresh session, which pdf.js tracks
    // completely silently — the nudge must still announce it so another save
    // gets scheduled, and that save must include it.
    const modifiedBefore = await modifiedCount(page);
    await drawStroke(page, box, [[500, 400], [600, 470], [650, 420]]);
    await page.waitForTimeout(500);
    expect(await modifiedCount(page)).toBeGreaterThan(modifiedBefore);
    expect(countInkAnnotations(await requestBlob(page, 2))).toBe(2);
});

test("does not cut short a stroke that is mid-draw when a save happens", async ({ page }) => {
    const viewer = await openHarness(page);
    await enterInkMode(viewer);
    const box = await pageBox(viewer);

    await drawStroke(page, box, [[200, 200], [320, 260]]);
    await page.waitForTimeout(500);
    expect(countInkAnnotations(await requestBlob(page, 1))).toBe(1);

    // Hold a stroke mid-draw and let a save fire: the commit must be skipped
    // (not truncating the stroke) and the save must still complete.
    await page.mouse.move(box.x + 500, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 560, box.y + 360, { steps: 5 });
    const midStrokeBytes = await requestBlob(page, 2);
    expect(countInkAnnotations(midStrokeBytes)).toBe(1);

    // Finishing the stroke re-announces a modification, and the follow-up save
    // then contains the previously skipped drawing.
    const modifiedBefore = await modifiedCount(page);
    await page.mouse.move(box.x + 620, box.y + 310, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(await modifiedCount(page)).toBeGreaterThan(modifiedBefore);
    expect(countInkAnnotations(await requestBlob(page, 3))).toBe(2);
});

test("does not ask to confirm leaving after the annotation was saved", async ({ page }) => {
    const viewer = await openHarness(page);
    await enterInkMode(viewer);
    const box = await pageBox(viewer);

    await drawStroke(page, box, [[200, 200], [320, 260]]);
    await page.waitForTimeout(500);
    await requestBlob(page, 1);

    // The stock viewer prompts whenever annotationStorage is non-empty, which stays true
    // for the rest of the session — so a reload would prompt even after a completed save.
    // Trilium owns that prompt (the parent blocks unloading while a save is pending), so
    // the viewer's own handler must never fire.
    const frame = page.frame({ url: /viewer\.html/ });
    expect(frame).not.toBeNull();
    if (!frame) throw new Error("Viewer frame not found");
    const { stockWouldPrompt, prompted } = await frame.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return {
            stockWouldPrompt: (window as any).PDFViewerApplication._hasChanges(),
            prompted: event.defaultPrevented
        };
    });
    // Guards the assertion below against passing vacuously: the stock prompt condition
    // really is met, the prompt only stays away because it is suppressed.
    expect(stockWouldPrompt).toBe(true);
    expect(prompted).toBe(false);
});

test("annotations survive reopening the saved document", async ({ page, context }) => {
    const viewer = await openHarness(page);
    await enterInkMode(viewer);
    const box = await pageBox(viewer);

    await drawStroke(page, box, [[250, 250], [400, 330], [480, 260]]);
    await page.waitForTimeout(500);
    const bytes = await requestBlob(page, 1);

    // Open a fresh viewer on the saved bytes — the equivalent of refreshing
    // Trilium after the auto-save.
    await context.route("**/saved.pdf", (route) => route.fulfill({
        body: Buffer.from(bytes),
        contentType: "application/pdf"
    }));
    const reopened = await context.newPage();
    await reopened.goto("/web/viewer.html?v=e2e&file=/saved.pdf&locale=en&editable=1&toolbar=1");
    await reopened.locator(".page canvas").first().waitFor({ state: "visible" });

    const inkCount = await reopened.evaluate(async () => {
        const pdfDocument = (window as any).PDFViewerApplication.pdfDocument;
        const firstPage = await pdfDocument.getPage(1);
        const annotations = await firstPage.getAnnotations({ intent: "display" });
        return annotations.filter((annotation: any) => annotation.subtype === "Ink").length;
    });
    expect(inkCount).toBe(1);
});

async function openHarness(page: Page): Promise<FrameLocator> {
    await page.goto("/parent.html");
    const viewer = page.frameLocator("#viewer");
    await viewer.locator(".page canvas").first().waitFor({ state: "visible" });
    await page.waitForTimeout(1000); // let the editor layers settle
    return viewer;
}

async function enterInkMode(viewer: FrameLocator) {
    await viewer.locator("#editorInkButton").click();
    await viewer.locator(".annotationEditorLayer").first().waitFor({ state: "attached" });
}

async function pageBox(viewer: FrameLocator) {
    const box = await viewer.locator(".page").first().boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("PDF page not rendered");
    return box;
}

async function drawStroke(page: Page, box: { x: number; y: number }, points: [number, number][]) {
    const [first, ...rest] = points;
    await page.mouse.move(box.x + first[0], box.y + first[1]);
    await page.mouse.down();
    for (const [x, y] of rest) {
        await page.mouse.move(box.x + x, box.y + y, { steps: 8 });
    }
    await page.mouse.up();
    await page.waitForTimeout(200);
}

function modifiedCount(page: Page): Promise<number> {
    return page.evaluate(() => (window as any).harness.modifiedCount);
}

/** Requests the document bytes like the Trilium spaced-update save does. */
async function requestBlob(page: Page, expectedCount: number): Promise<number[]> {
    await page.evaluate(() => (window as any).requestBlob());
    await page.waitForFunction((count) => (window as any).harness.blobs.length >= count, expectedCount);
    return page.evaluate((count) => (window as any).harness.blobs[count - 1], expectedCount);
}

/** Ink annotations appear in the incrementally-saved PDF as `/Subtype /Ink` objects. */
function countInkAnnotations(bytes: number[]): number {
    const text = Buffer.from(bytes).toString("latin1");
    return (text.match(/\/Subtype[\s]*\/Ink/g) ?? []).length;
}
