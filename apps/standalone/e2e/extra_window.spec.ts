import test, { expect, type Page } from "@playwright/test";

import App from "../../../packages/trilium-e2e/src/support/app";

/**
 * "Open in a new window" in standalone.
 *
 * A detached window is a plain second browser window on the same origin, so it is a follower in the
 * leader election: it has no worker of its own and reaches the database through the service worker,
 * exactly like a second tab. See leader_election.ts and multi_tab.spec.ts.
 *
 * What makes it more than a second tab is `?extraWindow`, which tells the client it does not own the
 * saved tab set. The standalone bootstrap used to report every window as the main one, so a detached
 * window restored the tab set of the window it came from and then wrote its own back over it.
 */
test("a tab copied to a new window opens on the same database, as a non-main window", async ({ context }) => {
    const app = new App(await context.newPage(), context);
    await app.goto();
    await app.goToNoteInNewTab("Empty text");
    await expect(app.currentNoteSplitTitle).toHaveValue(/Empty text/);

    // Driven through the real menu rather than the command, so the window is opened from within a
    // user gesture — `window.open()` off a synthetic call is a different code path in the browser.
    const tab = await app.getTab(0);
    await tab.click({ button: "right" });
    const [extraPage] = await Promise.all([
        context.waitForEvent("page"),
        app.page.locator("#context-menu-container").getByText("Copy this tab to a new window").click()
    ]);
    await extraPage.waitForLoadState("domcontentloaded");

    expect(new URL(extraPage.url()).searchParams.get("extraWindow")).toBe("1");

    // It must come up on the leader's database rather than an empty in-memory one, which it can only
    // do by proxying its API traffic through the service worker.
    const extraWindow = new App(extraPage, context);
    await expect(extraWindow.noteTree).toContainText("Trilium Integration Test");
    await expect(extraWindow.currentNoteSplitTitle).toHaveValue(/Empty text/);

    // ...and it must know it is not the main window, or it takes over the saved tab set.
    expect(await isMainWindow(extraPage)).toBe(false);
    expect(await isMainWindow(app.page)).toBe(true);
});

/** Reads the client's own view of whether it owns the saved tab set, as the bootstrap set it. */
function isMainWindow(page: Page) {
    return page.evaluate(() => (window as unknown as { glob: { isMainWindow: boolean } }).glob.isMainWindow);
}
