import fs from "fs";
import path from "path";
import type { Browser, BrowserContext, Page } from "playwright";

import { openApp, openNote, settle } from "../shared/browser.ts";
import { type BuildOptions, outDir, repoRoot } from "../shared/build.ts";
import { findNoteId, openDemo } from "../shared/demo_server.ts";
import { SCENES, zoomOutMindMap } from "../shared/scenes.ts";

/**
 * The website's screenshots, each of the scene in `SCENES` with the ID `scene` or of the note
 * that `query` finds in the demo document, and named after the file in
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
    {
        query: "note.title = 'Trip calendar'", file: "collection_calendar", area: "note",
        prepare: waitForCalendar
    },
    { query: "note.title = 'Places to visit'", file: "collection_table", area: "note" },
    {
        query: "note.title = 'Introducing Trilium Notes'", file: "collection_presentation",
        area: "note", prepare: waitForSlideThumbnails
    },
    { query: "note.title = 'Trip overview'", file: "collection_dashboard", area: "note" },
    {
        query: "note.title = 'Packing for Rome'", file: "feature_llm", area: "note",
        window: { noteWidth: 720, height: 1000 }
    }
];

/**
 * The window's height and the width it gives the `note` area, in the aspect ratio of
 * `.tabbed-showcase .showcase-image-frame` in apps/website/src/pages/Home/index.css.
 */
const WINDOW: WindowSize = { noteWidth: 1152, height: 720 };
const WEBP_QUALITY = 0.85;

export interface WindowSize {
    noteWidth: number;
    height: number;
}

type ColorScheme = "light" | "dark";

/**
 * A shot of the demo document in the desktop layout. `area` is the part of the window kept:
 * `note` is everything right of the note tree, `tree` is the tree, `window` is both.
 */
export interface Shot {
    scene?: string;
    query?: string;
    area: "note" | "tree" | "window";
    /** Replaces the window's height and the width of its note area, `WINDOW`. */
    window?: WindowSize;
    /** The color schemes the shot is captured in, or all those `captureShots()` opens. */
    colorSchemes?: ColorScheme[];
    prepare?(page: Page): Promise<unknown>;
}

interface WebsiteShot extends Shot {
    file: string;
}

export const WEBSITE_TARGETS = {
    "website": buildWebsite
};

/**
 * Captures the scenes of `WEBSITE_SHOTS` in light and dark, at 2x, and writes them as WebP to
 * `out/website` and to `apps/website/public`: `<file>.webp` for light and `<file>-dark.webp`
 * for dark.
 */
async function buildWebsite(browser: Browser, options: BuildOptions) {
    const websiteDir = path.join(outDir, "website");
    const publicDir = path.join(repoRoot, "apps", "website", "public");
    fs.mkdirSync(websiteDir, { recursive: true });
    const shots = WEBSITE_SHOTS
        .filter((shot) => options.only?.includes(shot.scene ?? shot.file) ?? true);
    await captureShots(browser, options, shots, {
        colorSchemes: [ "light", "dark" ],
        scale: 2,
        async write(shot, colorScheme, png) {
            const webp = await encodeWebp(browser, png);
            const suffix = colorScheme === "light" ? "" : "-dark";
            const output = path.join(websiteDir, `${shot.file}${suffix}.webp`);
            fs.writeFileSync(output, webp);
            fs.copyFileSync(output, path.join(publicDir, path.basename(output)));
            console.log(`  ${path.relative(outDir, output)} `
                + `(${Math.round(webp.length / 1024)} KB)`);
        }
    });
}

/**
 * Boots the demo document with `openDemo()`, opens a browser window per color scheme at
 * `scale`, and hands each shot's PNG to `write()`.
 */
export async function captureShots<S extends Shot>(browser: Browser, options: BuildOptions,
    shots: S[], { colorSchemes, scale, write }: {
        colorSchemes: ColorScheme[];
        scale: number;
        write(shot: S, colorScheme: ColorScheme, png: Buffer): Promise<void>;
    }) {
    const server = await openDemo(browser, options);
    const contexts: BrowserContext[] = [];
    try {
        // Both color schemes capture each shot in turn, so that they show the tree expanded alike.
        const windows = [];
        for (const colorScheme of colorSchemes) {
            const context = await browser.newContext({
                viewport: { width: 1440, height: WINDOW.height },
                deviceScaleFactor: scale,
                colorScheme,
                locale: "en-US",
                timezoneId: "Europe/Bucharest"
            });
            contexts.push(context);
            const page = await context.newPage();
            page.on("pageerror", (error) => {
                console.warn(`  [${colorScheme}] page error: ${error.message}`);
            });
            await openApp(page, server.baseUrl);
            if (!windows.length) await setOptions(page, SHOWCASE_OPTIONS);
            await openApp(page, server.baseUrl);
            windows.push({ page, colorScheme });
        }
        for (const shot of shots) {
            const scene = shot.scene ? findScene(shot.scene) : undefined;
            const query = scene ? scene.desktopQuery ?? scene.query : shot.query;
            if (!query) throw new Error(`A shot has neither a scene nor a query.`);
            const noteId = await findNoteId(server.baseUrl, query);
            for (const { page, colorScheme } of windows) {
                if (shot.colorSchemes && !shot.colorSchemes.includes(colorScheme)) continue;
                const size = shot.window ?? WINDOW;
                const noteLeft = await fitWindow(page, size);
                await openNote(page, noteId);
                await settle(page);
                await scene?.desktopPrepare?.(page);
                await shot.prepare?.(page);
                await page.mouse.move(noteLeft + size.noteWidth - 1, size.height - 1);
                await settle(page);

                const clip = shot.area === "tree"
                    ? await page.locator("#left-pane").boundingBox()
                    : {
                        x: shot.area === "note" ? noteLeft : 0,
                        y: 0,
                        width: size.noteWidth + (shot.area === "note" ? 0 : noteLeft),
                        height: size.height
                    };
                if (!clip) throw new Error("The note tree is not shown.");
                await write(shot, colorScheme, await stableScreenshot(page, clip));
            }
        }
    } finally {
        for (const context of contexts) await context.close();
        server.stop();
    }
}

/**
 * Sizes the window to `height`, with the note area right of the tree at least `noteWidth` wide,
 * and returns where the note area starts. The tree pane takes a share of the window's width, so
 * the window is widened or narrowed until the note area fits. Every shot starts from the same
 * width, so that a shot's window does not depend on the shots before it.
 */
async function fitWindow(page: Page, { noteWidth, height }: WindowSize) {
    const measure = () => page.locator(".note-split.visible").first()
        .evaluate((split) => split.getBoundingClientRect().left);
    let width = 1440;
    let noteLeft = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(300);
        noteLeft = await measure();
        const excess = width - noteLeft - noteWidth;
        if (excess >= 0 && excess < 1) break;
        width -= excess >= 0 ? Math.floor(excess) : -Math.ceil(-excess);
    }
    if (width - noteLeft < noteWidth) {
        throw new Error(`The note area does not fit ${noteWidth} px.`);
    }
    return noteLeft;
}

/**
 * Screenshots `clip` until two screenshots a second apart are identical, and returns the last,
 * so that content still loading or a transition still running does not reach the image. Gives
 * up after `attempts` with a warning.
 */
async function stableScreenshot(page: Page, clip: { x: number; y: number; width: number;
    height: number; }, attempts = 15) {
    let previous = await page.screenshot({ clip });
    for (let attempt = 0; attempt < attempts; attempt++) {
        await page.waitForTimeout(1000);
        const current = await page.screenshot({ clip });
        if (current.equals(previous)) return current;
        previous = current;
    }
    console.warn(`  The screenshot did not settle in ${attempts} s.`);
    return previous;
}

/**
 * Waits for the calendar to draw its events: `settle()` returns before FullCalendar renders on
 * the first visit of a session.
 */
export function waitForCalendar(page: Page) {
    return page.locator(".calendar-event[data-event-note-id]").first().waitFor();
}

/**
 * Waits for the presentation's sidebar to draw every slide thumbnail: each one renders in its own
 * shadow root once the theme's stylesheets arrive, a slide at a time, with gaps longer than
 * `stableScreenshot()` waits between two screenshots.
 */
export async function waitForSlideThumbnails(page: Page) {
    await page.waitForFunction(() => {
        const thumbnails = [
            ...document.querySelectorAll(".presentation-sidebar .slide-thumbnail")
        ];
        return thumbnails.length > 0 && thumbnails.every((thumbnail) => {
            if (thumbnail.classList.contains("slide-thumbnail-placeholder")) return true;
            const root = thumbnail.shadowRoot;
            const content = root?.querySelector(".slide-content");
            return !!root && root.adoptedStyleSheets.length > 0 && !!content
                && content.getBoundingClientRect().height > 0;
        });
    }, null, { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
}

function findScene(id: string) {
    const scene = SCENES.find((candidate) => candidate.id === id);
    if (!scene) throw new Error(`No scene has the ID ${id}.`);
    return scene;
}

/**
 * The options the screenshots are taken with: no right pane, and an AI provider for the AI chat
 * to show its input bar instead of a prompt to add one. The provider has no key and is never
 * called.
 */
const SHOWCASE_OPTIONS = {
    rightPaneVisible: "false",
    llmProviders: JSON.stringify([ {
        id: "showcase",
        name: "Anthropic",
        provider: "anthropic",
        kind: "llm",
        selectedModels: [ { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", isDefault: true } ]
    } ])
};

/** Sets options through the options API, for the app's next load. */
async function setOptions(page: Page, options: Record<string, string>) {
    const status = await page.evaluate(async (body) => {
        const response = await fetch("api/options", {
            method: "PUT",
            headers: { ...await window.glob.getHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        return response.status;
    }, options);
    if (status >= 400) throw new Error(`Setting the options failed (${status}).`);
}

/** Encodes a PNG as WebP through a canvas, since Playwright screenshots only as PNG or JPEG. */
export async function encodeWebp(browser: Browser, png: Buffer) {
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
