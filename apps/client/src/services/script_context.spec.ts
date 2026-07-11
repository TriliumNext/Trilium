import { describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import ScriptContext from "./script_context.js";
import server from "./server.js";

describe("ScriptContext", () => {
    it("builds notes/apis maps and resolves modules via require", async () => {
        const startNote = buildNote({ title: "Start" });
        const moduleA = buildNote({ title: "ModuleA" });
        const moduleB = buildNote({ title: "ModuleB" });

        const allNoteIds = [startNote.noteId, moduleA.noteId, moduleB.noteId];
        const ctx = await ScriptContext(startNote.noteId, allNoteIds);

        // modules starts empty, notes/apis are keyed by noteId for every requested note.
        expect(ctx.modules).toEqual({});
        expect(Object.keys(ctx.notes).sort()).toEqual([...allNoteIds].sort());
        expect(Object.keys(ctx.apis).sort()).toEqual([...allNoteIds].sort());
        expect(ctx.notes[moduleA.noteId]).toBe(moduleA);
        // Each api is a FrontendScriptApi instance referencing the right current note.
        expect(ctx.apis[moduleA.noteId].currentNote).toBe(moduleA);
        expect(ctx.apis[moduleA.noteId].startNote).toBe(startNote);

        // require: the returned function resolves a module note by title and returns its exports.
        const exportsA = { value: 42 };
        ctx.modules[moduleA.noteId] = { exports: exportsA };
        const requireFn = ctx.require(`${moduleA.noteId} ${moduleB.noteId}`);
        expect(requireFn("ModuleA")).toBe(exportsA);
    });

    it("require throws when the requested module title is not among the allowed note ids", async () => {
        const startNote = buildNote({ title: "Start2" });
        const moduleA = buildNote({ title: "ModA2" });
        const otherNote = buildNote({ title: "Other2" });

        const ctx = await ScriptContext(startNote.noteId, [startNote.noteId, moduleA.noteId, otherNote.noteId]);

        // moduleNoteIds only allows moduleA, so requesting "Other2" (filtered out) throws.
        const requireFn = ctx.require(moduleA.noteId);
        expect(() => requireFn("Other2")).toThrow(/Could not find module note Other2/);
        // Requesting a title that exists nowhere also throws.
        expect(() => requireFn("Nonexistent")).toThrow(/Could not find module note Nonexistent/);
    });

    it("throws when the start note cannot be found", async () => {
        // Make froca's "tree/load" resolve with an empty subtree so the unknown note id
        // simply stays missing (instead of the setup mock throwing on the POST).
        const originalPost = server.post;
        server.post = vi.fn(async () => ({ notes: [], branches: [], attributes: [] })) as typeof server.post;
        try {
            await expect(ScriptContext("missingStartNoteId", ["missingStartNoteId"])).rejects.toThrow(
                /Could not find start note missingStartNoteId\./
            );
        } finally {
            server.post = originalPost;
        }
    });
});
