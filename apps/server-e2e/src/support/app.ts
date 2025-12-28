import type { BrowserContext } from "@playwright/test";
import { expect, Locator, Page } from "@playwright/test";

interface GotoOpts {
    url?: string;
    isMobile?: boolean;
    preserveTabs?: boolean;
}

const BASE_URL = "http://127.0.0.1:8082";

interface DropdownLocator extends Locator {
    selectOptionByText: (text: string) => Promise<void>;
}

export default class App {
    readonly page: Page;
    readonly context: BrowserContext;

    readonly tabBar: Locator;
    readonly noteTree: Locator;
    readonly noteTreeActiveNote: Locator;
    readonly noteTreeHoistedNote: Locator;
    readonly launcherBar: Locator;
    readonly currentNoteSplit: Locator;
    readonly currentNoteSplitTitle: Locator;
    readonly currentNoteSplitContent: Locator;
    readonly sidebar: Locator;

    constructor(page: Page, context: BrowserContext) {
        this.page = page;
        this.context = context;

        this.tabBar = page.locator(".tab-row-widget-container");
        this.noteTree = page.locator(".tree-wrapper");
        this.noteTreeActiveNote = this.noteTree.locator(".fancytree-node.fancytree-active");
        this.noteTreeHoistedNote = this.noteTree.locator(".fancytree-node", { has: page.locator(".unhoist-button") });
        this.launcherBar = page.locator("#launcher-container");
        this.currentNoteSplit = page.locator(".note-split:not(.hidden-ext)");
        this.currentNoteSplitTitle = this.currentNoteSplit.locator(".note-title");
        this.currentNoteSplitContent = this.currentNoteSplit.locator(".note-detail-printable.visible");
        this.sidebar = page.locator("#right-pane");
    }

    async goto({ url, isMobile, preserveTabs }: GotoOpts = {}) {
        await this.context.addCookies([
            {
                url: BASE_URL,
                name: "trilium-device",
                value: isMobile ? "mobile" : "desktop"
            }
        ]);

        if (!url) {
            url = "/";
        }

        await this.page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

        // Wait for the page to load.
        if (url === "/") {
            await expect(this.page.locator(".tree")).toContainText("Trilium Integration Test");
            if (!preserveTabs) {
                await this.closeAllTabs();
            }
        }
    }

    async goToNoteInNewTab(noteTitle: string) {
        const autocomplete = this.currentNoteSplit.locator(".note-autocomplete");
        await autocomplete.fill(noteTitle);

        const resultsSelector = this.currentNoteSplit.locator(".note-detail-empty-results");
        await expect(resultsSelector).toContainText(noteTitle);
        await resultsSelector.locator(".aa-suggestion", { hasText: noteTitle })
            .nth(1) // Select the second one, as the first one is "Create a new note"
            .click();
    }

    async goToSettings() {
        await this.page.locator(".launcher-button.bx-cog").click();
    }

    getTab(tabIndex: number) {
        return this.tabBar.locator(".note-tab-wrapper").nth(tabIndex);
    }

    getActiveTab() {
        return this.tabBar.locator(".note-tab[active]");
    }

    /**
     * Closes all the tabs in the client by issuing a command.
     */
    async closeAllTabs() {
        await this.triggerCommand("closeAllTabs");
        // Page in Playwright is not updated somehow, need to click on the tab to make sure it's rendered
        await this.getTab(0).click();
    }

    /**
     * Adds a new tab by cliking on the + button near the tab bar.
     */
    async addNewTab() {
        await this.page.locator('[data-trigger-command="openNewTab"]').click();
    }

    /**
     * Looks for a given title in the note tree and clicks on it. Useful for selecting option pages in settings in a similar fashion as the user.
     * @param title the title of the note to click, as displayed in the note tree.
     */
    async clickNoteOnNoteTreeByTitle(title: string) {
        await this.noteTree.getByText(title).click();
    }

    /**
     * Opens the note context menu by clicking on it, looks for the item with the given text and clicks it.
     *
     * Assertions are put in place to make sure the menu is open and closed after the click.
     * @param itemToFind the text of the item to find in the menu.
     */
    async openAndClickNoteActionMenu(itemToFind: string) {
        const noteActionsButton = this.currentNoteSplit.locator(".note-actions");
        await noteActionsButton.click();

        const dropdownMenu = noteActionsButton.locator(".dropdown-menu").first();
        await this.page.waitForTimeout(100);
        await expect(dropdownMenu).toBeVisible();
        dropdownMenu.getByText(itemToFind).click();
        await expect(dropdownMenu).not.toBeVisible();
    }

    /**
     * Obtains the locator to the find and replace widget, if it's being displayed.
     */
    get findAndReplaceWidget() {
        return this.page.locator(".component.visible.find-replace-widget");
    }

    /**
     * Executes any Trilium command on the client.
     * @param command the command to send.
     */
    async triggerCommand(command: string) {
        await this.page.evaluate(async (command: string) => {
            await (window as any).glob.appContext.triggerCommand(command);
        }, command);
    }

    async setOption(key: string, value: string) {
        const csrfToken = await this.page.evaluate(() => {
            return (window as any).glob.csrfToken;
        });

        expect(csrfToken).toBeTruthy();
        await expect(
            await this.page.request.put(`${BASE_URL}/api/options/${key}/${value}`, {
                headers: {
                    "x-csrf-token": csrfToken
                }
            })
        ).toBeOK();
    }

    dropdown(_locator: Locator): DropdownLocator {
        const locator = _locator as DropdownLocator;
        locator.selectOptionByText = async (text: string) => {
            await locator.locator(".dropdown-toggle").click();
            await locator.locator(".dropdown-item", { hasText: text }).click();
        };
        return locator;
    }

}
