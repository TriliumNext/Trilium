import test, { expect } from "@playwright/test";

import App from "../../../packages/trilium-e2e/src/support/app";

/**
 * Multi-tab behaviour, which is specific to standalone.
 *
 * The database lives in the browser on the OPFS SAHPool VFS, whose sync access
 * handles are exclusive to one dedicated worker per origin. Every tab used to
 * spawn its own worker: the second one could not open the database at all,
 * silently fell back to an empty in-memory one, and — because the service worker
 * routed API traffic to an arbitrary window — could drag the first tab onto that
 * empty database too.
 *
 * Now a Web Lock elects a single leader tab; it alone runs a worker, and the
 * others proxy through the service worker. See leader_election.ts.
 */
test("a second tab opens the same database rather than an empty one", async ({ context }) => {
    const firstTab = new App(await context.newPage(), context);
    await firstTab.goto();
    await expect(firstTab.noteTree).toContainText("Trilium Integration Test");

    const secondTab = new App(await context.newPage(), context);
    await secondTab.goto();

    // The regression: a second tab used to come up on a blank in-memory
    // database, so the fixture's notes would be missing here.
    await expect(secondTab.noteTree).toContainText("Trilium Integration Test");

    // ...and the first tab must not have been dragged onto that empty database.
    await expect(firstTab.noteTree).toContainText("Trilium Integration Test");
});

test("both tabs stay usable side by side", async ({ context }) => {
    const firstTab = new App(await context.newPage(), context);
    await firstTab.goto();
    await expect(firstTab.noteTree).toContainText("Trilium Integration Test");

    const secondTab = new App(await context.newPage(), context);
    await secondTab.goto();
    await expect(secondTab.noteTree).toContainText("Trilium Integration Test");

    // The follower's API calls are proxied to the leader's worker, so ordinary
    // navigation has to keep working in both.
    await firstTab.goToNoteInNewTab("Empty text");
    await expect(firstTab.currentNoteSplitTitle).toHaveValue(/Empty text/);

    await secondTab.goToNoteInNewTab("Empty text");
    await expect(secondTab.currentNoteSplitTitle).toHaveValue(/Empty text/);
});

test("a write from the follower reaches the leader's tree", async ({ context }) => {
    const leaderTab = new App(await context.newPage(), context);
    await leaderTab.goto();
    await expect(leaderTab.noteTree).toContainText("Trilium Integration Test");

    const followerTab = new App(await context.newPage(), context);
    await followerTab.goto();
    await expect(followerTab.noteTree).toContainText("Trilium Integration Test");

    // Write from the *follower*, which has no worker of its own: the request has
    // to travel through the service worker to the leader's worker to succeed.
    const renamed = "Renamed by the follower tab";
    const status = await followerTab.page.evaluate(async (title) => {
        const response = await fetch("/api/notes/root/title", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title })
        });
        return response.status;
    }, renamed);
    expect(status).toBe(200);

    // The resulting entity change is broadcast from the leader's worker and
    // relayed to every tab over the BroadcastChannel in local-bridge.ts, so both
    // trees converge without a reload.
    await expect(leaderTab.noteTree).toContainText(renamed, { timeout: 20_000 });
    await expect(followerTab.noteTree).toContainText(renamed, { timeout: 20_000 });
});

test("closing the leader promotes the surviving tab", async ({ context }) => {
    const leaderTab = new App(await context.newPage(), context);
    await leaderTab.goto();
    await expect(leaderTab.noteTree).toContainText("Trilium Integration Test");

    const followerTab = new App(await context.newPage(), context);
    await followerTab.goto();
    await expect(followerTab.noteTree).toContainText("Trilium Integration Test");

    // The first tab holds the database lock. Closing it releases the lock, and
    // the browser hands it to the tab that was queued behind — no heartbeat or
    // timeout involved.
    await leaderTab.page.close();

    // The survivor must be able to serve its own requests now, which it can only
    // do by having been promoted and started a worker of its own.
    await followerTab.goToNoteInNewTab("Empty text");
    await expect(followerTab.currentNoteSplitTitle).toHaveValue(/Empty text/, { timeout: 20_000 });
});
