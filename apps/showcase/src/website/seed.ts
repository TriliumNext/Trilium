/** The part of the backend script API that `WEBSITE_SEED` calls. */
declare const api: {
    searchForNote(query: string): SeedNote | null;
    createNewNote(params: object): { note: SeedNote };
    createTextNote(parentNoteId: string, title: string, content: string): { note: SeedNote };
    ensureNoteIsPresentInParent(noteId: string, parentNoteId: string): void;
};

interface SeedNote {
    noteId: string;
    setLabel(name: string, value?: string): void;
    saveAttachment(attachment: object): void;
}

/** What `WEBSITE_SEED` adds, passed to it as its one argument. */
export interface WebsiteSeedData {
    markdown: string;
    workbook: string;
    /** The PDF of the file note, in Base64. */
    bookingPdf: string;
    /** The packing list the AI chat writes, as Markdown for the tool call and HTML for the note. */
    packingMarkdown: string;
    packingHtml: string;
    /** The presentation added beside the trip, `TALK`. */
    talkDeck: TalkDeck;
}

/** A presentation: its slides, and the background of those marked `glow`. */
export interface TalkDeck {
    glow: string;
    slides: {
        title: string;
        content: string;
        glow?: boolean;
        /** The vertical slides, as title, content and an optional note type. */
        slides?: [ string, string, "mermaid"? ][];
    }[];
}

/**
 * Adds the notes that the website's screenshots of the other note types and collections show,
 * in a "Trip to Rome" note under the Trilium Demo note, as a backend script with the script `api`
 * in scope: a Markdown note, a budget spreadsheet, a hotel booking PDF, a calendar, a table of
 * places to visit, a dashboard of clones of three of the trip's notes, and an AI chat that reads
 * the trip and writes a packing list into it; and beside the trip, a presentation about Trilium.
 * It adds nothing when the trip exists, as on a running server given with --url that was seeded
 * before.
 */
export function WEBSITE_SEED({
    markdown, workbook, bookingPdf, packingMarkdown, packingHtml, talkDeck
}: WebsiteSeedData) {
    if (api.searchForNote("note.title = 'Trip to Rome'")) return;
    const demo = api.searchForNote("note.title = 'Trilium Demo'");
    if (!demo) throw new Error("The demo document has no Trilium Demo note.");
    const trip = api.createTextNote(demo.noteId, "Trip to Rome", "").note;
    trip.setLabel("iconClass", "bx bx-world");
    const create = (params: object) => {
        return api.createNewNote({ parentNoteId: trip.noteId, ...params }).note;
    };
    const collection = (title: string, viewType: string, icon: string) => {
        const note = create({ title, type: "book", content: "" });
        note.setLabel("collection");
        note.setLabel("viewType", viewType);
        note.setLabel("iconClass", icon);
        return note;
    };

    const gettingAround = create({ title: "Getting around", type: "code", mime: "text/x-markdown",
        content: markdown });
    gettingAround.setLabel("iconClass", "bx bxl-markdown");
    const budget = create({ title: "Trip budget", type: "spreadsheet", mime: "application/json",
        content: workbook });
    budget.setLabel("iconClass", "bx bx-spreadsheet");
    const booking = create({ title: "Hotel booking.pdf", type: "file", mime: "application/pdf",
        content: Buffer.from(bookingPdf, "base64") });
    booking.setLabel("originalFileName", "Hotel booking.pdf");

    const calendar = collection("Trip calendar", "calendar", "bx bx-calendar");
    calendar.setLabel("calendar:initialDate", "2026-05-01");
    const events: [ string, string, string?, string?, string? ][] = [
        // Title, start date, end date, start time, color.
        [ "Book club", "2026-05-05", undefined, "19:00", "#7c3aed" ],
        [ "Dentist", "2026-05-07", undefined, "10:30", "#0891b2" ],
        [ "Trip to Rome", "2026-05-12", "2026-05-15", undefined, "#16a34a" ],
        [ "Flight to Rome", "2026-05-12", undefined, "07:40", "#ea580c" ],
        [ "Colosseum tour", "2026-05-13", undefined, "09:00", "#ea580c" ],
        [ "Vatican Museums", "2026-05-14", undefined, "10:00", "#ea580c" ],
        [ "Flight home", "2026-05-15", undefined, "18:20", "#ea580c" ],
        [ "Team offsite", "2026-05-20", "2026-05-21", undefined, "#2563eb" ],
        [ "Mom's birthday", "2026-05-26", undefined, undefined, "#db2777" ],
        [ "Book club", "2026-05-27", undefined, "19:00", "#7c3aed" ]
    ];
    for (const [ title, startDate, endDate, startTime, color ] of events) {
        const event = api.createTextNote(calendar.noteId, title, "").note;
        event.setLabel("startDate", startDate);
        if (endDate) event.setLabel("endDate", endDate);
        if (startTime) event.setLabel("startTime", startTime);
        if (color) event.setLabel("color", color);
    }

    const places = collection("Places to visit", "table", "bx bx-map-pin");
    places.setLabel("label:day", "promoted,alias=Day,single,number");
    places.setLabel("label:ticket", "promoted,alias=Ticket (€),single,number");
    places.setLabel("label:booked", "promoted,alias=Booked,single,boolean");
    places.setLabel("label:area", "promoted,alias=Area,single,text");
    const sights: [ string, number, number, boolean, string ][] = [
        [ "Colosseum", 1, 18, true, "Ancient Rome" ],
        [ "Roman Forum", 1, 0, true, "Ancient Rome" ],
        [ "Palatine Hill", 1, 0, true, "Ancient Rome" ],
        [ "Vatican Museums", 2, 20, true, "Vatican" ],
        [ "St. Peter's Basilica", 2, 0, false, "Vatican" ],
        [ "Castel Sant'Angelo", 2, 16, false, "Prati" ],
        [ "Pantheon", 3, 5, false, "Centro Storico" ],
        [ "Trevi Fountain", 3, 0, false, "Trevi" ],
        [ "Borghese Gallery", 3, 15, false, "Villa Borghese" ]
    ];
    const sightNotes: SeedNote[] = [];
    for (const [ title, day, ticket, booked, area ] of sights) {
        const sight = api.createTextNote(places.noteId, title, "").note;
        sightNotes.push(sight);
        sight.setLabel("day", String(day));
        sight.setLabel("ticket", String(ticket));
        sight.setLabel("booked", String(booked));
        sight.setLabel("area", area);
    }

    // A talk about Trilium, beside the trip: the section slides carry the brand glows as their
    // background, and the sections' slides are their vertical slides.
    const talk = api.createNewNote({
        parentNoteId: demo.noteId, title: "Introducing Trilium Notes", type: "book", content: ""
    }).note;
    talk.setLabel("collection");
    talk.setLabel("viewType", "presentation");
    talk.setLabel("iconClass", "bx bx-slideshow");
    talk.setLabel("presentation:theme", "white");
    for (const { title, content, glow, slides } of talkDeck.slides) {
        const slide = api.createTextNote(talk.noteId, title, content).note;
        if (glow) slide.setLabel("slide:background", talkDeck.glow);
        for (const [ childTitle, childContent, type ] of slides ?? []) {
            const kind = type === "mermaid"
                ? { type: "mermaid", mime: "text/vnd.mermaid" }
                : { type: "text" };
            api.createNewNote({
                parentNoteId: slide.noteId, title: childTitle, content: childContent, ...kind
            });
        }
    }

    const overview = collection("Trip overview", "dashboard", "bx bx-grid-alt");
    const widgets: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const tiles: [ string, number, number, number, number ][] = [
        [ "Rome itinerary", 0, 0, 5, 7 ],
        [ "Getting around", 5, 0, 7, 4 ],
        [ "Split the trip costs", 5, 4, 7, 3 ]
    ];
    for (const [ title, x, y, w, h ] of tiles) {
        const note = api.searchForNote(`note.title = '${title}'`);
        if (!note) continue;
        api.ensureNoteIsPresentInParent(note.noteId, overview.noteId);
        widgets[note.noteId] = { x, y, w, h };
    }
    overview.saveAttachment({
        role: "viewConfig",
        title: "dashboard.json",
        mime: "application/json",
        content: JSON.stringify({ widgets })
    });

    // The chat the AI screenshot shows: what a provider stores after reading the trip and
    // writing the packing list, with the tool calls pointing at the notes above.
    const packing = api.createTextNote(trip.noteId, "What to pack", packingHtml).note;
    packing.setLabel("iconClass", "bx bxs-briefcase-alt-2");
    const itinerary = api.searchForNote("note.title = 'Rome itinerary'");
    const calls: [ string, object, unknown ][] = [
        [ "get_child_notes", { noteId: trip.noteId }, [
            [ gettingAround, "Getting around", "code", 0 ],
            [ budget, "Trip budget", "spreadsheet", 0 ],
            [ booking, "Hotel booking.pdf", "file", 0 ], [ calendar, "Trip calendar", "book", 10 ],
            [ places, "Places to visit", "book", 9 ],
            [ overview, "Trip overview", "book", 3 ]
        ].map(([ note, title, type, childCount ]) => {
            return { noteId: (note as SeedNote).noteId, title, type, childCount };
        }) ],
        [ "get_note_content", { noteId: itinerary?.noteId }, {
            noteId: itinerary?.noteId,
            content: "Three days in the Eternal City with **Ana**, **Ben** and **Eve**.\n\n"
                + "## Day 1: Ancient Rome\n\nMeet at The Colosseum at **9:00**, then walk "
                + "through the *Roman Forum* to Palatine Hill.\n\n### Packing list\n\n"
                + "- [x] Passports\n- [x] Comfortable shoes\n- [ ] Camera charger\n"
                + "- [ ] Travel adapter"
        } ],
        [ "get_note_content", { noteId: booking.noteId }, {
            noteId: booking.noteId,
            content: "Hotel Colosseo. Booking reference RM-48213, for Ana, Ben and Eve. Check-in "
                + "Tuesday, May 12, 2026. Check-out Friday, May 15, 2026. Breakfast included."
        } ],
        [ "get_child_notes", { noteId: places.noteId }, sights.map(([ title ], index) => {
            return { noteId: sightNotes[index].noteId, title, type: "text", childCount: 0 };
        }) ],
        [ "create_note", { parentNoteId: trip.noteId, title: "What to pack", type: "text",
            content: packingMarkdown }, { success: true, noteId: packing.noteId,
            title: "What to pack", type: "text", content: packingMarkdown } ],
        [ "search_icons", { query: "suitcase luggage travel" }, { totalResults: 3, results: [
            { iconClass: "bx bxs-briefcase-alt-2",
                terms: [ "briefcase-alt-2", "travel", "suitcase" ] },
            { iconClass: "bx bx-briefcase", terms: [ "briefcase", "travel", "suitcase" ] },
            { iconClass: "bx bx-trip", terms: [ "trip", "travel", "luggage" ] }
        ] } ],
        [ "set_attribute", { noteId: packing.noteId, type: "label", name: "iconClass",
            value: "bx bxs-briefcase-alt-2" }, { success: true, noteId: packing.noteId,
            type: "label", name: "iconClass", value: "bx bxs-briefcase-alt-2" } ]
    ];
    const toolCall = ([ toolName, input, result ]: [ string, object, unknown ], index: number) => ({
        type: "tool_call",
        toolCall: { id: `toolu_${index}`, toolName, input, result: JSON.stringify(result),
            isError: false }
    });
    const text = (content: string) => ({ type: "text", content });
    const chat = {
        version: 1,
        messages: [ {
            id: "packingQuestion",
            role: "user",
            content: "Have a look at this trip and tell me what to pack. "
                + "Write it into a new subnote.",
            createdAt: "2026-05-04T18:02:11.000Z"
        }, {
            id: "packingAnswer",
            role: "assistant",
            content: [
                text("I'll read through the trip first."),
                ...calls.slice(0, 4).map(toolCall),
                text("Three nights in Rome in mid-May, with a lot of walking: the Colosseum, the "
                    + "Forum, the Vatican and the Borghese Gallery. I'll write the list into a "
                    + "subnote."),
                ...calls.slice(4).map((call, index) => toolCall(call, index + 4)),
                text(`I wrote the packing list into [[${packing.noteId}]]. The highlights:\n\n`
                    + "- **Comfortable shoes** come first: the itinerary has you walking from "
                    + "9:00 every day.\n"
                    + "- **Cover shoulders and knees** on day 2, or St. Peter's Basilica turns "
                    + "you away.\n"
                    + "- The **camera charger** and the **travel adapter** are still unchecked "
                    + `in [[${itinerary?.noteId}]]; Italy uses type F and L plugs.\n`
                    + "- Breakfast is included at the hotel, so keep the €1.50 bus tickets and "
                    + "some cash for lunches.")
            ],
            createdAt: "2026-05-04T18:02:43.000Z",
            usage: { promptTokens: 18342, completionTokens: 1204, totalTokens: 19546,
                model: "Claude Sonnet 5.5", provider: "anthropic" }
        } ],
        selectedModel: "claude-sonnet-5-5",
        selectedProvider: "anthropic",
        selectedProviderId: "showcase",
        enableWebSearch: true,
        enableNoteTools: true
    };
    create({ title: "Packing for Rome", type: "llmChat", mime: "application/json",
        content: JSON.stringify(chat) });
}

/** The content of the Markdown note that `WEBSITE_SEED` adds. */
export const GETTING_AROUND = `# Getting around Rome

Most sights in the **centre** are a short walk apart. For the rest:

| Ticket | Valid for | Price |
| --- | --- | --- |
| BIT | 100 minutes | €1.50 |
| Day pass | 24 hours | €7.00 |
| Roma 72h | 72 hours | €18.00 |

## Tips

- Validate the ticket *before* boarding.
- Metro line **A** stops at the Vatican and the Spanish Steps.
- Taxis from the airport have a fixed fare of \`€55\`.

> Walking is still the best way to find the small piazzas.
`;

/** The budget spreadsheet that `WEBSITE_SEED` adds, as the note's content. */
export function buildBudgetWorkbook() {
    const rows: [ string, number, number, number ][] = [
        [ "Flights", 214, 214, 212 ],
        [ "Hotel", 161, 161, 160 ],
        [ "Car rental", 104, 103, 103.5 ],
        [ "Museums", 18, 18, 18 ],
        [ "Food", 96.4, 88, 102.5 ],
        [ "Transport", 18, 18, 25 ]
    ];
    const header = [ "Expense", "Ana", "Ben", "Eve", "Total" ];
    const cellData: Record<number, Record<number, object>> = {};
    cellData[0] = Object.fromEntries(header.map((title, column) => {
        return [ column, { v: title, t: 1, s: "header" } ];
    }));
    for (const [ index, [ expense, ...amounts ] ] of rows.entries()) {
        const row = index + 1;
        cellData[row] = {
            0: { v: expense, t: 1 },
            ...Object.fromEntries(amounts.map((amount, column) => {
                return [ column + 1, { v: amount, t: 2, s: "money" } ];
            })),
            4: { f: `=SUM(B${row + 1}:D${row + 1})`, v: sum(amounts), t: 2, s: "money" }
        };
    }
    const totalRow = rows.length + 1;
    cellData[totalRow] = { 0: { v: "Total", t: 1, s: "total" } };
    for (const [ column, letter ] of [ "B", "C", "D", "E" ].entries()) {
        const total = column < 3
            ? sum(rows.map(([ , ...amounts ]) => amounts[column]))
            : sum(rows.map(([ , ...amounts ]) => sum(amounts)));
        cellData[totalRow][column + 1] = {
            f: `=SUM(${letter}2:${letter}${totalRow})`, v: total, t: 2, s: "totalMoney"
        };
    }
    const money = { n: { pattern: "€#,##0.00" } };
    const workbook = {
        sheetOrder: [ "budget" ],
        name: "Trip budget",
        styles: {
            header: { bl: 1, bg: { rgb: "#dbeafe" } },
            money,
            total: { bl: 1, bd: { t: { s: 1, cl: { rgb: "#000000" } } } },
            totalMoney: { ...money, bl: 1, bd: { t: { s: 1, cl: { rgb: "#000000" } } } }
        },
        sheets: {
            budget: {
                id: "budget",
                name: "Budget",
                rowCount: 100,
                columnCount: 20,
                cellData,
                columnData: {
                    0: { w: 140 }, 1: { w: 100 }, 2: { w: 100 }, 3: { w: 100 }, 4: { w: 110 }
                }
            }
        }
    };
    return JSON.stringify({ version: 1, workbook });
}

/** Univer shows the value stored with a formula until it recalculates, so the seed stores it. */
function sum(values: number[]) {
    return Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;
}

/** The page printed to the PDF of the file note that `WEBSITE_SEED` adds. */
export const BOOKING_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
    body { font-family: sans-serif; color: #1f2937; margin: 48px; }
    h1 { color: #b45309; margin-bottom: 4px; }
    .muted { color: #6b7280; }
    table { border-collapse: collapse; width: 100%; margin-top: 24px; }
    td, th { text-align: left; padding: 10px; border-bottom: 1px solid #e5e7eb; }
    .total td { font-weight: bold; border-top: 2px solid #1f2937; }
</style></head><body>
    <h1>Hotel Colosseo</h1>
    <div class="muted">Via Labicana 125, 00184 Rome, Italy</div>
    <h2>Booking confirmation</h2>
    <p>Booking reference <strong>RM-48213</strong>, for Ana, Ben and Eve.</p>
    <table>
        <tr><th>Check-in</th><td>Tuesday, May 12, 2026, from 14:00</td></tr>
        <tr><th>Check-out</th><td>Friday, May 15, 2026, until 11:00</td></tr>
        <tr><th>Room</th><td>Triple room with a view of the Colosseum</td></tr>
        <tr><th>Breakfast</th><td>Included</td></tr>
        <tr><th>Nights</th><td>3 × €160.67</td></tr>
        <tr class="total"><th>Total</th><td>€482.00, paid</td></tr>
    </table>
    <p class="muted">Free cancellation until May 5, 2026.</p>
</body></html>`;

/** The packing list that the seeded AI chat writes, as the Markdown it sends to `create_note`. */
export const PACKING_MARKDOWN = `## Packing for Rome, May 12 to 15

### Clothes
- Comfortable walking shoes, already broken in
- Light layers: May evenings get down to 15 °C
- Something that covers shoulders and knees, for St. Peter's Basilica

### Documents
- Passports
- Hotel booking (reference RM-48213)
- Tickets for the Colosseum and the Vatican Museums

### Electronics
- Camera and its charger
- Travel adapter for type F and L plugs
- Power bank

### Day bag
- Refillable water bottle, for the *nasoni* fountains
- Small umbrella
- Cash for bus tickets and lunches
`;

/** The packing list of `PACKING_MARKDOWN`, as the HTML the text note stores. */
export const PACKING_HTML = PACKING_MARKDOWN
    .split(/\n(?=###? )/)
    .map((section) => {
        const [ heading, ...lines ] = section.trim().split("\n");
        const level = heading.startsWith("### ") ? 3 : 2;
        const items = lines.filter((line) => line.startsWith("- "))
            .map((line) => `<li>${line.slice(2).replace(/\*(.+?)\*/g, "<i>$1</i>")}</li>`)
            .join("");
        return `<h${level}>${heading.replace(/^#+ /, "")}</h${level}>`
            + (items ? `<ul>${items}</ul>` : "");
    })
    .join("");

/**
 * The presentation `WEBSITE_SEED` adds beside the trip, trimmed from a talk on Trilium: a cover,
 * two sections with their slides, and a closing slide. `glow` is the website hero's brand glows,
 * the background of the cover and the section slides.
 */
export const TALK: TalkDeck = {
    glow: [
        "radial-gradient(40vmax 40vmax at 15% 25%,rgba(228,123,25,.25),transparent 70%)",
        "radial-gradient(35vmax 35vmax at 75% 20%,rgba(79,165,43,.22),transparent 70%)",
        "radial-gradient(28vmax 28vmax at 60% 75%,rgba(227,63,59,.22),transparent 70%)",
        "radial-gradient(20vmax 20vmax at 85% 65%,rgba(228,123,25,.18),transparent 70%)",
        "radial-gradient(15vmax 15vmax at 40% 50%,rgba(79,165,43,.15),transparent 70%)"
    ].join(","),
    slides: [
        {
            title: "Cover slide",
            glow: true,
            content: "<h2><span class=\"text-tiny\">Building your personal knowledge base with"
                + "</span></h2><h2><span class=\"text-big\" style=\"color:hsl(29, 80%, 50%);\">"
                + "Trilium Notes</span></h2><p><span class=\"text-tiny\" "
                + "style=\"color:hsl(0, 0%, 30%);\">A journey from note-taking to open-source "
                + "stewardship</span></p>"
        },
        {
            title: "I. Introduction",
            glow: true,
            content: "<h2><span class=\"text-tiny\">Part I</span><br>Introduction</h2>",
            slides: [
                [ "What is Trilium", "<h3>What is Trilium Notes?</h3><figure class=\"table\" "
                    + "style=\"width:100%;\"><table><thead><tr><th>🌲 Hierarchical knowledge "
                    + "base</th>"
                    + "<th>✨️ Rich editor &amp; visuals</th></tr></thead><tbody><tr><td><ul>"
                    + "<li><span class=\"text-tiny\">Unlimited tree depth with note cloning</span>"
                    + "</li><li><span class=\"text-tiny\">Full‑text &amp; fuzzy search, relation "
                    + "&amp; link maps</span></li></ul></td><td><ul><li><span class=\"text-tiny\">"
                    + "WYSIWYG editing with tables, images, math formulas, code blocks with syntax "
                    + "highlight, admonitions, etc.</span></li><li><span class=\"text-tiny\">"
                    + "Drawing "
                    + "canvas (powered by Excalidraw), Mindmaps, Mermaid diagrams, Note Maps, "
                    + "Relation Maps</span></li></ul></td></tr></tbody></table></figure>" ],
                [ "Key strengths", "<h2>🔑 Key strengths</h2><ul><li><span class=\"text-small\">"
                    + "No vendor lock-in: notes are fully exportable to Markdown or HTML.</span>"
                    + "</li>"
                    + "<li><span class=\"text-small\">Self-host your own Trilium server on a VPS, "
                    + "Raspberry Pi, or NAS, or even run it on your laptop.</span></li><li><span "
                    + "class=\"text-small\">Or simply use the desktop application (Windows, Linux, "
                    + "macOS).</span></li><li><span class=\"text-small\">Fully hackable: create "
                    + "your "
                    + "own UI themes, add features to the editors, or write custom widgets.</span>"
                    + "</li></ul>" ]
            ]
        },
        {
            title: "II. Life as a maintainer",
            glow: true,
            content: "<h2><span class=\"text-tiny\">Part II</span><br>Life as a maintainer</h2>",
            slides: [
                [ "Quick history", [
                    "timeline",
                    "    title Quick history of the fork",
                    "    Christmas 2017: First release",
                    "    January 2024: Enters maintenance mode (no features, bugfixing only)",
                    "                : Forked into TriliumNext as a community",
                    "    July 2024: First release by the fork",
                    "    June 2025: Merged back into the original repo"
                ].join("\n"), "mermaid" ],
                [ "Improvements", "<h2>🚀 Improvements from the original app</h2><ul><li>🔄 "
                    + "Converted the entire source code to TypeScript.</li><li>⚙️ Added proper CI "
                    + "mechanisms for building, testing, releasing, translation platforms.</li><li>"
                    + "⬆️ Modernized the tech stack (converted to ES modules, monorepo).</li>"
                    + "</ul>" ]
            ]
        },
        {
            title: "Ending",
            glow: true,
            content: "<p><span class=\"text-huge\">🍒 And the cherry on the top…</span></p>",
            slides: [
                [ "Meta", "<p><span class=\"text-big\">This presentation was created and is being "
                    + "displayed entirely within the Trilium app!</span></p>" ]
            ]
        }
    ]
};
