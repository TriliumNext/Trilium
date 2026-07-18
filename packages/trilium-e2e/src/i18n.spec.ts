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
    await app.goToSettingsPage("_optionsLocalization");

    await expect(app.optionsDialogContent).toContainText("Localization");
    await expect(app.optionsDialogContent).toContainText("Language");
});

test("User can change language from settings", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();

    await app.closeAllTabs();
    await app.goToSettings();
    await app.goToSettingsPage("_optionsLocalization");

    const languageCombobox = app.dropdown(app.optionsDialogContent.locator(".options-section .dropdown").first());
    const restartButton = app.optionsDialogContent.locator("button[name=restart-app-button]");

    // Check that the default value (English) is set.
    await expect(app.optionsDialogContent).toContainText("First day of the week");
    await expect(languageCombobox).toContainText("English (United States)");

    // Select Chinese and ensure the translation is set. The restart reloads the frontend, which
    // closes the settings dialog, so it needs to be reopened.
    await languageCombobox.selectOptionByText("简体中文");
    await restartButton.click();
    await expect(app.optionsDialog).toBeHidden({ timeout: 15000 });

    await app.goToSettings();
    await app.goToSettingsPage("_optionsLocalization");
    await expect(app.optionsDialogContent).toContainText("一周的第一天", { timeout: 15000 });
    await expect(languageCombobox).toContainText("简体中文");

    // Select English again.
    await languageCombobox.selectOptionByText("English (United States)");
    await restartButton.click();
    await expect(app.optionsDialog).toBeHidden({ timeout: 15000 });

    await app.goToSettings();
    await app.goToSettingsPage("_optionsLocalization");
    await expect(app.optionsDialogContent).toContainText("Language", { timeout: 15000 });
    await expect(languageCombobox).toContainText("English (United States)");
});
