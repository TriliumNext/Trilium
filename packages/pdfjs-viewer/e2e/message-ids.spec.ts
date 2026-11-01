import { expect, test } from "@playwright/test";

/**
 * The client drops every message whose `noteId`/`ntxId` is not its own, so a message sent before
 * the viewer knows them never reaches the sidebar.
 */
test("addresses the messages sent while the viewer page is still loading", async ({ page, context }) => {
    // Icons the toolbar loads through CSS hold back the frame's `load` event, but not the document.
    await context.route("**/images/**", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        await route.continue();
    });
    await page.addInitScript(() => {
        if (window.top !== window) return;
        (window as any).pageInfo = [];
        window.addEventListener("message", (event: any) => {
            if (event.data?.type === "pdfjs-viewer-page-info") {
                (window as any).pageInfo.push({ noteId: event.data.noteId, ntxId: event.data.ntxId });
            }
        });
    });

    await page.goto("/parent.html");

    await expect.poll(() => page.evaluate(() => (window as any).pageInfo), { timeout: 15_000 })
        .toContainEqual({ noteId: "note1", ntxId: "ntx1" });
});
