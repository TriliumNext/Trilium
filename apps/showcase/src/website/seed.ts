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
}

/**
 * Adds the notes that the website's screenshots of the other note types and collections show,
 * in a "Trip to Rome" note under the Trilium Demo note, as a backend script with the script `api`
 * in scope: a Markdown note, a budget spreadsheet, a hotel booking PDF, a calendar, a table of
 * places to visit, a presentation and a dashboard of clones of three of the trip's notes. It adds
 * nothing when the note exists, as on a running server given with --url that was seeded before.
 */
export function WEBSITE_SEED({ markdown, workbook, bookingPdf }: WebsiteSeedData) {
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

    create({ title: "Getting around", type: "code", mime: "text/x-markdown", content: markdown })
        .setLabel("iconClass", "bx bxl-markdown");
    const budget = create({ title: "Trip budget", type: "spreadsheet", mime: "application/json",
        content: workbook });
    budget.setLabel("iconClass", "bx bx-spreadsheet");
    create({ title: "Hotel booking.pdf", type: "file", mime: "application/pdf",
        content: Buffer.from(bookingPdf, "base64") })
        .setLabel("originalFileName", "Hotel booking.pdf");

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
    for (const [ title, day, ticket, booked, area ] of sights) {
        const sight = api.createTextNote(places.noteId, title, "").note;
        sight.setLabel("day", String(day));
        sight.setLabel("ticket", String(ticket));
        sight.setLabel("booked", String(booked));
        sight.setLabel("area", area);
    }

    const slides = collection("Rome in three days", "presentation", "bx bx-slideshow");
    const slideContents: [ string, string ][] = [
        [ "Rome in three days",
            "<h1>Rome in three days</h1><p>Ana, Ben and Eve · May 12 to 15</p>" ],
        [ "Day 1", "<h2>Day 1: Ancient Rome</h2><ul><li>The Colosseum at 9:00</li>"
            + "<li>A walk through the Roman Forum</li><li>Sunset on Palatine Hill</li></ul>" ],
        [ "Day 2", "<h2>Day 2: The Vatican</h2><ul><li>Vatican Museums and the Sistine Chapel</li>"
            + "<li>St. Peter's Basilica</li><li>Dinner in Trastevere</li></ul>" ],
        [ "Day 3", "<h2>Day 3: The old town</h2><ul><li>The Pantheon</li>"
            + "<li>A coin in the Trevi Fountain</li><li>The Borghese Gallery</li></ul>" ]
    ];
    for (const [ title, content ] of slideContents) {
        api.createTextNote(slides.noteId, title, content);
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
