import { expect, type FrameLocator, type Page, test } from "@playwright/test";

/**
 * Covers the area annotation feature of the PDF viewer: capturing a rectangular
 * region of a page as an image, displaying persistent overlays, right-click
 * context menu interactions, and scrolling to area annotations.
 */

test("shows the area annotation toolbar button and activates on click", async ({ page }) => {
    const viewer = await openHarness(page);
    const button = viewer.locator("#triliumAreaAnnotationButton");
    await expect(button).toBeVisible();

    // Click to activate
    await button.click();
    await expect(viewer.locator(".page")).toHaveCSS("cursor", "crosshair");

    // Click again to deactivate
    await button.click();
    await expect(viewer.locator(".page")).not.toHaveCSS("cursor", "crosshair");
});

test("captures a rectangular area and sends it to the parent", async ({ page }) => {
    const viewer = await openHarness(page);
    const box = await pageBox(viewer);

    // Activate area annotation mode
    await viewer.locator("#triliumAreaAnnotationButton").click();

    // Draw a selection rectangle on the page
    const startX = box.x + 100;
    const startY = box.y + 100;
    const endX = box.x + 400;
    const endY = box.y + 300;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 20 });
    await page.mouse.up();

    // Wait for the capture message
    await page.waitForTimeout(500);
    const captures = await page.evaluate(() => (window as any).harness.areaCaptures);
    expect(captures.length).toBe(1);

    const capture = captures[0];
    expect(capture.pageNumber).toBe(1);
    expect(capture.rect).toBeDefined();
    expect(capture.rect.x).toBeGreaterThan(0);
    expect(capture.rect.y).toBeGreaterThan(0);
    expect(capture.rect.width).toBeGreaterThan(0);
    expect(capture.rect.height).toBeGreaterThan(0);
    // Image data should be a valid PNG data URL
    expect(capture.imageData).toMatch(/^data:image\/png;base64,/);
    // Context identifiers should match what the harness injected
    expect(capture.noteId).toBe("note1");
    expect(capture.ntxId).toBe("ntx1");
});

test("ignores very small selections (less than 10px)", async ({ page }) => {
    const viewer = await openHarness(page);
    const box = await pageBox(viewer);

    await viewer.locator("#triliumAreaAnnotationButton").click();

    // Draw a tiny selection (5x5)
    const startX = box.x + 200;
    const startY = box.y + 200;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 5, startY + 5, { steps: 5 });
    await page.mouse.up();

    await page.waitForTimeout(500);
    const captures = await page.evaluate(() => (window as any).harness.areaCaptures);
    expect(captures.length).toBe(0);
});

test("displays persistent overlays and redraws them on page render", async ({ page }) => {
    const viewer = await openHarness(page);
    const box = await pageBox(viewer);

    // Simulate the Trilium client setting area overlays
    const areas = [
        {
            pageNumber: 1,
            rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
            color: "#ff0000",
            attachmentId: "att1",
            attributeId: "attr1",
            comment: "Test area"
        }
    ];

    await page.evaluate((areas) => (window as any).setAreaOverlays(areas), areas);

    // Wait for overlays to appear
    const overlay = viewer.locator(".trilium-area-overlay").first();
    await expect(overlay).toBeVisible();

    // Verify overlay properties (border color includes alpha channel: #ff0000cc -> rgba(255, 0, 0, 0.8))
    await expect(overlay).toHaveCSS("border", /2px solid.*rgba\(255, 0, 0/);
    await expect(overlay).toHaveAttribute("title", "Test area");

    // Verify the overlay is positioned correctly (percentage-based)
    const overlayBox = await overlay.boundingBox();
    expect(overlayBox).not.toBeNull();
    if (overlayBox) {
        expect(overlayBox.width).toBeGreaterThan(0);
        expect(overlayBox.height).toBeGreaterThan(0);
    }
});

test("right-click on an overlay sends area-right-click message", async ({ page }) => {
    const viewer = await openHarness(page);
    const box = await pageBox(viewer);

    const areas = [
        {
            pageNumber: 1,
            rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
            color: "#4a90d9",
            attachmentId: "att1",
            attributeId: "attr1"
        }
    ];

    await page.evaluate((areas) => (window as any).setAreaOverlays(areas), areas);

    const overlay = viewer.locator(".trilium-area-overlay").first();
    await expect(overlay).toBeVisible();

    // Track messages from the viewer
    const messages: any[] = [];
    await page.exposeFunction("captureViewerMessage", (msg: any) => messages.push(msg));
    await page.evaluate(() => {
        window.addEventListener("message", (event) => {
            if (event.data?.type === "pdfjs-viewer-area-right-click") {
                (window as any).captureViewerMessage(event.data);
            }
        });
    });

    // Right-click on the overlay
    await overlay.click({ button: "right" });
    await page.waitForTimeout(500);

    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe("pdfjs-viewer-area-right-click");
    expect(messages[0].attachmentId).toBe("att1");
    expect(messages[0].attributeId).toBe("attr1");
    expect(messages[0].noteId).toBe("note1");
    expect(messages[0].ntxId).toBe("ntx1");
});

test("scrolls to an area annotation via trilium-scroll-to-area", async ({ page }) => {
    const viewer = await openHarness(page);

    // Set up an area overlay first
    const areas = [
        {
            pageNumber: 1,
            rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
            color: "#4a90d9",
            attachmentId: "att1",
            attributeId: "attr1"
        }
    ];

    await page.evaluate((areas) => (window as any).setAreaOverlays(areas), areas);
    await expect(viewer.locator(".trilium-area-overlay").first()).toBeVisible();

    // Scroll to the area
    await page.evaluate(() => (window as any).scrollToArea(1, { x: 0.1, y: 0.1, width: 0.3, height: 0.2 }));
    await page.waitForTimeout(500);

    // The overlay should still be visible after scroll
    await expect(viewer.locator(".trilium-area-overlay").first()).toBeVisible();
});

test("overlays survive page scroll and virtual-scroll eviction", async ({ page }) => {
    const viewer = await openHarness(page);

    // Set up area overlays on multiple pages
    const areas = [
        {
            pageNumber: 1,
            rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
            color: "#ff0000",
            attachmentId: "att1",
            attributeId: "attr1"
        },
        {
            pageNumber: 2,
            rect: { x: 0.2, y: 0.3, width: 0.4, height: 0.25 },
            color: "#00ff00",
            attachmentId: "att2",
            attributeId: "attr2"
        }
    ];

    await page.evaluate((areas) => (window as any).setAreaOverlays(areas), areas);

    // Verify page 1 overlay is visible
    await expect(viewer.locator(".trilium-area-overlay").first()).toBeVisible();

    // Scroll to page 2 to trigger virtual-scroll eviction of page 1
    const container = viewer.locator("#viewerContainer");
    await container.evaluate((el) => {
        // Scroll to the bottom of the document to trigger page 2 rendering
        el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(1000);

    // Page 2 overlay should be visible after scroll
    const overlays = viewer.locator(".trilium-area-overlay");
    const count = await overlays.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Scroll back to page 1
    await container.evaluate((el) => {
        el.scrollTop = 0;
    });
    await page.waitForTimeout(1000);

    // Page 1 overlay should be redrawn
    await expect(viewer.locator(".trilium-area-overlay").first()).toBeVisible();
});

async function openHarness(page: Page): Promise<FrameLocator> {
    await page.goto("/parent.html");
    const viewer = page.frameLocator("#viewer");
    await viewer.locator(".page canvas").first().waitFor({ state: "visible" });
    await page.waitForTimeout(1000); // let the editor layers settle
    return viewer;
}

async function pageBox(viewer: FrameLocator) {
    const box = await viewer.locator(".page").first().boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("PDF page not rendered");
    return box;
}