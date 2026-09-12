import { beforeEach, describe, expect, it } from "vitest";

import { buildNote } from "../test/easy-froca.js";
import NoteContext from "./note_context.js";

describe("NoteContext read-only capability", () => {
    let noteContext: NoteContext;

    beforeEach(() => {
        noteContext = new NoteContext();
    });

    it("reports a collection read-only only where its view honours the label", async () => {
        // The geo map is the one view that reads #readOnly, so it is the one that can report it:
        // a table wearing the same label is still editable, and saying otherwise would put a
        // read-only badge over a collection that can be changed.
        for (const [ viewType, expected ] of [ [ "geoMap", true ], [ "table", false ] ] as const) {
            const note = buildNote({
                "title": viewType, "type": "book", "#viewType": viewType, "#readOnly": ""
            });
            noteContext.noteId = note.noteId;

            expect(await noteContext.isReadOnly()).toBe(expected);
        }
    });

    it("leaves a geo map editable unless locked, or while temporarily unlocked", async () => {
        const unlocked = buildNote({
            "title": "Unlocked map", "type": "book", "#viewType": "geoMap"
        });
        noteContext.noteId = unlocked.noteId;
        expect(await noteContext.isReadOnly()).toBe(false);

        const locked = buildNote({
            "title": "Locked map", "type": "book", "#viewType": "geoMap", "#readOnly": ""
        });
        noteContext.noteId = locked.noteId;
        expect(await noteContext.isReadOnly()).toBe(true);

        // What the read-only badge does when it is clicked: the label stays, the tab stops
        // honouring it.
        if (noteContext.viewScope) noteContext.viewScope.readOnlyTemporarilyDisabled = true;
        expect(await noteContext.isReadOnly()).toBe(false);
    });
});
