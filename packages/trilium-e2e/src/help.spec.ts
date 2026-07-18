import { test, expect } from "@playwright/test";
import App, { isStandalone } from "./support/app";

test("Help popup", async ({ page, context }) => {
    page.setDefaultTimeout(15_000);

    const app = new App(page, context);
    await app.goto();

    await app.currentNoteSplit.press("Shift+F1");
    await expect(page.locator(".help-cards")).toBeVisible();
});

test("In-app-help works in English", async ({ page, context }, testInfo) => {
    const app = new App(page, context);
    await app.goto();

    await app.currentNoteSplit.press("F1");
    const title = "User Guide";
    await expect(app.noteTreeHoistedNote).toContainText(title);
    await expect(app.currentNoteSplitTitle).toHaveValue(title);

    app.noteTree.getByText("Troubleshooting").click();
    await expect(app.currentNoteSplitTitle).toHaveValue("Troubleshooting");

    if (isStandalone(testInfo)) {
        // Standalone renders help as webView iframes pointing to docs site
        const iframe = app.currentNoteSplitContent.locator("iframe");
        await expect(iframe).toBeVisible();
        await expect(iframe).toHaveAttribute("src", /docs\.triliumnotes\.org.*troubleshooting/);
    } else {
        // Server/desktop renders help as inline doc content
        await app.currentNoteSplitContent.locator("p").first().waitFor({ state: "visible" });
        expect(await app.currentNoteSplitContent.locator("p").count()).toBeGreaterThan(10);
    }
});

test("In-app-help works in other languages", async ({ page, context }, testInfo) => {
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

        if (isStandalone(testInfo)) {
            const iframe = app.currentNoteSplitContent.locator("iframe");
            await expect(iframe).toBeVisible();
            await expect(iframe).toHaveAttribute("src", /docs\.triliumnotes\.org.*troubleshooting/);
        } else {
            await app.currentNoteSplitContent.locator("p").first().waitFor({ state: "visible" });
            expect(await app.currentNoteSplitContent.locator("p").count()).toBeGreaterThan(10);
        }
    } finally {
        // Ensure English is set after each locale change to avoid any leaks to other tests.
        await app.setOption("locale", "en");
    }
});
