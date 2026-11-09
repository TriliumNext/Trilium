import { expect, type Page, test } from "@playwright/test";

import App from "../support/app";
import {
    findThrashingFrames, summarizeThrashing, type TraceEvent
} from "../support/layout_thrashing";

const TRACE_CATEGORIES = [
    "toplevel",
    "devtools.timeline",
    "disabled-by-default-devtools.timeline",
    "disabled-by-default-devtools.timeline.frame",
    "disabled-by-default-devtools.timeline.stack"
];

/**
 * CKEditor's `PoweredBy` balloon stays pinned to the editable while `style.css` hides it, and
 * `BalloonPanelView.attachTo()` measures it on every scroll, which makes a few frames thrash.
 */
const MAX_THRASHING_SHARE = 0.1;

test.describe("Scrolling a text note", () => {
    let previousEditorType: string | undefined;

    test.afterEach(async ({ page, context }) => {
        if (!previousEditorType) return;
        await new App(page, context).setOption("textNoteEditorType", previousEditorType);
    });

    test("computes style and layout once a frame", async ({ page, context, browserName }) => {
        test.skip(browserName !== "chromium", "Tracing needs Chromium.");

        const app = new App(page, context);
        await app.goto();
        // The block drag handle exists only with the fixed toolbar.
        previousEditorType = await getOption(page, "textNoteEditorType");
        await app.setOption("textNoteEditorType", "ckeditor-classic");
        await app.goto();

        const title = `Long note ${Date.now().toString(36)}`;
        await createLongTextNote(page, title);
        await app.goToNoteInNewTab(title);

        // With the caret in the first paragraph, the editor follows that block on every scroll.
        const editor = app.currentNoteSplit.locator(".note-detail-editable-text-editor");
        await editor.locator("p").first().click({ position: { x: 2, y: 2 } });
        const scrollingContainer = app.currentNoteSplit.locator(".scrolling-container");
        const box = await scrollingContainer.boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.move(
            (box?.x ?? 0) + (box?.width ?? 0) / 2,
            (box?.y ?? 0) + (box?.height ?? 0) / 2
        );

        const browser = context.browser();
        expect(browser).not.toBeNull();
        await browser?.startTracing(page, { categories: TRACE_CATEGORIES });
        for (let step = 0; step < 40; step++) {
            await page.mouse.wheel(0, 120);
            await page.waitForTimeout(30);
        }
        const trace = await browser?.stopTracing();
        const scrollTop = await scrollingContainer.evaluate((element) => element.scrollTop);
        expect(scrollTop).toBeGreaterThan(0);

        const { traceEvents } = JSON.parse(trace?.toString() ?? "{}") as {
            traceEvents: TraceEvent[];
        };
        const report = findThrashingFrames(traceEvents);
        expect(report.frameCount).toBeGreaterThan(0);
        expect(report.thrashing.length, summarizeThrashing(report))
            .toBeLessThanOrEqual(report.frameCount * MAX_THRASHING_SHARE);
    });
});

/**
 * Creates a text note long enough to scroll, with inline formatting as in a real note, that opens
 * editable whatever its size.
 */
async function createLongTextNote(page: Page, title: string) {
    const paragraph = "<p>Some <strong>bold</strong> text, a "
        + "<a href=\"https://triliumnotes.org\">link</a>, "
        + "<em>italics</em> and <code>code</code>, long enough to wrap onto a second line in "
        + "the note pane at the width of the test browser window.</p>";
    const content = Array.from({ length: 100 }, (_, index) => (index % 10 === 0
        ? `<h2>Section ${index / 10 + 1}</h2>`
        : paragraph)).join("");

    await page.evaluate(async ({ title, content }) => {
        const headers = {
            "content-type": "application/json",
            "x-csrf-token": (window as any).glob.csrfToken
        };
        const response = await fetch("/api/notes/root/children?target=into", {
            method: "POST",
            headers,
            body: JSON.stringify({ title, content, type: "text" })
        });
        if (!response.ok) throw new Error(`Creating the note failed (status=${response.status})`);

        const { note } = await response.json();
        await fetch(`/api/notes/${note.noteId}/attributes`, {
            method: "POST",
            headers,
            body: JSON.stringify({ type: "label", name: "autoReadOnlyDisabled", value: "" })
        });
    }, { title, content });
}

async function getOption(page: Page, name: string): Promise<string | undefined> {
    return page.evaluate(async (name) => {
        const response = await fetch("/api/options");
        const options = await response.json() as Record<string, string>;
        return options[name];
    }, name);
}

