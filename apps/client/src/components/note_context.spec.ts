import { beforeEach, describe, expect, it } from "vitest";

import type { ViewScope } from "../services/link.js";
import { buildNote } from "../test/easy-froca.js";
import appContext from "./app_context.js";
import NoteContext from "./note_context.js";
import type TabManager from "./tab_manager.js";

describe("NoteContext.isCommandTarget", () => {
    it("matches a command with its own ntxId, or one without an ntxId while it is the active context", () => {
        const tabManager = appContext.tabManager;
        appContext.tabManager = { activeNtxId: "tab" } as TabManager;
        try {
            const tab = new NoteContext("tab");
            const popup = new NoteContext("_popup-editor");

            expect(popup.isCommandTarget("_popup-editor")).toBe(true);
            expect(tab.isCommandTarget("_popup-editor")).toBe(false);
            expect(tab.isCommandTarget(undefined)).toBe(true);
            expect(popup.isCommandTarget(undefined)).toBe(false);
        } finally {
            appContext.tabManager = tabManager;
        }
    });
});

describe("NoteContext read-only capability", () => {
    let noteContext: NoteContext;

    beforeEach(() => {
        noteContext = new NoteContext();
    });

    it("reports a collection read-only only where its view honours the label", async () => {
        // A list or a grid wearing #readOnly is still editable, so reporting it would put a
        // read-only badge over a collection that can be changed.
        const viewTypes = [
            [ "board", true ], [ "calendar", true ], [ "dashboard", true ], [ "geoMap", true ],
            [ "presentation", true ], [ "table", true ], [ "list", false ], [ "grid", false ]
        ] as const;
        for (const [ viewType, expected ] of viewTypes) {
            const note = buildNote({
                "title": viewType, "type": "book", "#viewType": viewType, "#readOnly": ""
            });
            noteContext.noteId = note.noteId;

            expect(await noteContext.isReadOnly(), viewType).toBe(expected);
        }
    });

    it("reports the note maps and render notes read-only under the label", async () => {
        for (const type of [ "noteMap", "relationMap", "render" ] as const) {
            const note = buildNote({ "title": type, "type": type, "#readOnly": "" });
            noteContext.noteId = note.noteId;

            expect(await noteContext.isReadOnly(), type).toBe(true);
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
