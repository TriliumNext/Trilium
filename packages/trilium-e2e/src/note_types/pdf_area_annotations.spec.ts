import { test, expect, Locator, Page } from "@playwright/test";

import App from "../support/app";

// These tests double as visual demos of the area-annotation fixes (paste-as-link,
// duplicate-on-reopen, color update) — record video so the interactions can be watched.
test.use({ video: "on" });

const PDF_NOTE_TITLE = "Dacia Logan.pdf";

// Pause after each notable step so the recorded video is actually watchable — without this,
// the whole sequence (open PDF, draw, right-click, pick color, ...) flashes by in a couple of
// seconds when scrubbing through the demo recording. Purely cosmetic, not needed for correctness.
const STEP_PAUSE = 800;

// Mirrors apps/client/src/widgets/sidebar/pdf/pdfAnnotationColors.ts. rgb() is what the sidebar's
// solid-color swatch computes to; overlayRgba() is what the in-PDF overlay computes to, since it's
// drawn with an 8-digit hex (alpha "cc" = 0.8 for the border, "1a" ≈ 0.10 for the fill).
const PRESET_COLORS = [
    { label: "Blue", r: 0x4a, g: 0x90, b: 0xd9 },
    { label: "Yellow", r: 0xf5, g: 0xc5, b: 0x19 },
    { label: "Green", r: 0x52, g: 0xb7, b: 0x88 },
    { label: "Red", r: 0xe6, g: 0x39, b: 0x46 },
    { label: "Purple", r: 0x9c, g: 0x6a, b: 0xde },
] as const;

function rgb(c: (typeof PRESET_COLORS)[number]) {
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

function overlayBorderRgba(c: (typeof PRESET_COLORS)[number]) {
    return `rgba(${c.r}, ${c.g}, ${c.b}, 0.8)`;
}

test.beforeEach(async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.setOption("rightPaneCollapsedItems", "[]");
});

test("Copying an area annotation link pastes as a real link, not plain text", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab(PDF_NOTE_TITLE);

    await drawArea(app, page);
    const areaItem = app.sidebar.locator(".pdf-area-annotation-item");
    await expect(areaItem).toHaveCount(1);
    await pause(page);

    await areaItem.locator(".pdf-area-annotation-btn").click();
    await expect(page.locator(".toast-body", { hasText: "Annotation link copied" })).toBeVisible();
    await pause(page);

    // Paste the copied link into a plain text note. Before the fix this could silently
    // degrade to plain text (or, for area annotations specifically, drop the link
    // entirely and paste just the bare image URL) instead of a clickable linked image.
    await app.addNewTab();
    await app.goToNoteInNewTab("Empty text");
    const noteContent = app.currentNoteSplit.locator(".note-detail-editable-text-editor");
    await expect(noteContent).toBeVisible();
    await noteContent.click();

    // Clear any content first instead of assuming the shared fixture note starts blank:
    // a previous run whose own cleanup (below) didn't fully revert would otherwise break
    // this run's assumption about the note's starting state.
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Delete");

    await page.keyboard.press("ControlOrMeta+V");
    await expect(noteContent.locator("a[href] img")).toHaveCount(1);
    await pause(page, 1500);

    // Clear the pasted content again (rather than undo) so the shared "Empty text" fixture
    // note is reliably left blank for the next run, regardless of undo-stack quirks.
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Delete");

    await app.clickNoteOnNoteTreeByTitle(PDF_NOTE_TITLE);
    await deleteAllAreas(app);
});

test("Reopening a closed PDF tab and drawing a new area does not create a duplicate", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab(PDF_NOTE_TITLE);
    await pause(page);

    // This is exactly the repro from the bug report: close the tab, reopen the same PDF
    // note, then draw one area. If the closed tab's message listener wasn't torn down
    // cleanly, that single gesture used to create two identical annotations.
    await app.getActiveTab().locator(".note-tab-close").click();
    await pause(page);
    await app.clickNoteOnNoteTreeByTitle(PDF_NOTE_TITLE);
    await pause(page);

    await drawArea(app, page);

    await expect(app.sidebar.locator(".pdf-area-annotation-item")).toHaveCount(1);
    await pause(page, 1500);

    await deleteAllAreas(app);
});

test("Changing an area annotation's color updates immediately, without a page reload", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab(PDF_NOTE_TITLE);

    await drawArea(app, page);
    const areaItem = app.sidebar.locator(".pdf-area-annotation-item");
    await expect(areaItem).toHaveCount(1);
    await expect(areaItem.locator(".pdf-area-annotation-color-bar")).toHaveCSS("background-color", rgb(PRESET_COLORS[0]));
    await pause(page);

    const contentFrame = app.currentNoteSplit.frameLocator("iframe");
    const overlay = contentFrame.locator(".trilium-area-overlay").first();
    await expect(overlay).toHaveCSS("border-color", overlayBorderRgba(PRESET_COLORS[0]));

    const red = PRESET_COLORS.find((c) => c.label === "Red")!;
    await changeAreaColorViaOverlay(page, overlay, red.label);
    await pause(page);

    // Tight timeout: before the fix, the color never updated without a full note reload
    // (a page.reload() would have masked the bug), so a regression here fails fast
    // instead of flaking slowly.
    await expect(areaItem.locator(".pdf-area-annotation-color-bar")).toHaveCSS("background-color", rgb(red), { timeout: 2000 });
    // The change must be visible on the PDF page itself, not just the sidebar swatch —
    // that's the whole point of an *area* annotation: it marks a spot in the document.
    await expect(overlay).toHaveCSS("border-color", overlayBorderRgba(red), { timeout: 2000 });
    await pause(page, 1500);

    await deleteAllAreas(app);
});

test("Every preset color can be applied and is reflected on both the sidebar swatch and the PDF overlay", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.goToNoteInNewTab(PDF_NOTE_TITLE);

    await drawArea(app, page);
    const areaItem = app.sidebar.locator(".pdf-area-annotation-item");
    await expect(areaItem).toHaveCount(1);

    const contentFrame = app.currentNoteSplit.frameLocator("iframe");
    const overlay = contentFrame.locator(".trilium-area-overlay").first();
    await pause(page);

    for (const color of PRESET_COLORS) {
        await changeAreaColorViaOverlay(page, overlay, color.label);

        await expect(areaItem.locator(".pdf-area-annotation-color-bar")).toHaveCSS("background-color", rgb(color));
        await expect(overlay).toHaveCSS("border-color", overlayBorderRgba(color));
        await pause(page, 1200);
    }

    await deleteAllAreas(app);
});

/** Right-clicks the in-PDF overlay, opens "Change color", and picks the given preset by label. */
async function changeAreaColorViaOverlay(page: Page, overlay: Locator, colorLabel: string) {
    const contextMenu = page.locator("#context-menu-container");

    // Retry the open-menu gesture: right-clicking a freshly-created/updated overlay
    // occasionally doesn't deliver the "contextmenu" event on the first try.
    for (let attempt = 1; attempt <= 3; attempt++) {
        await expect(overlay).toBeVisible();
        await overlay.click({ button: "right" });
        try {
            await contextMenu.getByText("Change color").hover({ timeout: 3000 });
            break;
        } catch (e) {
            if (attempt === 3) throw e;
        }
    }
    await contextMenu.getByText(colorLabel, { exact: true }).click();
}

/** Activates the area-capture tool and drags a selection box over the top-left quadrant of page 1. */
async function drawArea(app: App, page: Page, pageNumber = 1) {
    const contentFrame = app.currentNoteSplit.frameLocator("iframe");

    // Wait for our own toolbar button to exist before touching anything else: it's only
    // attached once PDF.js fires "documentloaded", which can lag behind the built-in
    // toolbar controls (#scaleSelect, #pageNumber) becoming interactable. Triggering a
    // zoom/page change first can retrigger a reflow that races with that late setup.
    const areaButton = contentFrame.locator("#triliumAreaAnnotationButton");
    await expect(areaButton).toBeVisible();

    // The PDF note persists its own scroll/zoom position (view history) across
    // sessions, so another test's earlier interaction with this shared fixture note can
    // leave the viewer at a different page/zoom here. Pin both to a known state before
    // computing drag coordinates below, instead of depending on whatever was restored.
    await contentFrame.locator("#scaleSelect").selectOption("1");
    const pageNumberInput = contentFrame.locator("#pageNumber");
    await pageNumberInput.fill(`${pageNumber}`);
    await pageNumberInput.press("Enter");

    const pageEl = contentFrame.locator(`.page[data-page-number="${pageNumber}"]`);
    await expect(pageEl).toBeVisible();
    await pageEl.scrollIntoViewIfNeeded();
    await pause(page);

    const wasActive = await areaButton.evaluate((el) => (el as HTMLElement).style.background !== "");
    if (!wasActive) {
        await areaButton.click();
        await pause(page, 400);
    }

    const box = await pageEl.boundingBox();
    if (!box) throw new Error("Could not find bounding box of PDF page");

    const startX = box.x + box.width * 0.15;
    const startY = box.y + box.height * 0.15;
    const endX = box.x + box.width * 0.45;
    const endY = box.y + box.height * 0.45;

    // Slow, stepped drag (rather than an instant down/up) so the selection box is visible
    // growing across the page in the recorded video.
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 15 });
    await page.waitForTimeout(200);
    await page.mouse.move(endX, endY, { steps: 15 });
    await page.waitForTimeout(200);
    await page.mouse.up();

    await expect(app.sidebar).toContainText("area annotation");

    // The captured area must show up as a highlighted overlay directly on the PDF page in
    // the note — not just as an entry in the sidebar list — since that's what actually marks
    // the annotated spot in the document itself.
    const contentFrameAfter = app.currentNoteSplit.frameLocator("iframe");
    await expect(contentFrameAfter.locator(".trilium-area-overlay").first()).toBeVisible();
    await pause(page, 1200);
}

/** Waits briefly so the action just performed is visible for a moment in the recorded video. */
async function pause(page: Page, ms = STEP_PAUSE) {
    await page.waitForTimeout(ms);
}

/**
 * Deletes every area annotation on the currently active note directly via the API, so
 * cleanup between tests doesn't depend on the (separately tested, occasionally slow)
 * UI delete round-trip.
 */
async function deleteAllAreas(app: App) {
    await app.page.evaluate(async () => {
        const glob = (window as any).glob;
        const noteId = glob.appContext.tabManager.getActiveContext()?.noteId;
        if (!noteId) return;

        const attributes = await (await fetch(`/api/notes/${noteId}/attributes`)).json();
        for (const attr of attributes) {
            if (attr.type !== "label" || attr.name !== "areaAnnotation") continue;

            await fetch(`/api/notes/${noteId}/attributes/${attr.attributeId}`, {
                method: "DELETE",
                headers: { "x-csrf-token": glob.csrfToken }
            });
            try {
                const { attachmentId } = JSON.parse(attr.value);
                await fetch(`/api/attachments/${attachmentId}`, {
                    method: "DELETE",
                    headers: { "x-csrf-token": glob.csrfToken }
                });
            } catch {
                // malformed value — nothing more to clean up for this attribute
            }
        }
    });
}
