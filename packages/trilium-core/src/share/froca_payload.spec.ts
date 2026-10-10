import { beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import scriptService from "../services/script.js";
import { buildNote } from "../test/becca_easy_mocking.js";
import { buildVisibleRelationMap, buildVisibleScriptBundle } from "./froca_payload.js";

describe("hosted view data", () => {
    beforeEach(() => {
        becca.reset();
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

    it("places no note on a relation map whose content is not its JSON", () => {
        const map = buildNote({ type: "relationMap" });

        expect(buildVisibleRelationMap(map.noteId, "{", () => true).noteTitles).toEqual({});
        expect(buildVisibleRelationMap(map.noteId, new Uint8Array(), () => true).noteTitles)
            .toEqual({});
        expect(buildVisibleRelationMap(map.noteId, "{}", () => true).noteTitles).toEqual({});
    });
});
