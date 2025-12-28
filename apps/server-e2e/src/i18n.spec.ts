import { test, expect, Page } from "@playwright/test";
import App from "./support/app";

test.afterEach(async ({ page, context }) => {
    const app = new App(page, context);
    // Ensure English is set after each locale change to avoid any leaks to other tests.
    await app.setOption("locale", "en");
});

test("Displays translation on desktop", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();

    await expect(page.locator("#left-pane .quick-search input")).toHaveAttribute("placeholder", "Quick search");
});

test("Displays translation on mobile", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto({ isMobile: true });

    await expect(page.locator("#mobile-sidebar-wrapper .quick-search input")).toHaveAttribute("placeholder", "Quick search");
});

test("Displays translations in Settings", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.closeAllTabs();
    await app.goToSettings();
    await app.noteTree.getByText("Language & Region").click();

    await expect(app.currentNoteSplit).toContainText("Localization");
    await expect(app.currentNoteSplit).toContainText("Language");
});

test("User can change language from settings", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();

    await app.closeAllTabs();
    await app.goToSettings();
    await app.noteTree.getByText("Language & Region").click();

    // Check that the default value (English) is set.
    await expect(app.currentNoteSplit).toContainText("First day of the week");
    const languageCombobox = app.dropdown(app.currentNoteSplit.locator(".options-section .dropdown").first());
    await expect(languageCombobox).toContainText("English (United States)");

    // Select Chinese and ensure the translation is set.
    await languageCombobox.selectOptionByText("简体中文");
    await app.currentNoteSplit.locator("button[name=restart-app-button]").click();

    await expect(app.currentNoteSplit).toContainText("一周的第一天", { timeout: 15000 });
    await expect(languageCombobox).toContainText("简体中文");

    // Select English again.
    await languageCombobox.selectOptionByText("English (United States)");
    await app.currentNoteSplit.locator("button[name=restart-app-button]").click();
    await expect(app.currentNoteSplit).toContainText("Language", { timeout: 15000 });
    await expect(languageCombobox).toContainText("English (United States)");
});
