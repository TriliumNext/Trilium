import test, { BrowserContext, expect, Page } from "@playwright/test";

import App from "../support/app";

test.beforeEach(async ({ page, context }) => {
    const app = await setLayout({ page, context }, true);
    await app.setOption("rightPaneCollapsedItems", "[]");
});
test.afterEach(async ({ page, context }) => await setLayout({ page, context }, false));

test("Table of contents works", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab("Dacia Logan.pdf");

    const toc = app.sidebar.locator(".toc");

    await expect(toc.locator("li")).toHaveCount(48);
    await expect(toc.locator("li", { hasText: "Logan Van" })).toHaveCount(1);

    const pdfHelper = new PdfHelper(app);
    await toc.locator("li", { hasText: "Logan Pick-Up" }).click();
    await pdfHelper.expectPageToBe(13);

    await app.clickNoteOnNoteTreeByTitle("Layers test.pdf");
    await expect(toc.locator("li")).toHaveCount(0);
});

test("Page navigation works", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab("Dacia Logan.pdf");

    const pagesList = app.sidebar.locator(".pdf-pages-list");

    // Check count is correct.
    await expect(app.sidebar).toContainText("28 pages");
    expect(await pagesList.locator(".pdf-page-item").count()).toBe(28);

    // Go to page 3.
    await pagesList.locator(".pdf-page-item").nth(2).click();

    const pdfHelper = new PdfHelper(app);
    await pdfHelper.expectPageToBe(3);

    await app.clickNoteOnNoteTreeByTitle("Layers test.pdf");
    await expect(pagesList.locator(".pdf-page-item")).toHaveCount(1);
});

test("Attachments listing works", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab("Dacia Logan.pdf");

    const attachmentsList = app.sidebar.locator(".pdf-attachments-list");
    await expect(app.sidebar).toContainText("2 attachments");
    await expect(attachmentsList.locator(".pdf-attachment-item")).toHaveCount(2);

    const attachmentInfo = attachmentsList.locator(".pdf-attachment-item", { hasText: "Note.trilium" });
    await expect(attachmentInfo).toContainText("3.36 MiB");

    // Download the attachment and check its size.
    const [ download ] = await Promise.all([
        page.waitForEvent("download"),
        attachmentInfo.locator(".bx-download").click()
    ]);
    expect(download).toBeDefined();

    await app.clickNoteOnNoteTreeByTitle("Layers test.pdf");
    await expect(attachmentsList.locator(".pdf-attachment-item")).toHaveCount(0);
});

test("Download original PDF works", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab("Dacia Logan.pdf");
    const pdfHelper = new PdfHelper(app);
    await pdfHelper.toBeInitialized();

    const [ download ] = await Promise.all([
        page.waitForEvent("download"),
        app.currentNoteSplit.locator(".icon-action.bx.bx-download").click()
    ]);
    expect(download).toBeDefined();
});

test("Layers listing works", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab("Layers test.pdf");

    // Check count is correct.
    await expect(app.sidebar).toContainText("2 layers");
    const layersList = app.sidebar.locator(".pdf-layers-list");
    await expect(layersList.locator(".pdf-layer-item")).toHaveCount(2);

    // Toggle visibility of the first layer.
    const firstLayer = layersList.locator(".pdf-layer-item").first();
    await expect(firstLayer).toContainText("Tongue out");
    await expect(firstLayer).toContainClass("hidden");
    await firstLayer.click();
    await expect(firstLayer).not.toContainClass("visible");

    await app.clickNoteOnNoteTreeByTitle("Dacia Logan.pdf");
    await expect(layersList.locator(".pdf-layer-item")).toHaveCount(0);
});

async function setLayout({ page, context}: { page: Page; context: BrowserContext }, newLayout: boolean) {
    const app = new App(page, context);
    await app.goto();
    await app.setOption("newLayout", newLayout ? "true" : "false");
    return app;
}

class PdfHelper {
    private contentFrame: ReturnType<Page["frameLocator"]>;

    constructor(app: App) {
        this.contentFrame = app.currentNoteSplit.frameLocator("iframe");
    }

    async expectPageToBe(expectedPageNumber: number) {
        await expect(this.contentFrame.locator("#pageNumber")).toHaveValue(`${expectedPageNumber}`);
    }

    async toBeInitialized() {
        await expect(this.contentFrame.locator("#pageNumber")).toBeVisible();
    }
}
