import { expect, Locator, Page, test } from "@playwright/test";
import App from "../support/app";

/**
 * End-to-end coverage of the media viewer (image notes + image attachments):
 * the inline viewer with its toolbar, gallery navigation (buttons, keys, wrap-around),
 * zoom/rotate/flip, fullscreen with the thumbnail navbar, blobId-based HTTP caching,
 * download, and the attachment-detail gallery.
 *
 * The fixture database contains no image notes, so each worker imports a small gallery
 * of three PNGs under "Samples" through the regular import dialog. The e2e server runs
 * on an in-memory copy of the database, so nothing persists between runs.
 */

/** Small solid-color PNGs (generated with sharp): red 320x200, green 480x200, blue 200x320. */
const PNG_RED = "iVBORw0KGgoAAAANSUhEUgAAAUAAAADICAIAAAAWZq/8AAAACXBIWXMAAAPoAAAD6AG1e1JrAAABvUlEQVR42u3TQQkAAAwDscqpfxWTNRF7DQJRcHCZFngqEoCBAQMDBgYDAwYGDAwYGAwMGBgwMBgYMDBgYMDAYGDAwICBAQODgQEDAwYGAwMGBgwMGBgMDBgYMDBgYDAwYGDAwGBgwMCAgQEDg4EBAwMGBgOrAAYGDAwYGAwMGBgwMGBgMDBgYMDAYGDAwICBAQODgQEDAwYGDAwGBgwMGBgMDBgYMDBgYDAwYGDAwICBwcCAgQEDg4EBAwMGBgwMBgYMDBgYDAwYGDAwYGAwMGBgwMCAgcHAgIEBA4OBAQMDBgYMDAYGDAwYGDAwGBgwMGBgMDBgYMDAgIHBwICBAQMDBgYDAwYGDAwGBgwMGBgwMBgYMDBgYDAwYGDAwICBwcCAgQEDAwYGAwMGBgwMBgYMDBgYMDAYGDAwYGDAwGBgwMCAgcHAgIEBAwMGBgMDBgYMDAZWAQwMGBgwMBgYMDBgYMDAYGDAwICBwcCAgQEDAwYGAwMGBgwMGBgMDBgYMDAYGDAwYGDAwGBgwMCAgQEDg4EBAwMGBgMDBgYMDBgYDAwYGDAwGBgwMGBgwMBgYMDAgIEBA4OBAQMDFwvAqoAAz9wc7AAAAABJRU5ErkJggg==";
const PNG_GREEN = "iVBORw0KGgoAAAANSUhEUgAAAeAAAADICAIAAAC/PqUtAAAACXBIWXMAAAPoAAAD6AG1e1JrAAACMUlEQVR42u3UMQ0AAAzDsMIp7EEdjO2wZAQ5kk4BeCgSABg0AAYNYNAAGDSAQQNg0AAYNIBBA2DQAAYNgEEDYNAABg2AQQMYNAAGDWDQABg0AAYNYNAAGDSAQQNg0AAYNIBBA2DQAAYNgEEDGDQABg2AQQMYNAAGDWDQABg0AAYNYNAAGDSAQQNg0AAGrQKAQQNg0AAGDYBBAxg0AAYNgEEDGDQABg1g0AAYNAAGDWDQABg0gEEDYNAABg2AQQNg0AAGDYBBAxg0AAYNgEEDGDQABg1g0AAYNIBBA2DQABg0gEEDYNAABg2AQQNg0AAGDYBBAxg0AAYNYNAqABg0AAYNYNAAGDSAQQNg0AAYNIBBA2DQAAYNgEEDYNAABg2AQQMYNAAGDWDQABg0AAYNYNAAGDSAQQNg0AAYNIBBA2DQAAYNgEEDGDQABg2AQQMYNAAGDWDQABg0AAYNYNAAGDSAQQNg0AAGDYBBA2DQAAYNgEEDGDQABg2AQQMYNAAGDWDQABg0AAYNYNAAGDSAQQNg0AAGDYBBA2DQAAYNgEEDGDQABg2AQQMYNAAGDWDQABg0gEEDYNAAGDSAQQNg0AAGDYBBA2DQAAYNgEEDGDQABg1g0AAYNAAGDWDQABg0gEEDYNAAGDSAQQNg0AAGDYBBA2DQAAYNgEEDGDQABg1g0AAYNAAGDWDQABg0gEEDYNAAGDSAQQNg0AAGDYBBAxg0AAYNgEEDGDQABg1g0ABcWX4apJJuFQcaAAAAAElFTkSuQmCC";
const PNG_BLUE = "iVBORw0KGgoAAAANSUhEUgAAAMgAAAFACAIAAAB2rqTIAAAACXBIWXMAAAPoAAAD6AG1e1JrAAACRklEQVR42u3SMQ0AAAgEsZeDCPwHWShgY2xSBZdL9cC7SICxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsjKUCxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFsTCWChgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFsTCWBBgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY8FlASf1CSwmARdiAAAAAElFTkSuQmCC";

/**
 * Import happens once per worker; retries start a fresh worker and import a fresh gallery.
 * Every import goes into its own freshly created parent note — importing into a shared fixture
 * note would grow one sibling list across workers and break the gallery counts.
 */
let gallery: { titles: string[]; parentNoteId: string } | null = null;

/** Creates an empty note under root through the internal API, from inside the page (CSRF-aware). */
async function createParentNote(page: Page, title: string): Promise<string> {
    const result = await page.evaluate(async (noteTitle) => {
        const csrfToken = (window as unknown as { glob: { csrfToken: string } }).glob.csrfToken;
        const response = await fetch("/api/notes/root/children?target=into", {
            method: "POST",
            headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
            body: JSON.stringify({ title: noteTitle, content: "", type: "text" })
        });
        if (!response.ok) {
            return { error: `${response.status}` };
        }
        const body = await response.json() as { note: { noteId: string } };
        return { noteId: body.note.noteId };
    }, title);
    expect(result, `creating note "${title}" failed`).toHaveProperty("noteId");
    return (result as { noteId: string }).noteId;
}

async function ensureImageGallery(app: App, page: Page): Promise<string[]> {
    if (gallery) {
        return gallery.titles;
    }

    const suffix = Date.now().toString(36);
    const titles = [ `viewer-red-${suffix}.png`, `viewer-green-${suffix}.png`, `viewer-blue-${suffix}.png` ];
    const buffers = [ PNG_RED, PNG_GREEN, PNG_BLUE ];

    const parentNoteId = await createParentNote(page, `viewer gallery ${suffix}`);
    await page.evaluate(async (noteId) => {
        const glob = (window as unknown as { glob: { appContext: { triggerCommand(name: string, data: unknown): Promise<unknown> } } }).glob;
        await glob.appContext.triggerCommand("showImportDialog", { noteId });
    }, parentNoteId);

    const importDialog = page.locator(".modal.show", { hasText: "Import into" });
    await expect(importDialog).toBeVisible();
    await importDialog.locator("input[type=file]").setInputFiles(titles.map((name, i) => ({
        name,
        mimeType: "image/png",
        buffer: Buffer.from(buffers[i], "base64")
    })));
    await importDialog.getByRole("button", { name: "Import" }).click();
    await expect(importDialog).not.toBeVisible({ timeout: 30_000 });

    // The import navigates to the last imported note, which renders the new viewer.
    await expect(page.locator(".media-viewer-root")).toBeVisible({ timeout: 15_000 });

    gallery = { titles, parentNoteId };
    return titles;
}

/** Opens one of the imported gallery notes in a fresh tab and waits for the viewer. */
async function openGalleryNote(app: App, page: Page, index: number): Promise<string[]> {
    const titles = await ensureImageGallery(app, page);
    await app.closeAllTabs();
    await app.goToNoteInNewTab(titles[index]);
    await expect(inlineViewer(app)).toBeVisible();
    return titles;
}

function inlineViewer(app: App): Locator {
    return app.currentNoteSplit.locator(".media-viewer-root");
}

function toolbar(app: App): Locator {
    return app.currentNoteSplit.locator(".media-viewer-toolbar");
}

async function zoomPercent(app: App): Promise<number> {
    const text = await toolbar(app).locator(".media-viewer-zoom-level").textContent();
    return parseInt(text ?? "0", 10);
}

test("image note renders the viewer with the full toolbar", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await openGalleryNote(app, page, 0);

    const img = inlineViewer(app).locator(".viewer-canvas img");
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("src", /api\/images\/[^/]+\/.+\?v=.+/);

    await expect(toolbar(app).locator(".media-viewer-position")).toHaveText("1/3");
    for (const action of [
        "Zoom out", "Zoom in", "Fit to window", "Actual size (1:1)",
        "Rotate left", "Rotate right", "Flip horizontally",
        "Download", "Copy reference to clipboard", "Open externally", "Fullscreen"
    ]) {
        await expect(toolbar(app).locator(`button[aria-label*="${action}"]`).first()).toBeVisible();
    }
});

test("gallery navigation works from the toolbar and the keyboard, wrapping around", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    const titles = await openGalleryNote(app, page, 0);

    await toolbar(app).locator('button[aria-label^="Next image"]').click();
    await expect(app.currentNoteSplitTitle).toHaveValue(titles[1]);
    await expect(toolbar(app).locator(".media-viewer-position")).toHaveText("2/3");

    // Put focus on the viewer itself so the keyboard checks aren't at the mercy of
    // wherever the button click left it (Space is deliberately ignored on buttons).
    await inlineViewer(app).locator(".viewer-canvas").click();

    await page.keyboard.press("PageDown");
    await expect(app.currentNoteSplitTitle).toHaveValue(titles[2]);

    // Wrap-around: next from the last image goes back to the first.
    await page.keyboard.press("Space");
    await expect(app.currentNoteSplitTitle).toHaveValue(titles[0]);

    await page.keyboard.press("Backspace");
    await expect(app.currentNoteSplitTitle).toHaveValue(titles[2]);
});

test("zoom buttons, reset and 1:1 drive the zoom readout", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await openGalleryNote(app, page, 0);

    const initial = await zoomPercent(app);
    expect(initial).toBeGreaterThan(0);

    await toolbar(app).locator('button[aria-label="Zoom in"]').click();
    await expect.poll(() => zoomPercent(app)).toBeGreaterThan(initial);

    await toolbar(app).locator('button[aria-label="Actual size (1:1)"]').click();
    await expect(toolbar(app).locator(".media-viewer-zoom-level")).toHaveText("100%");

    await toolbar(app).locator('button[aria-label^="Reset zoom"]').click();
    await expect.poll(() => zoomPercent(app)).toBe(initial);
});

test("rotate and flip transform the image and reset clears them", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await openGalleryNote(app, page, 0);
    const img = inlineViewer(app).locator(".viewer-canvas img");

    await toolbar(app).locator('button[aria-label="Rotate right"]').click();
    await expect(img).toHaveAttribute("style", /rotate\(90deg\)/);

    await toolbar(app).locator('button[aria-label="Flip horizontally"]').click();
    await expect(img).toHaveAttribute("style", /scaleX\(-1\)/);

    await toolbar(app).locator('button[aria-label^="Reset zoom"]').click();
    await expect(img).not.toHaveAttribute("style", /rotate\(90deg\)/);
});

test("fullscreen covers the viewport, shows thumbnails and stays in sync with the app", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    const titles = await openGalleryNote(app, page, 0);

    await toolbar(app).locator('button[aria-label="Fullscreen"]').click();

    // The root is reparented under <body> so panes/sidebars cannot paint above it,
    // and the fixed viewer container spans the whole viewport.
    const fulledRoot = page.locator("body > .media-viewer-root.media-viewer-fulled");
    await expect(fulledRoot).toBeVisible();
    const viewerBox = await page.locator(".viewer-container.viewer-fixed").boundingBox();
    const viewport = page.viewportSize();
    expect(viewerBox?.width).toBe(viewport?.width);
    expect(viewerBox?.height).toBe(viewport?.height);

    // The thumbnail navbar exists only in fullscreen and drives real app navigation.
    const thumbnails = fulledRoot.locator(".viewer-navbar .viewer-list > li");
    await expect(thumbnails).toHaveCount(3);
    await thumbnails.nth(2).click();
    await expect(app.currentNoteSplitTitle).toHaveValue(titles[2]);

    // At the fitted zoom the horizontal arrows page through the gallery.
    await page.keyboard.press("ArrowLeft");
    await expect(app.currentNoteSplitTitle).toHaveValue(titles[1]);

    // Escape leaves fullscreen and the viewer returns into the note split.
    await page.keyboard.press("Escape");
    await expect(page.locator("body > .media-viewer-root")).toHaveCount(0);
    await expect(inlineViewer(app)).toBeVisible();
});

test("images are served with the content-addressed validator and immutable caching", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await openGalleryNote(app, page, 0);

    const src = await inlineViewer(app).locator(".viewer-canvas img").getAttribute("src");
    expect(src).toMatch(/\?v=.+/);

    // Fetch from inside the page so the standalone service worker handles it too.
    const headers = await page.evaluate(async (url) => {
        const response = await fetch(url ?? "");
        return {
            status: response.status,
            etag: response.headers.get("etag"),
            cacheControl: response.headers.get("cache-control")
        };
    }, src);

    expect(headers.status).toBe(200);
    expect(headers.etag).toBeTruthy();
    expect(headers.cacheControl).toContain("immutable");
});

test("the toolbar download button downloads the image", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    const titles = await openGalleryNote(app, page, 0);

    const downloadPromise = page.waitForEvent("download");
    await toolbar(app).locator('button[aria-label="Download"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(titles[0]);
});

test("the attachment page cycles a note's image attachments in the same viewer", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await ensureImageGallery(app, page);
    const parentNoteId = gallery?.parentNoteId ?? "";
    expect(parentNoteId).toBeTruthy();

    // Attach two images to the gallery's parent note and open its attachments page.
    // Navigate by hash: app.goto() would treat the hash-only change as the same URL and reload.
    await page.evaluate((noteId) => {
        window.location.hash = `root/${noteId}?viewMode=attachments`;
    }, parentNoteId);
    await page.getByRole("button", { name: "Upload attachments" }).click();
    const uploadDialog = page.locator(".modal.show", { hasText: "Upload attachments" });
    await uploadDialog.locator("input[type=file]").setInputFiles([
        { name: "att-red.png", mimeType: "image/png", buffer: Buffer.from(PNG_RED, "base64") },
        { name: "att-green.png", mimeType: "image/png", buffer: Buffer.from(PNG_GREEN, "base64") }
    ]);
    await uploadDialog.getByRole("button", { name: "Upload" }).click();
    await expect(uploadDialog).not.toBeVisible({ timeout: 30_000 });

    // Open the first attachment's detail page: same viewer, cycling only image attachments.
    // Everything is scoped to the visible split — hidden (kept-mounted) widgets of previous
    // views also contain attachment titles and viewer toolbars.
    await app.currentNoteSplit.locator(".attachment-title a", { hasText: "att-red.png" }).click();
    const detail = app.currentNoteSplit.locator(".attachment-detail-wrapper.full-detail");
    await expect(detail.locator(".media-viewer-root")).toBeVisible();
    await expect(detail.locator(".media-viewer-position")).toHaveText("1/2");

    await detail.locator('button[aria-label="Next image: att-green.png"]').click();
    await expect(detail.locator(".attachment-title", { hasText: "att-green.png" })).toBeVisible();
    await expect(detail.locator(".media-viewer-position")).toHaveText("2/2");
});
