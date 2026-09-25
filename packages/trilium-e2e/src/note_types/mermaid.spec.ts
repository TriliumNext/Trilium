import { test, expect, Page, BrowserContext, Locator } from "@playwright/test";
import App from "../support/app";

test("renders ELK flowchart", async ({ page, context }) => {
    await testAriaSnapshot({
        page,
        context,
        noteTitle: "Flowchart ELK on",
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

// The aria snapshots above read label text in DOM order, which mermaid emits from the
// diagram source and is therefore the same under either layout. Node coordinates are what
// differ, so this is the assertion that `layout: elk` in a note's front matter still beats
// the `layout: dagre` the client pins in getMermaidConfig().
test("lays the ELK flowchart out differently from the dagre one", async ({ page, context }) => {
    const elk = await nodePositions(page, context, "Flowchart ELK on");
    const dagre = await nodePositions(page, context, "Flowchart ELK off");

    expect(elk.length).toBeGreaterThan(0);
    expect(elk.length).toBe(dagre.length);
    expect(elk).not.toEqual(dagre);
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

test("gantt diagram survives split divider drag (issue 9749)", async ({ page, context }) => {
    await testDividerDragSurvival({ page, context, noteTitle: "Gantt" });
});

test(
    "gantt diagram with pathological date range survives split divider drag (issue 9749)",
    async ({ page, context }) => {
        await testDividerDragSurvival({ page, context, noteTitle: "Bar chart" });
    }
);

interface DividerDragTestOpts {
    page: Page;
    context: BrowserContext;
    noteTitle: string;
}

/**
 * Regression test for issue #9749: mermaid gantt-based diagrams (which mermaid renders with a
 * SVG `viewBox` inflated far beyond the visible chart, because of an off-screen "today" marker)
 * would collapse to a sub-pixel sliver after the split divider was dragged, because the pan/zoom
 * library re-fitted the diagram on every resize from a `viewBox` it had itself stripped. The
 * preview now fits through the `viewBox` in CSS, so a resize re-fits nothing.
 *
 * The regression only shows up once the divider returns to (approximately) its original position:
 * a one-directional drag legitimately shrinks the rendered diagram proportionally to the smaller
 * container, so this asserts on a round-trip drag (out and back) and compares the final height to
 * the height before dragging. Height is asserted rather than width because the gantt bounding box
 * width is dominated by the off-screen "today" marker even in the healthy case.
 */
async function testDividerDragSurvival({ page, context, noteTitle }: DividerDragTestOpts) {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab(noteTitle);

    const svgData = app.currentNoteSplit.locator(".render-container svg");
    await expect(svgData).toBeVisible();

    // The SVG itself always measures as the whole pane, so read the on-screen height of what it
    // actually draws: its bounding box in user units, scaled by the CTM that puts it on the screen.
    const drawnHeight = () => svgData.evaluate((svg: SVGSVGElement) =>
        svg.getBBox().height * (svg.getScreenCTM()?.d ?? 0));

    // Let the layout settle; mermaid sizes the diagram shortly after it mounts.
    await page.waitForTimeout(500);

    const beforeHeight = await drawnHeight();
    expect(beforeHeight).toBeGreaterThan(0);

    const gutter = app.currentNoteSplit.locator(".gutter");
    await expect(gutter).toHaveCount(1);
    const gutterBox = requireBoundingBox(await gutter.boundingBox(), "gutter");

    const startX = gutterBox.x + gutterBox.width / 2;
    const startY = gutterBox.y + gutterBox.height / 2;
    const dragDistance = 150;
    const stepSize = 30;

    // Drag the divider out and back so it ends up near its original position. ResizeObserver
    // fires repeatedly along the way, triggering multiple destroy/re-init cycles.
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let offset = stepSize; offset <= dragDistance; offset += stepSize) {
        await page.mouse.move(startX + offset, startY, { steps: 5 });
    }
    for (let offset = dragDistance - stepSize; offset >= 0; offset -= stepSize) {
        await page.mouse.move(startX + offset, startY, { steps: 5 });
    }
    await page.mouse.up();

    await page.waitForTimeout(500);

    const afterHeight = await drawnHeight();

    // With the bug, this collapses to a sub-pixel sliver (observed ratio ~0.001 or less) even
    // though the container returned to its original size. A healthy fit reproduces (close to)
    // the original height.
    expect(afterHeight).toBeGreaterThan(beforeHeight * 0.5);
}

/**
 * Playwright's `boundingBox()` returns `null` when the element isn't attached/visible. The tests
 * above only call this once visibility has already been asserted, so a `null` here means something
 * unexpected happened - fail loudly with context instead of silently narrowing with `!`.
 */
function requireBoundingBox(box: Awaited<ReturnType<Locator["boundingBox"]>>, label: string) {
    if (!box) {
        throw new Error(
            `Expected a bounding box for ${label}, but the element was not visible/attached.`
        );
    }
    return box;
}

async function nodePositions(page: Page, context: BrowserContext, noteTitle: string) {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab(noteTitle);

    const nodes = app.currentNoteSplit.locator(".render-container svg .node");
    await expect(nodes.first()).toBeVisible();
    return await nodes.evaluateAll((els) => els.map((el) => el.getAttribute("transform") ?? ""));
}
