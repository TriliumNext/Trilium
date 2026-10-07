import { beforeEach, describe, expect, it } from "vitest";

import type { ViewScope } from "../services/link.js";
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

describe("NoteContext view scope", () => {
    it("keeps its own copy of the view scope it is given", async () => {
        buildNote({ id: "root", title: "root", children: [ { id: "blocks", title: "Blocks" } ] });
        const viewScope: ViewScope = { block: "a" };
        const noteContext = new NoteContext();

        await noteContext.setNote("root/blocks", {
            viewScope, skipRecentNotes: true, triggerSwitchEvent: false
        });
        expect(noteContext.viewScope).toEqual({ block: "a", viewMode: "default" });

        // What `revealBlockReference()` does once it has scrolled to the block.
        if (noteContext.viewScope) noteContext.viewScope.block = undefined;
        expect(viewScope).toEqual({ block: "a" });
    });
});
