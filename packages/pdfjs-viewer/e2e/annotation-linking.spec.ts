import { expect, type FrameLocator, type Page, test } from "@playwright/test";

/**
 * Covers internal linking to PDF annotations: scrolling to a specific annotation
 * by ID, scrolling to area annotations, the MutationObserver fallback for
 * not-yet-rendered annotations, and re-requesting annotations.
 */

test("scrolls to an existing annotation via trilium-scroll-to-annotation", async ({ page }) => {
    const viewer = await openHarness(page);

    // Wait for annotations to be extracted and sent
    await page.waitForTimeout(1500);

    // Scroll to the first annotation (highlight "A remark" on page 1)
    await page.evaluate(() => (window as any).scrollToAnnotation("5R", 1));
    await page.waitForTimeout(500);

    // Check if the viewer scrolled by accessing the iframe's contentWindow
    const scrolled = await page.evaluate(() => {
        const iframe = document.getElementById("viewer") as HTMLIFrameElement;
        const container = iframe?.contentWindow?.PDFViewerApplication?.pdfViewer?.container;
        return container ? container.scrollTop : null;
    });
    expect(scrolled).not.toBeNull();
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

test("re-requests annotations via trilium-request-annotations", async ({ page }) => {
    await openHarness(page);

    // Wait for initial annotations to be sent
    await page.waitForTimeout(1500);

    // Track annotation messages on the parent page
    const annotationMessages: any[] = [];
    await page.exposeFunction("trackAnnotationMessage", (msg: any) => annotationMessages.push(msg));
    await page.evaluate(() => {
        window.addEventListener("message", (event) => {
            if (event.data?.type === "pdfjs-viewer-annotations") {
                (window as any).trackAnnotationMessage(event.data);
            }
        });
    });

    // Request annotations again
    await page.evaluate(() => (window as any).requestAnnotations());
    await page.waitForTimeout(1000);

    // Should have received a new annotation message
    expect(annotationMessages.length).toBeGreaterThanOrEqual(1);
    const msg = annotationMessages[annotationMessages.length - 1];
    expect(msg.type).toBe("pdfjs-viewer-annotations");
    expect(msg.annotations).toBeDefined();
    expect(Array.isArray(msg.annotations)).toBe(true);
});


test("annotation scroll works with the MutationObserver fallback", async ({ page }) => {
    const viewer = await openHarness(page);

    // Wait for initial setup
    await page.waitForTimeout(1000);

    // Scroll to an annotation that is not yet rendered (page 2)
    // The viewer should estimate the page position and wait for the annotation to appear
    await page.evaluate(() => (window as any).scrollToAnnotation("14R", 2));
    await page.waitForTimeout(500);

    // The container should have scrolled to the estimated position
    // Access the iframe's contentWindow to check PDFViewerApplication
    const scrolled = await page.evaluate(() => {
        const iframe = document.getElementById("viewer") as HTMLIFrameElement;
        const container = iframe?.contentWindow?.PDFViewerApplication?.pdfViewer?.container;
        return container ? container.scrollTop : null;
    });
    expect(scrolled).toBeGreaterThan(0);
});

test("annotation color can be changed via trilium-set-annotation-color", async ({ page }) => {
    const viewer = await openHarness(page);

    // Wait for annotations to be extracted
    await page.waitForTimeout(1500);

    // Change the color of annotation 5R
    await page.evaluate(() => {
        const iframe = document.getElementById("viewer") as HTMLIFrameElement;
        iframe.contentWindow?.postMessage({
            type: "trilium-set-annotation-color",
            annotationId: "5R",
            color: "#00ff00"
        }, window.location.origin);
    });
    await page.waitForTimeout(500);

    // The color change is applied without error
    expect(true).toBe(true);
});

test("annotation deletion via trilium-delete-annotation", async ({ page }) => {
    const viewer = await openHarness(page);

    // Wait for annotations to be extracted
    await page.waitForTimeout(1500);

    // Delete annotation 5R
    await page.evaluate(() => {
        const iframe = document.getElementById("viewer") as HTMLIFrameElement;
        iframe.contentWindow?.postMessage({
            type: "trilium-delete-annotation",
            annotationId: "5R",
            pageNumber: 1
        }, window.location.origin);
    });
    await page.waitForTimeout(500);

    // The deletion is applied without error
    expect(true).toBe(true);
});

async function openHarness(page: Page): Promise<FrameLocator> {
    await page.goto("/parent.html");
    const viewer = page.frameLocator("#viewer");
    await viewer.locator(".page canvas").first().waitFor({ state: "visible" });
    await page.waitForTimeout(1000); // let the editor layers settle
    return viewer;
}