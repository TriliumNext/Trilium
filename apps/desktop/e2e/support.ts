import { expect, Locator, Page } from "@playwright/test";

export default class App {

    readonly noteTree: Locator;
    readonly currentNoteSplit: Locator;
    readonly currentNoteSplitTitle: Locator;
    readonly currentNoteSplitContent: Locator;
    page: Page;

    constructor(page: Page) {
        this.page = page;
        this.noteTree = page.locator(".tree-wrapper");
        this.currentNoteSplit = page.locator(".note-split:not(.hidden-ext)");
        this.currentNoteSplitTitle = this.currentNoteSplit.locator(".title-row .note-title");
        this.currentNoteSplitContent = this.currentNoteSplit.locator(".note-detail-printable.visible");
    }

    async selectNoteInNoteTree(noteTitle: string) {
        const item = this.noteTree.locator(`span.fancytree-node`, { hasText: noteTitle });
        await item.click();
        await expect(this.currentNoteSplitTitle).toHaveValue(noteTitle);
    }

    async setNoteShared(shared: boolean) {
        await this.currentNoteSplit.locator(".note-actions button").first().click();
        const menu = this.page.locator(".tn-dropdown-portal.note-actions .dropdown-menu").first();
        await expect(menu).toBeVisible();

        const sharedItem = menu.locator(".dropdown-item").filter({ has: this.page.locator(".bx-share-alt") });
        const toggle = sharedItem.locator("input");
        await expect(toggle).toBeChecked({ checked: !shared });

        await sharedItem.click();
        await expect(toggle).toBeChecked({ checked: shared });

        await this.page.keyboard.press("Escape");
    }

}
