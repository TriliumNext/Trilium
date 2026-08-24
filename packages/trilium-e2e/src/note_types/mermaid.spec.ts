import { test, expect, Page, BrowserContext, Locator } from "@playwright/test";
import App from "../support/app";

test("renders ELK flowchart", async ({ page, context }) => {
    const svg = await openDiagram({
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

    // ELK stacks A and C into a column and pushes B out to the right.
    const { a, b, c } = await nodeCentres(svg);
    expect(Math.abs(a.x - c.x)).toBeLessThan(Math.abs(a.y - c.y));
    expect(b.x).toBeGreaterThan(Math.max(a.x, c.x));
});

test("renders standard flowchart", async ({ page, context }) => {
    const svg = await openDiagram({
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

    // The default layout runs A, B and C left to right along a single row.
    const { a, b, c } = await nodeCentres(svg);
    const xSpread = Math.max(a.x, b.x, c.x) - Math.min(a.x, b.x, c.x);
    const ySpread = Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y);
    expect(ySpread).toBeLessThan(xSpread / 2);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
});

interface DiagramTestOpts {
    page: Page;
    context: BrowserContext;
    noteTitle: string;
    snapshot: string;
}

/** Opens a mermaid note, asserts the rendered labels, and returns the diagram's `<svg>`. */
async function openDiagram({ page, context, noteTitle, snapshot }: DiagramTestOpts) {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab(noteTitle);

    const svgData = app.currentNoteSplit.locator(".render-container svg");
    await expect(svgData).toBeVisible();
    await expect(svgData).toMatchAriaSnapshot(snapshot);
    return svgData;
}

/**
 * Centres of the `A`, `B` and `C` nodes, in page coordinates. The ELK and the default layout
 * emit the same labels in the same order, so the snapshot above matches either one and the
 * positions are what tell them apart. Only the relative order and spread are compared, which
 * holds whatever scale `svg-pan-zoom` fits the diagram to.
 */
async function nodeCentres(svg: Locator) {
    return {
        a: await nodeCentre(svg, "A"),
        b: await nodeCentre(svg, "B"),
        c: await nodeCentre(svg, "C")
    };
}

async function nodeCentre(svg: Locator, label: string): Promise<{ x: number; y: number }> {
    const node = svg.locator(".node").filter({ hasText: new RegExp(`^${label}$`) });
    await expect(node).toBeVisible();
    const box = requireBoundingBox(await node.boundingBox(), `flowchart node "${label}"`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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
 * would collapse to a sub-pixel sliver after the split divider was dragged. The root cause was
 * that `svg-pan-zoom` strips the SVG's `viewBox` attribute on init and never restores it on
 * `destroy()`, so every divider-drag-triggered resize re-initialized pan/zoom by fitting from
 * `getBBox()` instead of the original `viewBox`, each time shrinking the effective scale further.
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

    const viewport = app.currentNoteSplit.locator(".render-container svg .svg-pan-zoom_viewport");
    await expect(viewport).toBeVisible();

    // Let the initial pan/zoom fit settle (mounting can itself trigger one resize-driven re-init
    // as the ResizeObserver reports the container's real size shortly after mount).
    await page.waitForTimeout(500);

    const beforeBox = requireBoundingBox(await viewport.boundingBox(), "viewport (before drag)");
    expect(beforeBox.height).toBeGreaterThan(0);

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

    const afterBox = requireBoundingBox(await viewport.boundingBox(), "viewport (after drag)");

    // With the bug, this collapses to a sub-pixel sliver (observed ratio ~0.001 or less) even
    // though the container returned to its original size. A healthy re-fit reproduces (close to)
    // the original height.
    expect(afterBox.height).toBeGreaterThan(beforeBox.height * 0.5);
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
