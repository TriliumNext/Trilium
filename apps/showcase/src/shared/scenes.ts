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

/** The part of the backend script API that `SEED` calls. */
declare const api: {
    searchForNote(query: string): SeedNote;
    createNewNote(params: object): { note: SeedNote };
    createTextNote(parentNoteId: string, title: string, content: string): { note: SeedNote };
};

interface SeedNote {
    noteId: string;
    setLabel(name: string, value?: string): void;
    getAttachmentsByRole(role: string): { setContent(content: string): void }[];
}

/**
 * The screens captured from the demo document, in the order the store shows them. `query` finds the
 * note to open, and `prepare(page)` runs in Node with the Playwright page once the note shows on
 * the phone or tablet; `desktopQuery` and `desktopPrepare(page)` replace them in the desktop app
 * for Flathub.
 * `caption` goes above the phone screenshot, with `\n` where its two lines break; `alt` is the
 * screenshot's description in the store (at most 140 characters).
 */
export const SCENES: Scene[] = [
    {
        id: "tree",
        query: "note.title = 'Inbox'",
        desktopQuery: "note.title = 'Formatting examples'",
        prepare: (page) => page.evaluate(() => {
            window.glob.appContext.triggerCommand("setActiveScreen", { screen: "tree" });
        }),
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
            // Mind Elixir zooms on a wheel event with `ctrlKey`, which `page.mouse.wheel()` cannot
            // send. Each event zooms out by at most `scaleSensitivity`.
            await page.locator(".map-container").first().evaluate((container, steps) => {
                const { left, top, width, height } = container.getBoundingClientRect();
                for (let step = 0; step < steps; step++) {
                    container.dispatchEvent(new WheelEvent("wheel", {
                        deltaY: 400, ctrlKey: true, bubbles: true, cancelable: true,
                        clientX: left + width / 2, clientY: top + height / 2
                    }));
                }
            }, 4);
            await page.waitForTimeout(3000);
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

function collapseMapAttribution(page: Page) {
    return page.locator(".maplibregl-ctrl-attrib-button").first().click();
}

/**
 * The website hero: the desktop layout in a browser, with the note that `query` finds hoisted and
 * open. The hero's frame in apps/website/src/pages/Home/index.css has the aspect ratio of
 * `viewport`.
 */
export const HERO = {
    query: "note.title = 'Trilium Demo'",
    viewport: { width: 1360, height: 920 }
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

/**
 * Adds what the demo document lacks for the scenes above, as a backend script with the script
 * `api` in scope: a board of trip-planning cards and a Python code note under the Trilium Demo
 * note, a text note with a Rome itinerary, and a view of the geo map that shows most of its
 * markers. `tripCosts` and `itinerary` are the contents of the two notes, `TRIP_COSTS` and
 * `ITINERARY`.
 */
export function SEED(tripCosts: string, itinerary: string) {
    const demo = api.searchForNote("note.title = 'Trilium Demo'");
    const board = api.createNewNote({
        parentNoteId: demo.noteId, title: "Trip planning", type: "book", content: ""
    }).note;
    board.setLabel("collection");
    board.setLabel("viewType", "board");
    board.setLabel("iconClass", "bx bx-trip");
    board.setLabel("hidePromotedAttributes");
    board.setLabel("subtreeHidden");
    const cards: [ string, string, string ][] = [
        [ "To do", "Book the flights", "bx bxs-plane-take-off" ],
        [ "To do", "Rent a car", "bx bx-car" ],
        [ "To do", "Pack the camera", "bx bx-camera" ],
        [ "To do", "Buy travel insurance", "bx bx-shield-quarter" ],
        [ "To do", "Exchange some currency", "bx bx-euro" ],
        [ "In progress", "Plan the route", "bx bx-map-alt" ],
        [ "In progress", "Find places to stay", "bx bx-bed" ],
        [ "Done", "Renew the passport", "bx bx-id-card" ],
        [ "Done", "Ask for time off", "bx bx-calendar-check" ],
        [ "Done", "Pick the dates", "bx bx-calendar" ]
    ];
    for (const [ status, title, icon ] of cards) {
        const card = api.createTextNote(board.noteId, title, "").note;
        card.setLabel("status", status);
        card.setLabel("iconClass", icon);
    }

    api.createNewNote({
        parentNoteId: demo.noteId,
        title: "Split the trip costs",
        type: "code",
        mime: "text/x-python",
        content: tripCosts
    });

    const colosseum = api.searchForNote("note.title = 'The Colosseum, Rome, Italy'");
    api.createTextNote(demo.noteId, "Rome itinerary",
        itinerary.replace("{{colosseum}}", colosseum.noteId));

    const geoMap = api.searchForNote("note.title *=* 'Geo Map'");
    const [ viewConfig ] = geoMap.getAttachmentsByRole("viewConfig");
    viewConfig.setContent(JSON.stringify({ view: { center: { lat: 30, lng: 23 }, zoom: 1.5 } }));
}

/** The content of the code note that `SEED` adds. */
export const TRIP_COSTS = `# Who owes what after the trip
costs = {
    "Flights": 640.00,
    "Car rental": 310.50,
    "Hotel": 482.00,
    "Museum": 54.00,
    "Dinner": 96.40,
}
people = ["Ana", "Ben", "Eve"]


def split(cost, n):
    """Each person's share."""
    return round(cost / n, 2)


total = sum(costs.values())
count = len(people)
share = split(total, count)

for name in people:
    print(f"{name}: {share}")
`;

/** The content of the text note that `SEED` adds; `{{colosseum}}` is the Colosseum note's ID. */
export const ITINERARY = [
    "<p>Three days in the Eternal City with <strong>Ana</strong>, <strong>Ben</strong> and "
        + "<strong>Eve</strong>.</p>",
    "<h2>Day 1: Ancient Rome</h2>",
    "<p>Meet at <a class=\"reference-link\" href=\"#root/{{colosseum}}\">The Colosseum</a> at "
        + "<strong>9:00</strong>, then walk through the <i>Roman Forum</i> to "
        + "<span style=\"background-color:hsl(60,75%,60%);\">Palatine Hill</span>.</p>",
    "<aside class=\"admonition tip\"><p>Book the tickets online: the queue takes hours.</p>"
        + "</aside>",
    "<h3>Where to eat</h3>",
    "<figure class=\"table\" style=\"width:330px;\"><table><thead>"
        + "<tr><th>Place</th><th>Order</th><th>Price</th></tr></thead><tbody>"
        + "<tr><td>Trattoria</td><td>Carbonara</td><td>€18</td></tr>"
        + "<tr><td>Pizzeria</td><td>Margherita</td><td>€11</td></tr>"
        + "<tr><td>Gelateria</td><td>Pistachio</td><td>€4</td></tr>"
        + "</tbody></table></figure>",
    "<h3>Packing list</h3>",
    "<ul class=\"todo-list\">"
        + ([ [ "Passports", true ], [ "Comfortable shoes", true ], [ "Camera charger", false ],
            [ "Travel adapter", false ] ] as const).map(([ item, done ]) => "<li><label "
            + "class=\"todo-list__label\"><input type=\"checkbox\""
            + (done ? " checked=\"checked\"" : "") + " disabled=\"disabled\"><span "
            + `class="todo-list__label__description">${item}</span></label></li>`).join("")
        + "</ul>"
].join("");
