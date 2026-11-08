import { beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import scriptService from "../services/script.js";
import { buildNote } from "../test/becca_easy_mocking.js";
import { buildShareNote } from "../test/shaca_mocking.js";
import {
    buildFrocaPayload, buildFrocaRows, buildVisibleRelationMap, buildVisibleScriptBundle,
    type FrocaRows
} from "./froca_payload.js";
import shaca from "./shaca/shaca.js";

describe("hosted view data", () => {
    beforeEach(() => {
        becca.reset();
        shaca.reset();
    });

    it("builds no script bundle for a backend script or one that cannot be read", () => {
        const bundle = vi.spyOn(scriptService, "getScriptBundleForFrontend");
        const backend = buildNote({ type: "code", mime: "application/javascript;env=backend" });
        const frontend = buildNote({ type: "code", mime: "application/javascript;env=frontend" });

        expect(buildVisibleScriptBundle(backend, () => true)).toBeUndefined();
        expect(bundle).not.toHaveBeenCalled();
        bundle.mockImplementationOnce(() => {
            throw new Error("Protected module");
        });
        expect(buildVisibleScriptBundle(frontend, () => true)).toBeUndefined();
        bundle.mockReturnValueOnce(undefined);
        expect(buildVisibleScriptBundle(frontend, () => true)).toBeUndefined();
        bundle.mockReturnValueOnce({ script: "run()", html: "" } as never);
        expect(buildVisibleScriptBundle(frontend, () => false)).toMatchObject({ script: "run()" });
        bundle.mockRestore();
    });

    it("reads a built-in template from becca, which lacks shaca, and lists it only once", () => {
        buildNote({ "id": "_template_calendar", "title": "Calendar", "#viewType": "calendar" });
        const shared = buildShareNote({ "id": "sharedNote", "~template": "_template_calendar" });
        const noteIds = (rows: FrocaRows) => rows.notes.map((row) => row.noteId);

        const rows = buildFrocaPayload(shared);
        expect(noteIds(rows)).toEqual([ "_template_calendar", "sharedNote" ]);
        expect(rows.attributes.map((row) => [ row.noteId, row.name ])).toEqual([
            [ "_template_calendar", "viewType" ],
            [ "sharedNote", "template" ]
        ]);
        expect(rows.links).not.toHaveProperty("_template_calendar");

        const exported = buildNote({ "id": "exportedCalendar", "~template": "_template_calendar" });
        expect(noteIds(buildFrocaRows([ exported ], () => true, (note) => note.noteId)))
            .toEqual([ "exportedCalendar", "_template_calendar" ]);
    });

    it("places no note on a relation map whose content is not its JSON", () => {
        const map = buildNote({ type: "relationMap" });

        expect(buildVisibleRelationMap(map.noteId, "{", () => true).noteTitles).toEqual({});
        expect(buildVisibleRelationMap(map.noteId, new Uint8Array(), () => true).noteTitles)
            .toEqual({});
        expect(buildVisibleRelationMap(map.noteId, "{}", () => true).noteTitles).toEqual({});
    });
});
