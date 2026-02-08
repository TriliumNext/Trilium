import { expect,test } from "@playwright/test";

import App from "../support/app";

const NOTE_TITLE = "Trilium Integration Test DB";

test("Can drag tabs around", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();

    // [1]: Trilium Integration Test DB note
    await app.closeAllTabs();
    await app.clickNoteOnNoteTreeByTitle(NOTE_TITLE);
    await expect(app.getActiveTab()).toContainText(NOTE_TITLE);

    // [1] [2] [3]
    await app.addNewTab();
    await app.addNewTab();

    let tab = await app.getTab(0);

    // Drag the first tab at the end
    await tab.dragTo(await app.getTab(2), { targetPosition: { x: 50, y: 0 } });

    tab = await app.getTab(2);
    await expect(tab).toContainText(NOTE_TITLE);

    // Drag the tab to the left
    await tab.dragTo(await app.getTab(0), { targetPosition: { x: 50, y: 0 } });
    await expect(await app.getTab(0)).toContainText(NOTE_TITLE);
});

test("Can drag tab to new window", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();

    await app.closeAllTabs();
    await app.clickNoteOnNoteTreeByTitle(NOTE_TITLE);
    const tab = await app.getTab(0);
    await expect(tab).toContainText(NOTE_TITLE);

    const popupPromise = page.waitForEvent("popup");

    const tabPos = await tab.boundingBox();
    if (tabPos) {
        const x = tabPos.x + tabPos.width / 2;
        const y = tabPos.y + tabPos.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + tabPos.height + 100, { steps: 5 });
        await page.mouse.up();
    } else {
        test.fail(true, "Unable to determine tab position");
    }

    // Wait for the popup to show
    const popup = await popupPromise;
    const popupApp = new App(popup, context);
    await expect(popupApp.getActiveTab()).toHaveText(NOTE_TITLE);
});

test("Tabs are restored in right order", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();

    // Open three tabs.
    await app.closeAllTabs();
    await app.goToNoteInNewTab("Code notes");
    await expect(app.getActiveTab()).toContainText("Code notes");
    await app.addNewTab();
    await app.goToNoteInNewTab("Text notes");
    await expect(app.getActiveTab()).toContainText("Text notes");
    await app.addNewTab();
    await app.goToNoteInNewTab("Mermaid");
    await expect(app.getActiveTab()).toContainText("Mermaid");

    // Select the mid one.
    await (await app.getTab(1)).click();
    await expect(app.noteTreeActiveNote).toContainText("Text notes");

    // Refresh the page and check the order.
    await app.goto( { preserveTabs: true });
    await expect(await app.getTab(0)).toContainText("Code notes");
    await expect(await app.getTab(1)).toContainText("Text notes");
    await expect(await app.getTab(2)).toContainText("Mermaid");

    // Check the note tree has the right active node.
    await expect(app.noteTreeActiveNote).toContainText("Text notes");
});

test("Empty tabs are cleared out", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();

    // Open three tabs.
    await app.closeAllTabs();
    await app.addNewTab();
    await app.goToNoteInNewTab("Code notes");
    await app.addNewTab();
    await app.addNewTab();

    // Refresh the page and check the order.
    await app.goto({ preserveTabs: true });

    // Expect no empty tabs.
    expect(await app.tabBar.locator(".note-tab-wrapper").count()).toBe(1);
});

test("Search works when dismissing a tab", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();

    await app.goToNoteInNewTab("Table of contents");
    await app.openAndClickNoteActionMenu("Search in note");
    await expect(app.findAndReplaceWidget).toBeVisible();
    app.findAndReplaceWidget.locator(".find-widget-close-button").click();

    await app.addNewTab();
    await app.goToNoteInNewTab("Sample mindmap");

    await (await app.getTab(0)).click();
    await app.openAndClickNoteActionMenu("Search in note");
    await expect(app.findAndReplaceWidget.first()).toBeVisible();
});

test("New tab displays workspaces", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();

    const workspaceNotesEl = app.currentNoteSplitContent.locator(".workspace-notes");
    await expect(workspaceNotesEl).toBeVisible();
    await expect(workspaceNotesEl).toContainText("Personal");
    await expect(workspaceNotesEl).toContainText("Work");
    await expect(workspaceNotesEl.locator(".bx.bxs-user")).toBeVisible();
    await expect(workspaceNotesEl.locator(".bx.bx-briefcase-alt")).toBeVisible();

    await app.closeAllTabs();
});
