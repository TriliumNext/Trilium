import { test, expect } from "@playwright/test";
import App from "../support/app";

test("displays simple map", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab("Sample mindmap");

    await expect(app.currentNoteSplit).toContainText("Hello world");
    await expect(app.currentNoteSplit).toContainText("1");
    await expect(app.currentNoteSplit).toContainText("1a");
});

test("displays note settings", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab("Sample mindmap");

    await app.currentNoteSplit.locator("me-tpc").filter({ hasText: "Hello world" }).click({ force: true });
    const nodePanel = app.currentNoteSplit.locator(".mind-map-node-panel");
    await expect(nodePanel).toBeVisible();
});
