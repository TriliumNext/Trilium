import { test, expect } from "@playwright/test";
import App from "../support/app";

test("renders global map", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.launcherBar.locator(".launcher-button.bx-map-alt").click();
    await expect(app.currentNoteSplit.locator(".force-graph-container canvas")).toBeVisible();
});
