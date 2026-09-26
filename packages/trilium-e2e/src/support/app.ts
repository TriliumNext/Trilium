import type { BrowserContext } from "@playwright/test";
import { expect, Locator, Page } from "@playwright/test";

export interface GotoOpts {
    url?: string;
    isMobile?: boolean;
    preserveTabs?: boolean;
}

export function getBaseUrl(): string {
    const port = process.env["TRILIUM_PORT"] ?? "8082";
    return process.env["BASE_URL"] || `http://127.0.0.1:${port}`;
}

export function isStandalone(testInfo: { project: { name: string } }): boolean {
    return testInfo.project.name.includes("standalone");
}

interface DropdownLocator extends Locator {
    selectOptionByText: (text: string) => Promise<void>;
}

export default class App {
    readonly page: Page;
    readonly context: BrowserContext;

    readonly tabBar: Locator;
    readonly noteTreeActiveNote: Locator;
    readonly noteTreeHoistedNote: Locator;
    readonly launcherBar: Locator;
    readonly currentNoteSplit: Locator;
    readonly currentNoteSplitTitle: Locator;
    readonly currentNoteSplitContent: Locator;
    readonly sidebar: Locator;
    readonly optionsDialog: Locator;
    readonly optionsDialogContent: Locator;
    private isMobile: boolean = false;

    constructor(page: Page, context: BrowserContext) {
        this.page = page;
        this.context = context;

        this.tabBar = page.locator(".tab-row-widget-container");
        const desktopTree = page.locator(".tree-wrapper");
        this.noteTreeActiveNote = desktopTree.locator(".fancytree-node.fancytree-active");
        this.noteTreeHoistedNote = desktopTree.locator(".fancytree-node", { has: page.locator(".unhoist-button") });
        this.launcherBar = page.locator("#launcher-container");
        this.currentNoteSplit = page.locator(".note-split:not(.hidden-ext)");
        this.currentNoteSplitTitle = this.currentNoteSplit.locator(".note-title").first();
        this.currentNoteSplitContent = this.currentNoteSplit.locator(".note-detail-printable.visible");
        this.sidebar = page.locator("#right-pane");
        this.optionsDialog = page.locator(".modal.options-dialog");
        this.optionsDialogContent = this.optionsDialog.locator(".modal-body");
    }

    get noteTree(): Locator {
        return this.isMobile
            ? this.page.locator(".mobile-note-navigator")
            : this.page.locator(".tree-wrapper");
    }

    async goto({ url, isMobile, preserveTabs }: GotoOpts = {}) {
        this.isMobile = !!isMobile;

        await this.context.addCookies([
            {
                url: getBaseUrl(),
                name: "trilium-device",
                value: isMobile ? "mobile" : "desktop"
            }
        ]);

        if (!url) {
            url = "/";
        }

        // If we're already on the target (modulo hash), page.goto treats it as
        // a same-document navigation and doesn't reload. In standalone that
        // means the worker keeps its current state — so option changes made
        // since the last navigation (e.g. a locale switch via setOption) won't
        // take effect. Force a real reload in that case.
        const currentUrl = this.page.url();
        const targetUrl = new URL(url, getBaseUrl()).toString();
        const stripHash = (u: string) => u.split("#")[0];
        if (currentUrl !== "about:blank" && stripHash(currentUrl) === stripHash(targetUrl)) {
            await this.page.reload({ waitUntil: "networkidle", timeout: 30_000 });
        } else {
            await this.page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        }

        // Wait for the page to load.
        if (url === "/") {
            await expect(this.noteTree).toContainText("Trilium Integration Test");
            if (!preserveTabs) {
                await this.closeAllTabs();
            }
        }
    }

    /**
     * Sends this tab's API calls through the service worker, where Playwright can see them.
     *
     * Standalone's leader tab answers its own calls from the in-page SQLite worker
     * (`standaloneApi.localFetch`), so they never reach the network stack and
     * `page.waitForResponse()` never fires. Call this in a test that waits on a request rather than
     * on what the request changes. Does nothing on the server build, which has no `standaloneApi`,
     * and lasts until the next navigation re-runs standalone's bootstrap.
     */
    async observeApiRequests() {
        await this.page.evaluate(() => {
            const standaloneApi = (window as unknown as { standaloneApi?: { localFetch?: unknown } }).standaloneApi;
            delete standaloneApi?.localFetch;
        });
    }

    async goToNoteInNewTab(noteTitle: string) {
        const autocomplete = this.currentNoteSplit.locator(".note-autocomplete");
        await expect(autocomplete).toBeVisible();
        // The algolia autocomplete listens to keyboard events. `fill()` only
        // dispatches `input`, which doesn't reliably open the dropdown — clear
        // and type with real key events instead.
        await autocomplete.click();
        await autocomplete.clear();
        await autocomplete.pressSequentially(noteTitle);

        const suggestion = this.existingNoteAutocompleteSuggestion(
            this.currentNoteSplit.locator(".note-detail-empty-results"),
            noteTitle
        );
        await expect(suggestion).toBeVisible();
        await suggestion.click();
    }

    /**
     * Existing-note autocomplete row whose visible title contains `noteTitle`.
     * Create / search / external-link actions also mention the query, so those
     * rows are excluded. Matching is case-sensitive so an Options page such as
     * "Code Notes" is not taken for the fixture note "Code notes".
     */
    existingNoteAutocompleteSuggestion(scope: Locator, noteTitle: string) {
        const escaped = noteTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return scope
            .locator(".aa-suggestion")
            .filter({
                has: this.page.locator(
                    ".note-suggestion:not(.create-note-action):not(.create-child-note-action)" +
                        ":not(.search-notes-action):not(.external-link-action)"
                )
            })
            .filter({ hasText: new RegExp(escaped) })
            .first();
    }

    /** Opens the settings dialog via the launcher cog and waits for it to appear. */
    async goToSettings() {
        await this.page.locator(".launcher-button.bx-cog").click();
        await expect(this.optionsDialog).toBeVisible();
    }

    /**
     * Navigates to the given settings page via the options dialog's sidebar. Pages are matched by
     * their note ID (e.g. `_optionsLocalization`) so navigation is independent of the UI language.
     */
    async goToSettingsPage(optionsNoteId: string) {
        await this.optionsDialog.locator(`.settings-navigation-item[href$="${optionsNoteId}"]`).click();
    }

    async getTab(tabIndex: number) {
        if (this.isMobile) {
            await this.launcherBar.locator(".mobile-tab-switcher").click();
            return this.page.locator(".modal.tab-bar-modal .tab-card").nth(tabIndex);
        }

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
        const tab = await this.getTab(0);
        await tab.click();
    }

    /**
     * Adds a new tab by cliking on the + button near the tab bar.
     */
    async addNewTab() {
        const tabs = this.tabBar.locator(".note-tab-wrapper");
        const before = await tabs.count();
        await this.page.locator('[data-trigger-command="openNewTab"]').click();
        // `openNewTabCommand` doesn't await tab creation, so wait until the
        // new tab is actually in the DOM before returning.
        await expect(tabs).toHaveCount(before + 1);
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
        // Issue the request from inside the page so standalone's service worker
        // intercepts it and routes to the local SQLite worker. Playwright's own
        // request client (page.request.*) bypasses the page entirely, which in
        // standalone mode just hits the vite preview server and gets 404.
        const result = await this.page.evaluate(async ({ key, value }) => {
            const csrfToken = (window as any).glob.csrfToken;
            if (!csrfToken) {
                return { ok: false, status: 0, error: "missing csrfToken" };
            }
            const response = await fetch(`/api/options/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
                method: "PUT",
                headers: {
                    "x-csrf-token": csrfToken
                }
            });
            return { ok: response.ok, status: response.status };
        }, { key, value });

        expect(result.ok, `PUT /api/options/${key}/${value} failed (status=${result.status})`).toBe(true);
    }

    dropdown(_locator: Locator): DropdownLocator {
        const locator = _locator as DropdownLocator;
        locator.selectOptionByText = async (text: string) => {
            await locator.locator(".dropdown-toggle").click();
            // The menu is not always a child of the dropdown it belongs to: one opened inside a
            // card is carried out to the body, the card being a container and so a backdrop root
            // that would otherwise flatten its blur. Found by being the open one instead.
            await this.page.locator(".dropdown-menu.show")
                .locator(".dropdown-item", { hasText: text })
                .click();
        };
        return locator;
    }

}
