/**
 * The screens captured from the demo document, in the order the store shows them. `query` finds the
 * note to open, and `prepare(page)` runs in Node with the Playwright page once the note shows.
 * `caption` goes above the phone screenshot; `alt` is the screenshot's description in the store
 * (at most 140 characters).
 */
export const SCENES = [
    {
        id: "tree",
        query: "note.title = 'Inbox'",
        prepare: (page) => page.evaluate(() => {
            window.glob.appContext.triggerCommand("setActiveScreen", { screen: "tree" });
        }),
        caption: "Organize your notes in a tree as deep as you need",
        alt: "The note tree, with the Trilium Demo note and its sections: an inbox, formatting "
            + "examples and a journal"
    },
    {
        id: "text",
        query: "note.title = 'Trilium Demo'",
        caption: "Write rich notes with images, tables and links",
        alt: "A text note welcoming the reader to Trilium Notes, with an image and links"
    },
    {
        id: "board",
        query: "note.title = 'Trip planning'",
        caption: "Track tasks on a board",
        alt: "A board collection with to-do, in-progress and done columns of cards for "
            + "planning a trip"
    },
    {
        id: "geo-map",
        query: "note.title *=* 'Geo Map'",
        prepare: (page) => page.locator(".maplibregl-ctrl-attrib-button").first().click(),
        caption: "Pin your notes on a map",
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
        caption: "Map out ideas in a mind map",
        alt: "A mind map note with branches spreading out from a central topic"
    },
    {
        id: "canvas",
        query: "note.title = 'Canvas' AND note.type = 'canvas'",
        prepare: async (page) => {
            await page.locator(".excalidraw canvas").last().click({ position: { x: 20, y: 300 } });
            await page.keyboard.press("Shift+Digit1");
        },
        caption: "Sketch on an infinite canvas",
        alt: "A canvas note with hand-drawn shapes and arrows"
    },
    {
        id: "diagram",
        query: "note.title = 'Flow' AND note.type = 'mermaid'",
        caption: "Turn text into diagrams",
        alt: "A Mermaid flowchart above the text it is drawn from"
    },
    {
        id: "dark",
        query: "note.title = 'Code blocks'",
        colorScheme: "dark",
        caption: "Code with syntax highlighting, in light or dark",
        alt: "A text note with a highlighted code block, in the dark theme"
    }
];

/**
 * Store devices. The phone renders 360 x 640 CSS pixels at 3x, giving the 1080 x 1920 the store
 * needs for promotion; the tablet is landscape 16:9 at 1920 x 1080 and stays uncaptioned, since
 * the store allows no text outside the app on large-screen screenshots.
 */
export const DEVICES = {
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
 * `api` in scope: a board of trip-planning cards under the Trilium Demo note, and a view of the
 * geo map that shows most of its markers.
 */
export function SEED() {
    const demo = api.searchForNote("note.title = 'Trilium Demo'");
    const board = api.createNewNote({
        parentNoteId: demo.noteId, title: "Trip planning", type: "book", content: ""
    }).note;
    board.setLabel("collection");
    board.setLabel("viewType", "board");
    board.setLabel("iconClass", "bx bx-trip");
    board.setLabel("hidePromotedAttributes");
    board.setLabel("subtreeHidden");
    const cards = [
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

    const geoMap = api.searchForNote("note.title *=* 'Geo Map'");
    const [ viewConfig ] = geoMap.getAttachmentsByRole("viewConfig");
    viewConfig.setContent(JSON.stringify({ view: { center: { lat: 30, lng: 23 }, zoom: 1.5 } }));
}
