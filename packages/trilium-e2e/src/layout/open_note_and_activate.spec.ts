import { test, expect } from "@playwright/test";
import App from "../support/app";

const NOTE_TITLE = "Trilium Integration Test DB";

test("Opens and activate a note from launcher Bar", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.closeAllTabs();

    const mapButton = app.launcherBar.locator(".launcher-button.bx-search");
    await expect(mapButton).toBeVisible();

    await page.keyboard.down('Control');
    await page.keyboard.down('Shift');

    await mapButton.click();

    await page.keyboard.up('Control');
    await page.keyboard.up('Shift');

    const tabs = app.tabBar.locator(".note-tab");
    await expect(tabs).toHaveCount(2);

    const secondTab = tabs.nth(1);
    await expect(secondTab).toHaveAttribute('active', '');
});

test("Opens and activate a note from note tree", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.closeAllTabs();

    await page.keyboard.down('Control');
    await page.keyboard.down('Shift');

    await app.clickNoteOnNoteTreeByTitle(NOTE_TITLE);

    await page.keyboard.up('Control');
    await page.keyboard.up('Shift');

    const tabs = app.tabBar.locator(".note-tab");
    await expect(tabs).toHaveCount(2);

    const secondTab = tabs.nth(1);
    await expect(secondTab).toHaveAttribute('active', '');
});
