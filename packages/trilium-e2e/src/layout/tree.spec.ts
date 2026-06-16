import { test, expect } from "@playwright/test";
import App from "../support/app";

const OPTIONS_TITLE = "Options";
const NOTE_TITLE = "Tree Operations"

test("Hoist note remains expanded when opening Options and clicking child note", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.closeAllTabs();

    // Settings open in a dialog; maximizing it moves them to a tab hoisted on the Options subtree.
    await app.goToSettings();
    await app.optionsDialog.locator(".custom-title-bar-button.bx-expand-alt").click();

    await expect(app.noteTreeHoistedNote).toContainText(OPTIONS_TITLE);
    await expect(app.noteTreeActiveNote).toContainText("Appearance");

    // Clicking a hoist’s child note does not collapse the hoist note
    await app.clickNoteOnNoteTreeByTitle("Shortcuts");
    const node = app.page.locator(".fancytree-node.fancytree-submatch:has(.bx-cog)");
    await expect(node).toHaveClass(/fancytree-expanded/);
});

test("Activate it when hoisting a note", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.closeAllTabs();

    const treeNode = app.noteTree.getByText(NOTE_TITLE);
    await treeNode.click({ button: "right" });
    const hoistMenuItem = page.locator(
        '#context-menu-container .dropdown-item span',
        { hasText: "Hoist note" }
    );
    await hoistMenuItem.click();
    await expect(app.noteTreeActiveNote).toContainText(NOTE_TITLE);
    await app.page.locator(".unhoist-button").click();
    await expect(app.noteTreeActiveNote).toContainText(NOTE_TITLE);
});
