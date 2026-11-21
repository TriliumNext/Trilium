import type { Page } from "playwright";

export interface Scene {
    id: string;
    query: string;
    desktopQuery?: string;
    prepare?(page: Page): Promise<unknown>;
    desktopPrepare?(page: Page): Promise<unknown>;
    /** Keeps the focus where `prepare` left it, such as in an editor whose toolbar shows. */
    keepFocus?: boolean;
    colorScheme?: "light" | "dark";
    caption: string;
    /** Replaces `query`, `prepare` and `alt` in the tablet layout. */
    tablet?: { query: string; prepare?(page: Page): Promise<unknown>; alt: string };
    /** Replaces `caption` on Flathub. */
    flathubCaption?: string;
    alt: string;
}

export interface Device {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    userAgent: string;
    /** Sets the screenshot under a caption, from `templates/screenshot.html`. */
    captioned: boolean;
}

/**
 * The screens captured from the demo document, in the order the store shows them. `query` finds the
 * note to open, and `prepare(page)` runs in Node with the Playwright page once the note shows on
 * the phone or tablet; `tablet` replaces them on the tablet, and `desktopQuery` and
 * `desktopPrepare(page)` in the desktop app for Flathub. `caption` goes above the phone
 * screenshot, on two lines that `\n` breaks; `alt` is the screenshot's description in the store
 * (at most 140 characters).
 */
export const SCENES: Scene[] = [
    {
        id: "tree",
        query: "note.title = 'Inbox'",
        desktopQuery: "note.title = 'Formatting examples'",
        prepare: (page) => page.evaluate(() => {
            window.glob.appContext.triggerCommand("setActiveScreen", { screen: "tree" });
        }),
        tablet: {
            query: "note.title = 'Trilium Demo'",
            prepare: openNoteMap,
            alt: "The note tree beside a note map of the Trilium Demo note, which links it to "
                + "the notes it mentions"
        },
        caption: "Organize everything\nin one place",
        alt: "The note tree, with the Trilium Demo note and its sections: an inbox, formatting "
            + "examples and a journal"
    },
    {
        id: "text",
        query: "note.title = 'Rome itinerary'",
        keepFocus: true,
        prepare: async (page) => {
            const editor = page.locator(".ck-editor__editable").first();
            await editor.evaluate((editable) => {
                const nested = editable.querySelectorAll("[contenteditable]");
                for (const element of [ editable, ...nested ]) {
                    if (element instanceof HTMLElement) element.spellcheck = false;
                }
            });
            await editor.locator("strong", { hasText: "9:00" }).click();
            await page.waitForTimeout(1000);
            await editor.locator("h2").evaluate((heading) => {
                heading.scrollIntoView({ block: "start", behavior: "instant" });
            });
            const isPhone = (page.viewportSize()?.width ?? 0) < 600;
            const button = isPhone ? "Text formatting" : "Block type";
            await page.locator(`.ck-toolbar [data-cke-tooltip-text='${button}']`).first().click();
            await page.mouse.move(0, 0);
        },
        caption: "Write notes with\ntables and images",
        alt: "A text note with a trip itinerary: a heading, a highlighted link, a table and a "
            + "checklist, with the formatting toolbar open"
    },
    {
        id: "board",
        query: "note.title = 'Trip planning'",
        caption: "Keep track\nof your tasks",
        alt: "A board collection with to-do, in-progress and done columns of cards for "
            + "planning a trip"
    },
    {
        id: "geo-map",
        query: "note.title *=* 'Geo Map'",
        prepare: collapseMapAttribution,
        desktopPrepare: collapseMapAttribution,
        caption: "Plan your next\ntrip on a map",
        alt: "A geo map collection with the Seven Wonders of the World pinned on a world map"
    },
    {
        id: "mind-map",
        query: "note.title = 'Mind Map' AND note.type = 'mindMap'",
        prepare: async (page) => {
            await page.locator(".mind-map-direction-side").first().click();
            await page.mouse.move(0, 0);
            await page.waitForTimeout(500);
            await zoomOutMindMap(page, 4);
        },
        desktopPrepare: (page) => page.locator(".mind-map-direction-side").first().click(),
        caption: "Brainstorm ideas\nin a mind map",
        alt: "A mind map note with branches spreading out from a central topic"
    },
    {
        id: "canvas",
        query: "note.title = 'Canvas' AND note.type = 'canvas'",
        prepare: async (page) => {
            await page.locator(".excalidraw canvas").last().click({ position: { x: 20, y: 300 } });
            await page.keyboard.press("Shift+Digit1");
        },
        desktopPrepare: async (page) => {
            await page.locator(".excalidraw canvas").last().click({ position: { x: 20, y: 300 } });
            await page.keyboard.press("Shift+Digit1");
        },
        caption: "Sketch out\nyour ideas",
        alt: "A canvas note with hand-drawn shapes and arrows"
    },
    {
        id: "diagram",
        query: "note.title = 'Flow' AND note.type = 'mermaid'",
        caption: "Draw flowcharts\nfrom plain text",
        alt: "A Mermaid flowchart above the text it is drawn from"
    },
    {
        id: "dark",
        query: "note.title = 'Split the trip costs'",
        colorScheme: "dark",
        caption: "Save code snippets,\nday or night",
        alt: "A Python code note with syntax highlighting that splits the costs of a trip, "
            + "in the dark theme"
    }
];

/**
 * Zooms the mind map out by `steps`. Mind Elixir zooms on a wheel event with `ctrlKey`, which
 * `page.mouse.wheel()` cannot send; each event zooms out by at most `scaleSensitivity`.
 */
export async function zoomOutMindMap(page: Page, steps: number) {
    await page.locator(".map-container").first().evaluate((container, count) => {
        const { left, top, width, height } = container.getBoundingClientRect();
        for (let step = 0; step < count; step++) {
            container.dispatchEvent(new WheelEvent("wheel", {
                deltaY: 400, ctrlKey: true, bubbles: true, cancelable: true,
                clientX: left + width / 2, clientY: top + height / 2
            }));
        }
    }, steps);
    await page.waitForTimeout(3000);
}

function collapseMapAttribution(page: Page) {
    return page.locator(".maplibregl-ctrl-attrib-button").first().click();
}

/** Shows the open note as a note map, the view of the links between it and other notes. */
async function openNoteMap(page: Page) {
    await page.evaluate(async () => {
        const noteContext = window.glob.appContext.tabManager.getActiveContext();
        if (noteContext?.noteId) {
            await noteContext.setNote(noteContext.noteId, { viewScope: { viewMode: "note-map" } });
        }
    });
}

export interface HeroVariant {
    /** The file in apps/website/public the snapshot is published as. */
    file: string;
    /** Finds the note the snapshot shows. */
    query: string;
    /** Hoists the note, so the tree shows only its subtree. */
    hoist: boolean;
    viewport: { width: number; height: number };
    /**
     * Renders the mobile layout with the phone's user agent and touch, and keeps the safe-area
     * insets free for the status bar and home indicator the website draws over them.
     */
    mobile?: { safeArea: { top: number; bottom: number } };
}

/**
 * The website hero: the desktop layout with the Trilium Demo note hoisted, and the mobile layout
 * with a note of its own, which the website shows in a phone in front of the desktop one. Each
 * `viewport` and safe area equals `HERO_SNAPSHOTS` in apps/website/src/pages/Home/index.tsx.
 */
export const HERO: { variants: HeroVariant[] } = {
    variants: [
        {
            file: "hero.html",
            query: "note.title = 'Trilium Demo'",
            hoist: true,
            viewport: { width: 1360, height: 920 }
        },
        {
            file: "hero-mobile.html",
            query: "note.title = 'Rome itinerary'",
            hoist: false,
            viewport: { width: 360, height: 760 },
            mobile: { safeArea: { top: 32, bottom: 20 } }
        }
    ]
};

/**
 * Store devices. The phone renders 360 x 640 CSS pixels at 3x, giving the 1080 x 1920 the store
 * needs for promotion; the tablet is landscape 16:9 at 1920 x 1080 and stays uncaptioned, since
 * the store allows no text outside the app on large-screen screenshots.
 */
export const DEVICES: Record<string, Device> = {
    phone: {
        viewport: { width: 360, height: 640 },
        deviceScaleFactor: 3,
        userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
        captioned: true
    },
    tablet: {
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1.5,
        userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        captioned: false
    }
};
