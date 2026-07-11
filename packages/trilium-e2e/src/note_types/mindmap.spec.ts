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

    await app.currentNoteSplit.getByText("Hello world").click({ force: true });
    const nodeMenu = app.currentNoteSplit.locator(".node-menu");
    await expect(nodeMenu).toBeVisible();
});
