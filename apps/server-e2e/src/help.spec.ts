import { test, expect, Page } from "@playwright/test";
import App from "./support/app";

test("Help popup", async ({ page, context }) => {
    page.setDefaultTimeout(15_000);

    const app = new App(page, context);
    await app.goto();

    await app.currentNoteSplit.press("Shift+F1");
    await expect(page.locator(".help-cards")).toBeVisible();
});

test("In-app-help works in English", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();

    await app.currentNoteSplit.press("F1");
    const title = "User Guide";
    await expect(app.noteTreeHoistedNote).toContainText(title);
    await expect(app.currentNoteSplitTitle).toHaveValue(title);

    app.noteTree.getByText("Troubleshooting").click();
    await expect(app.currentNoteSplitTitle).toHaveValue("Troubleshooting");
    await app.currentNoteSplitContent.locator("p").first().waitFor({ state: "visible" });
    expect(await app.currentNoteSplitContent.locator("p").count()).toBeGreaterThan(10);
});

test("In-app-help works in other languages", async ({ page, context }) => {
    const app = new App(page, context);
    try {
        await app.goto();
        await app.setOption("locale", "cn");
        await app.goto();

        await app.currentNoteSplit.press("F1");
        const title = "用户指南";
        await expect(app.noteTreeHoistedNote).toContainText(title);
        await expect(app.currentNoteSplitTitle).toHaveValue(title);

        app.noteTree.getByText("Troubleshooting").click();
        await expect(app.currentNoteSplitTitle).toHaveValue("Troubleshooting");
        await app.currentNoteSplitContent.locator("p").first().waitFor({ state: "visible" });
        expect(await app.currentNoteSplitContent.locator("p").count()).toBeGreaterThan(10);
    } finally {
        // Ensure English is set after each locale change to avoid any leaks to other tests.
        await app.setOption("locale", "en");
    }
});
