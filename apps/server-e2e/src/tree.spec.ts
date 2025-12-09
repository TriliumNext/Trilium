import test, { expect } from "@playwright/test";
import App from "./support/app";

test("Renders on desktop", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await expect(app.noteTree).toContainText("Trilium Integration Test");
});

test("Renders on mobile", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto({ isMobile: true });
    await expect(app.noteTree).toContainText("Trilium Integration Test");
});
