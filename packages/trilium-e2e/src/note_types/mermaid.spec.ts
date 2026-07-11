import { test, expect, Page, BrowserContext } from "@playwright/test";
import App from "../support/app";

test("renders ELK flowchart", async ({ page, context }) => {
    await testAriaSnapshot({
        page,
        context,
        noteTitle: "Flowchart ELK on",
        snapshot: `
            - document:
                - paragraph: A
                - paragraph: B
                - paragraph: C
                - paragraph: Guarantee
                - paragraph: User attributes
                - paragraph: Master data
                - paragraph: Exchange Rate
                - paragraph: Profit Centers
                - paragraph: Vendor Partners
                - paragraph: Work Situation
                - paragraph: Customer
                - paragraph: Profit Centers
                - paragraph: Guarantee
                - text: Interfaces for B
        `
    });
});

test("renders standard flowchart", async ({ page, context }) => {
    await testAriaSnapshot({
        page,
        context,
        noteTitle: "Flowchart ELK off",
        snapshot: `
            - document:
                - paragraph: Guarantee
                - paragraph: User attributes
                - paragraph: Master data
                - paragraph: Exchange Rate
                - paragraph: Profit Centers
                - paragraph: Vendor Partners
                - paragraph: Work Situation
                - paragraph: Customer
                - paragraph: Profit Centers
                - paragraph: Guarantee
                - paragraph: A
                - paragraph: B
                - paragraph: C
                - text: Interfaces for B
        `
    });
});

interface AriaTestOpts {
    page: Page;
    context: BrowserContext;
    noteTitle: string;
    snapshot: string;
}

async function testAriaSnapshot({ page, context, noteTitle, snapshot }: AriaTestOpts) {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab(noteTitle);

    const svgData = app.currentNoteSplit.locator(".render-container svg");
    await expect(svgData).toBeVisible();
    await expect(svgData).toMatchAriaSnapshot(snapshot);
}
