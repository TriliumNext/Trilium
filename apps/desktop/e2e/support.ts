import { expect, Locator, Page } from "@playwright/test";

export default class App {

    readonly noteTree: Locator;
    readonly currentNoteSplit: Locator;
    readonly currentNoteSplitTitle: Locator;
    readonly currentNoteSplitRibbon: Locator;
    readonly currentNoteSplitContent: Locator;
    page: Page;

    constructor(page: Page) {
        this.page = page;
        this.noteTree = page.locator(".tree-wrapper");
        this.currentNoteSplit = page.locator(".note-split:not(.hidden-ext)");
        this.currentNoteSplitTitle = this.currentNoteSplit.locator(".note-title");
        this.currentNoteSplitRibbon = this.currentNoteSplit.locator(".ribbon-container");
        this.currentNoteSplitContent = this.currentNoteSplit.locator(".note-detail-printable.visible");
    }

    async selectNoteInNoteTree(noteTitle: string) {
        const item = this.noteTree.locator(`span.fancytree-node`, { hasText: noteTitle });
        await item.click();
        await expect(this.currentNoteSplitTitle).toHaveValue(noteTitle);
    }

    async goToRibbonTab(tabName: string) {
        await this.currentNoteSplitRibbon.locator(`.ribbon-tab-title`, { hasText: tabName }).click();
    }

    async setNoteShared(shared: boolean) {
        await this.goToRibbonTab("Basic Properties");

        // Ensure the initial state.
        const switchButton = this.currentNoteSplitRibbon.locator(`.shared-switch-container .switch-button`);
        if (shared) {
            await expect(switchButton.locator("input")).not.toBeChecked();
        } else {
            await expect(switchButton.locator("input")).toBeChecked();
        }

        // Click the switch to change the state.
        await switchButton.click();

        // Verify the state after clicking.
        if (shared) {
            await expect(switchButton.locator("input")).toBeChecked();
        } else {
            await expect(switchButton.locator("input")).not.toBeChecked();
        }
    }

}
