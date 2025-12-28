import { test, expect } from "@playwright/test";
import App from "../support/app";

const TEXT_NOTE_TITLE = "Text notes";
const CODE_NOTE_TITLE = "Code notes";

test("Open the note in the correct split pane", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.closeAllTabs();

    // Open the first split.
    await app.goToNoteInNewTab(TEXT_NOTE_TITLE);
    const split1 = app.currentNoteSplit;

    // Create a new split.
    const splitButton = split1.locator("button.bx-dock-right");
    await expect(splitButton).toBeVisible();
    await splitButton.click();

    // Search for "Code notes" in the empty area of the second split.
    const split2 = app.currentNoteSplit.nth(1);;
    await expect(split2).toBeVisible();
    const autocomplete = split2.locator(".note-autocomplete");
    await autocomplete.fill(CODE_NOTE_TITLE);
    const resultsSelector = split2.locator(".note-detail-empty-results");
    await expect(resultsSelector).toContainText(CODE_NOTE_TITLE);

    //Focus on the first split.
    const noteContent = split1.locator(".note-detail-editable-text-editor");
    await expect(noteContent.locator("p")).toBeVisible();
    await noteContent.focus();

    // Click the search result in the second split.
    await resultsSelector.locator(".aa-suggestion", { hasText: CODE_NOTE_TITLE })
        .nth(1).click();

    await expect(split2).toContainText(CODE_NOTE_TITLE);
});

test("Can directly focus the autocomplete input within the split", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.closeAllTabs();

    // Open the first split.
    await app.goToNoteInNewTab(TEXT_NOTE_TITLE);
    const split1 = app.currentNoteSplit;

    // Create a new split.
    const splitButton = split1.locator("button.bx-dock-right");
    await expect(splitButton).toBeVisible();
    await splitButton.click();

    // Search for "Code notes" in the empty area of the second split.
    const split2 = app.currentNoteSplit.nth(1);;
    await expect(split2).toBeVisible();

    // Focus the first split.
    const noteContent = split1.locator(".note-detail-editable-text-editor");
    await expect(noteContent.locator("p")).toBeVisible();
    await noteContent.focus();
    await noteContent.click();

    // click the autocomplete input box of the second split
    const autocomplete = split2.locator(".note-autocomplete");
    await autocomplete.focus();
    await autocomplete.click();

    await page.waitForTimeout(100);
    await expect(autocomplete).toBeFocused();
});