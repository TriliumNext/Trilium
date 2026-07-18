import { test, expect, Page } from "@playwright/test";
import App from "../../../packages/trilium-e2e/src/support/app";

test("Goes to share root", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto({ url: "/share" });
    const noteTitle = "Shared notes";
    await expect(page).toHaveTitle(noteTitle);
    await expect(page.locator("h1")).toHaveText(noteTitle);
});
