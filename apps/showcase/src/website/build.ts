import fs from "fs";
import path from "path";
import type { Browser, BrowserContext, Page } from "playwright";

import { openApp, openNote, settle } from "../shared/browser.ts";
import { type BuildOptions, outDir, repoRoot } from "../shared/build.ts";
import { findNoteId, openDemo, seedDocument } from "../shared/demo_server.ts";
import { SCENES, zoomOutMindMap } from "../shared/scenes.ts";
import { BOOKING_HTML, buildBudgetWorkbook, GETTING_AROUND, WEBSITE_SEED } from "./seed.ts";

/**
 * The website's screenshots, each of the scene in `SCENES` with the ID `scene` or of the note
 * that `query` finds among those `WEBSITE_SEED` adds, and named after the file in
 * `apps/website/public` it replaces. `area` is the part of the window kept: `note` is
 * everything right of the note tree, from the tab bar to the status bar, and `tree` is the tree.
 * `prepare(page)` runs after the scene's `desktopPrepare`.
 */
const WEBSITE_SHOTS: WebsiteShot[] = [
    { scene: "tree", file: "feature_tree", area: "tree" },
    { scene: "text", file: "type_text", area: "note" },
    { scene: "dark", file: "type_code", area: "note" },
    { scene: "canvas", file: "type_canvas", area: "note" },
    { scene: "diagram", file: "type_mermaid", area: "note" },
    {
        scene: "mind-map", file: "type_mindmap", area: "note",
        prepare: (page) => zoomOutMindMap(page, 2)
    },
    { scene: "board", file: "collection_board", area: "note" },
    { scene: "geo-map", file: "collection_geomap", area: "note" },
    { query: "note.title = 'Getting around'", file: "type_markdown", area: "note" },
    { query: "note.title = 'Trip budget'", file: "type_spreadsheet", area: "note" },
    { query: "note.title = 'Hotel booking.pdf'", file: "type_file", area: "note" },
    { query: "note.title = 'Trip calendar'", file: "collection_calendar", area: "note" },
    { query: "note.title = 'Places to visit'", file: "collection_table", area: "note" },
    { query: "note.title = 'Rome in three days'", file: "collection_presentation", area: "note" },
    { query: "note.title = 'Trip overview'", file: "collection_dashboard", area: "note" }
];

/**
 * The window is as tall as `WINDOW_HEIGHT` and as wide as gives the `note` area the aspect ratio
 * of `.tabbed-showcase .showcase-image-frame` in apps/website/src/pages/Home/index.css.
 */
const WINDOW_HEIGHT = 720;
const NOTE_ASPECT_RATIO = 16 / 10;
const WEBP_QUALITY = 0.85;

interface WebsiteShot {
    scene?: string;
    query?: string;
    file: string;
    area: "note" | "tree";
    prepare?(page: Page): Promise<unknown>;
}

export const WEBSITE_TARGETS = {
    "website": buildWebsite
};

/**
 * Captures the scenes of `WEBSITE_SHOTS` in the desktop layout of a browser, in light and dark,
 * at 2x, and writes them as WebP to `out/website` and to `apps/website/public`: `<file>.webp`
 * for light and `<file>-dark.webp` for dark.
 */
async function buildWebsite(browser: Browser, options: BuildOptions) {
    const websiteDir = path.join(outDir, "website");
    const publicDir = path.join(repoRoot, "apps", "website", "public");
    fs.mkdirSync(websiteDir, { recursive: true });
    const shots = WEBSITE_SHOTS
        .filter((shot) => options.only?.includes(shot.scene ?? shot.file) ?? true);
    const server = await openDemo(browser, options);
    await seedDocument(browser, server.baseUrl, WEBSITE_SEED, [ {
        markdown: GETTING_AROUND,
        workbook: buildBudgetWorkbook(),
        bookingPdf: (await printPdf(browser, BOOKING_HTML)).toString("base64")
    } ]);
    const contexts: BrowserContext[] = [];
    try {
        // Both color schemes capture each shot in turn, so that they show the tree expanded alike.
        const windows = [];
        for (const colorScheme of [ "light", "dark" ] as const) {
            const context = await browser.newContext({
                viewport: { width: 1440, height: WINDOW_HEIGHT },
                deviceScaleFactor: 2,
                colorScheme
            });
            contexts.push(context);
            const page = await context.newPage();
            page.on("pageerror", (error) => {
                console.warn(`  [website/${colorScheme}] page error: ${error.message}`);
            });
            await openApp(page, server.baseUrl);
            if (!windows.length) await hideRightPane(page);
            await openApp(page, server.baseUrl);
            windows.push({ page, suffix: colorScheme === "light" ? "" : "-dark" });
        }
        // The tree pane's width follows the window's, so the window is sized until the note area
        // keeps its width.
        const noteWidth = Math.round(WINDOW_HEIGHT * NOTE_ASPECT_RATIO);
        let noteLeft = 0;
        let width = 0;
        for (let attempt = 0; attempt < 5 && width !== noteLeft + noteWidth; attempt++) {
            if (width) {
                width = noteLeft + noteWidth;
                await windows[0].page.setViewportSize({ width, height: WINDOW_HEIGHT });
                await windows[0].page.waitForTimeout(500);
            } else {
                width = windows[0].page.viewportSize()?.width ?? 0;
            }
            noteLeft = await windows[0].page.locator(".note-split.visible").first()
                .evaluate((split) => Math.round(split.getBoundingClientRect().left));
        }
        for (const { page } of windows) {
            await page.setViewportSize({ width, height: WINDOW_HEIGHT });
        }

        for (const shot of shots) {
            const scene = shot.scene ? findScene(shot.scene) : undefined;
            const query = scene ? scene.desktopQuery ?? scene.query : shot.query;
            if (!query) throw new Error(`The website shot ${shot.file} has no scene or query.`);
            const noteId = await findNoteId(server.baseUrl, query);
            for (const { page, suffix } of windows) {
                await openNote(page, noteId);
                await settle(page);
                await scene?.desktopPrepare?.(page);
                await shot.prepare?.(page);
                await page.mouse.move(width - 1, WINDOW_HEIGHT - 1);
                await settle(page);

                const clip = shot.area === "note"
                    ? { x: noteLeft, y: 0, width: width - noteLeft, height: WINDOW_HEIGHT }
                    : await page.locator("#left-pane").boundingBox();
                if (!clip) throw new Error("The note tree is not shown.");
                const webp = await encodeWebp(browser, await page.screenshot({ clip }));
                const output = path.join(websiteDir, `${shot.file}${suffix}.webp`);
                fs.writeFileSync(output, webp);
                fs.copyFileSync(output, path.join(publicDir, path.basename(output)));
                console.log(`  ${path.relative(outDir, output)} `
                    + `(${Math.round(webp.length / 1024)} KB)`);
            }
        }
    } finally {
        for (const context of contexts) await context.close();
        server.stop();
    }
}

function findScene(id: string) {
    const scene = SCENES.find((candidate) => candidate.id === id);
    if (!scene) throw new Error(`No scene has the ID ${id}.`);
    return scene;
}

/** Turns the right pane off through the options API, for the app's next load. */
async function hideRightPane(page: Page) {
    const status = await page.evaluate(async () => {
        const response = await fetch("api/options/rightPaneVisible/false", {
            method: "PUT",
            headers: await window.glob.getHeaders()
        });
        return response.status;
    });
    if (status >= 400) throw new Error(`Hiding the right pane failed (${status}).`);
}

async function printPdf(browser: Browser, html: string) {
    const page = await browser.newPage();
    try {
        await page.setContent(html);
        return await page.pdf({ format: "A4", printBackground: true });
    } finally {
        await page.close();
    }
}

/** Encodes a PNG as WebP through a canvas, since Playwright screenshots only as PNG or JPEG. */
async function encodeWebp(browser: Browser, png: Buffer) {
    const page = await browser.newPage();
    try {
        const dataUrl = await page.evaluate(async ({ source, quality }) => {
            const image = new Image();
            image.src = source;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext("2d")?.drawImage(image, 0, 0);
            return canvas.toDataURL("image/webp", quality);
        }, { source: `data:image/png;base64,${png.toString("base64")}`, quality: WEBP_QUALITY });
        return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    } finally {
        await page.close();
    }
}
