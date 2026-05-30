import { beforeEach, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import { buildNote } from "../test/becca_easy_mocking.js";
import BackendScriptApi from "./backend_script_api.js";
import ScriptContext from "./script_context.js";

describe("ScriptContext", () => {
    beforeEach(() => {
        becca.reset();
    });

    it("maps every note into the notes and apis objects keyed by noteId", () => {
        const noteA = buildNote({ title: "A" });
        const noteB = buildNote({ title: "B" });

        const ctx = new ScriptContext([noteA, noteB], { startNote: noteA });

        expect((ctx.notes as Record<string, unknown>)[noteA.noteId]).toBe(noteA);
        expect((ctx.notes as Record<string, unknown>)[noteB.noteId]).toBe(noteB);

        const apis = ctx.apis as Record<string, unknown>;
        expect(apis[noteA.noteId]).toBeInstanceOf(BackendScriptApi);
        expect(apis[noteB.noteId]).toBeInstanceOf(BackendScriptApi);
        expect(apis[noteA.noteId]).not.toBe(apis[noteB.noteId]);

        expect(ctx.allNotes).toEqual([noteA, noteB]);
        expect(ctx.modules).toEqual({});
    });

    it("starts with empty maps when there are no notes", () => {
        const ctx = new ScriptContext([], {});

        expect(ctx.notes).toEqual({});
        expect(ctx.apis).toEqual({});
        expect(ctx.allNotes).toEqual([]);
    });

    it("require() resolves a registered module by matching note title", () => {
        const moduleNote = buildNote({ title: "myModule" });
        const ctx = new ScriptContext([moduleNote], { startNote: moduleNote });

        const exportsValue = { greet: () => "hi" };
        ctx.modules[moduleNote.noteId] = { exports: exportsValue as any };

        const resolved = ctx.require([moduleNote.noteId])("myModule");
        expect(resolved).toBe(exportsValue);
    });

    it("require() only considers note ids passed in moduleNoteIds", () => {
        const included = buildNote({ title: "shared" });
        const excluded = buildNote({ title: "shared" });
        // `excluded` is placed first in allNotes so that, if the whitelist
        // filter were dropped, find() would match it first. Only `included`
        // is whitelisted, so its exports must still be returned.
        const ctx = new ScriptContext([excluded, included], { startNote: included });

        ctx.modules[included.noteId] = { exports: ["included-exports"] };
        ctx.modules[excluded.noteId] = { exports: ["excluded-exports"] };

        const resolved = ctx.require([included.noteId])("shared");
        expect(resolved).toEqual(["included-exports"]);
    });

    it("require() falls back to native require when no note title matches", () => {
        const moduleNote = buildNote({ title: "myModule" });
        const ctx = new ScriptContext([moduleNote], { startNote: moduleNote });

        // "path" is not a Trilium module note, so it must resolve via Node's require.
        const path = ctx.require([moduleNote.noteId])("path");
        expect(typeof (path as { join?: unknown }).join).toBe("function");
    });

    it("require() throws when falling back to a non-existent native module", () => {
        const moduleNote = buildNote({ title: "myModule" });
        const ctx = new ScriptContext([moduleNote], { startNote: moduleNote });

        expect(() => ctx.require([moduleNote.noteId])("this-module-does-not-exist-xyz"))
            .toThrow();
    });
});
