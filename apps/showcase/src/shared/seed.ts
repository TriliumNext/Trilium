/** The part of the backend script API that `SEED` calls. */
declare const api: {
    searchForNote(query: string): SeedNote | null;
    createNewNote(params: object): { note: SeedNote };
};

interface SeedNote {
    noteId: string;
    title: string;
    type: string;
    getChildNotes(): SeedNote[];
}

/**
 * Adds what the demo document lacks for the screenshots, as a backend script with the script
 * `api` in scope: the "Packing for Rome" AI chat under the demo's "Trip to Rome" note, which reads
 * the trip and writes its "What to pack" note. The chat stays out of the demo because it names a
 * provider and a model the user has not set up. `packingMarkdown` is `PACKING_MARKDOWN`. It adds
 * nothing when the chat exists, as on a running server given with --url that was seeded before.
 */
export function SEED(packingMarkdown: string) {
    if (api.searchForNote("note.title = 'Packing for Rome'")) return;
    const find = (query: string) => {
        const note = api.searchForNote(query);
        if (!note) throw new Error(`The demo document has no note matching ${query}.`);
        return note;
    };
    const trip = find("note.title = 'Trip to Rome' AND note.parents.title = 'Trilium Demo'");
    const child = (title: string) => {
        const note = trip.getChildNotes().find((candidate) => candidate.title === title);
        if (!note) throw new Error(`The Trip to Rome note has no child named ${title}.`);
        return note;
    };
    const itinerary = child("Rome itinerary");
    const booking = child("Hotel booking.pdf");
    const places = child("Places to visit");
    const packing = child("What to pack");
    const summary = (note: SeedNote) => ({
        noteId: note.noteId, title: note.title, type: note.type,
        childCount: note.getChildNotes().length
    });

    const calls: [ string, object, unknown ][] = [
        [ "get_child_notes", { noteId: trip.noteId }, trip.getChildNotes()
            .filter((note) => note.noteId !== packing.noteId).map(summary) ],
        [ "get_note_content", { noteId: itinerary.noteId }, {
            noteId: itinerary.noteId,
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
        [ "get_child_notes", { noteId: places.noteId }, places.getChildNotes().map(summary) ],
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
                    + `in [[${itinerary.noteId}]]; Italy uses type F and L plugs.\n`
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
    api.createNewNote({ parentNoteId: trip.noteId, title: "Packing for Rome", type: "llmChat",
        mime: "application/json", content: JSON.stringify(chat) });
}

/** The demo's "What to pack" note, as the Markdown the chat sends to `create_note`. */
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
