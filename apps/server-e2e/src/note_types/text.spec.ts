import { expect, test } from "@playwright/test";

import App from "../support/app";

test("Table of contents is displayed", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.closeAllTabs();
    await app.goToNoteInNewTab("Table of contents");

    await expect(app.sidebar).toContainText("Table of Contents");
    const rootList = app.sidebar.locator(".toc > ol");

    // Heading 1.1
    //  Heading 1.1
    //  Heading 1.2
    // Heading 2
    //  Heading 2.1
    //  Heading 2.2
    //     Heading 2.2.1
    //          Heading 2.2.1.1
    //              Heading 2.2.11.1

    await expect(rootList.locator("> li")).toHaveCount(2);
    await expect(rootList.locator("> li").first()).toHaveText("Heading 1");
    await expect(rootList.locator("> ol").first().locator("> li").first()).toHaveText("Heading 1.1");
    await expect(rootList.locator("> ol").first().locator("> li").nth(1)).toHaveText("Heading 1.2");

    // Heading 2 has a Katex equation, check if it's rendered.
    await expect(rootList.locator("> li").nth(1)).toContainText("Heading 2");
    await expect(rootList.locator("> li").nth(1).locator(".katex")).toBeAttached();

    await expect(rootList.locator("> ol")).toHaveCount(2);
    await expect(rootList.locator("> ol").nth(1).locator("> li")).toHaveCount(2);
    await expect(rootList.locator("> ol").nth(1).locator("> ol")).toHaveCount(1);
    await expect(rootList.locator("> ol").nth(1).locator("> ol > ol")).toHaveCount(1);
    await expect(rootList.locator("> ol").nth(1).locator("> ol > ol > ol")).toHaveCount(1);
});

test("Highlights list is displayed", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.closeAllTabs();
    await app.goToNoteInNewTab("Highlights list");

    await expect(app.sidebar).toContainText("10 highlights");
    const rootList = app.sidebar.locator(".highlights-list ol");
    let index = 0;
    for (const highlightedEl of ["Bold 1", "Italic 1", "Underline 1", "Colored text 1", "Background text 1", "Bold 2", "Italic 2", "Underline 2", "Colored text 2", "Background text 2"]) {
        await expect(rootList.locator("li").nth(index++)).toContainText(highlightedEl);
    }
});

test("Displays math popup", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab("Empty text");
    const noteContent = app.currentNoteSplit.locator(".note-detail-editable-text-editor");
    await expect(noteContent.locator("p")).toBeVisible();
    await noteContent.focus();
    await noteContent.fill("Hello world");
    await noteContent.press("ControlOrMeta+M");

    const mathForm = page.locator(".ck-math-form");
    await expect(mathForm).toBeVisible();

    const input = mathForm.locator(".ck-latex-textarea").first();
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
    await input.click();
    await input.fill("e=mc^2");
    await page.waitForTimeout(100);

    const preview = page.locator('[id^="math-preview"]');
    await preview.waitFor({
        state: 'visible',
        timeout: 5000
    });

    await page.waitForFunction((): boolean => {
        const preview = document.querySelector('[id^="math-preview"]');
        if (!preview) return false;
        const katex = preview.querySelector('.katex');
        return !!katex && window.getComputedStyle(preview).display !== 'none';
    }, { timeout: 5000 });

    await expect(preview.locator('.katex')).toBeVisible();
    await expect(preview).toMatchAriaSnapshot("- math: e = m c 2");
});
