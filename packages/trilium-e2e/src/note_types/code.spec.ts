import { test, expect, Page } from "@playwright/test";
import App from "../support/app";

// The script linter runs the real TypeScript language service, loaded lazily the
// first time a script note opens. Pulling in the TS compiler + bundled lib.*.d.ts
// is far slower than Playwright's default 5s assertion timeout, so the diagnostic
// assertions get a generous window.
const DIAGNOSTICS_TIMEOUT = 30_000;

test("Displays lint warnings for backend script", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.closeAllTabs();
    await app.goToNoteInNewTab("Backend script with lint warnings");

    const codeEditor = app.currentNoteSplit.locator(".cm-editor");

    // The fixture has unreachable code (statements after `return`) in two
    // functions, so TypeScript emits two TS7027 warnings — one gutter marker each.
    const warningMarker = codeEditor.locator(".cm-gutter-lint .cm-lint-marker-warning");
    await expect(warningMarker).toHaveCount(2, { timeout: DIAGNOSTICS_TIMEOUT });

    await warningMarker.first().hover();
    await expectTooltip(page, "Unreachable code detected.");
});

test("Displays lint errors for backend script", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.closeAllTabs();
    await app.goToNoteInNewTab("Backend script with lint errors");

    const codeEditor = app.currentNoteSplit.locator(".cm-editor");

    // The fixture has a typo (`functiox`) that TypeScript can't parse — several
    // diagnostics, all on the same line, collapse to a single error gutter marker.
    const errorMarker = codeEditor.locator(".cm-gutter-lint .cm-lint-marker-error");
    await expect(errorMarker).toHaveCount(1, { timeout: DIAGNOSTICS_TIMEOUT });

    await errorMarker.hover();
    await expectTooltip(page, "Unknown keyword or identifier. Did you mean 'function'?");
});

async function expectTooltip(page: Page, tooltip: string) {
    await expect(
        page.locator(".cm-tooltip:visible", {
            hasText: tooltip
        })
    ).toBeVisible();
}
