import becca from "../../../becca/becca.js";
import BAttribute from "../../../becca/entities/battribute.js";
import { buildNote } from "../../../test/becca_easy_mocking.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildNoteHint } from "../note_hint.js";
import { attachmentTools } from "./attachment_tools.js";
import { attributeTools } from "./attribute_tools.js";
import { isExcludedFromLlm } from "./helpers.js";
import { hierarchyTools } from "./hierarchy_tools.js";
import { noteTools } from "./note_tools.js";
import type { ToolDefinition } from "./tool_registry.js";

const findResultsMock = vi.hoisted(() => vi.fn());

vi.mock("../../../services/search/services/search.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../services/search/services/search.js")>();
    return { default: { ...actual.default, findResultsWithQuery: findResultsMock } };
});

const NOT_FOUND = { error: "Note not found" };

function run(name: string, args: object) {
    for (const registry of [noteTools, hierarchyTools, attributeTools, attachmentTools]) {
        for (const [toolName, def] of registry) {
            if (toolName === name) return (def as ToolDefinition).execute(args) as any;
        }
    }
    throw new Error(`Tool ${name} not registered`);
}

describe("excludeFromLlm", () => {
    beforeEach(() => {
        becca.reset();
        buildNote({
            id: "root",
            children: [
                {
                    id: "visible", title: "Visible", content: "body", "#topic": "x", "~link": "secret",
                    children: [{
                        id: "secret", title: "Secret", content: "body", "#excludeFromLlm": "",
                        attachments: [{ id: "satt", title: "a.txt", role: "file", mime: "text/plain" }],
                        children: [{ id: "deep", title: "Deep", content: "body" }]
                    }]
                },
                { id: "optedIn", title: "Opted in", content: "body", "#excludeFromLlm": "false" },
                {
                    id: "locked", title: "Locked",
                    children: [
                        { id: "lockedChild", title: "Locked child", content: "body" },
                        { id: "overridden", title: "Overridden", content: "body", "#excludeFromLlm": "false" }
                    ]
                }
            ]
        });
        new BAttribute({ attributeId: "lockedLabel", noteId: "locked", type: "label", name: "excludeFromLlm", value: "", isInheritable: true });
    });

    it("excludes only the labelled note, unless the label is inheritable or false", () => {
        expect(isExcludedFromLlm(becca.getNoteOrThrow("secret"))).toBe(true);
        expect(isExcludedFromLlm(becca.getNoteOrThrow("deep"))).toBe(false);
        expect(isExcludedFromLlm(becca.getNoteOrThrow("visible"))).toBe(false);
        expect(isExcludedFromLlm(becca.getNoteOrThrow("optedIn"))).toBe(false);
        expect(isExcludedFromLlm(becca.getNoteOrThrow("lockedChild"))).toBe(true);
        expect(isExcludedFromLlm(becca.getNoteOrThrow("overridden"))).toBe(false);
    });

    it("reports excluded notes, attributes and attachments as missing", () => {
        for (const noteId of ["secret", "lockedChild"]) {
            expect(run("get_note", { noteId })).toEqual(NOT_FOUND);
            expect(run("get_note_content", { noteId })).toEqual(NOT_FOUND);
            expect(run("set_note_content", { noteId, content: "x" })).toEqual(NOT_FOUND);
            expect(run("append_to_note", { noteId, content: "x" })).toEqual(NOT_FOUND);
            expect(run("edit_note_content", { noteId, edits: [{ oldText: "body", newText: "x" }] })).toEqual(NOT_FOUND);
            expect(run("rename_note", { noteId, newTitle: "x" })).toEqual(NOT_FOUND);
            expect(run("delete_note", { noteId })).toEqual(NOT_FOUND);
            expect(run("get_child_notes", { noteId })).toEqual(NOT_FOUND);
            expect(run("get_subtree", { noteId })).toEqual(NOT_FOUND);
            expect(run("move_note", { noteId, newParentNoteId: "root" })).toEqual(NOT_FOUND);
            expect(run("clone_note", { noteId, parentNoteId: "root" })).toEqual(NOT_FOUND);
            expect(run("get_attributes", { noteId })).toEqual(NOT_FOUND);
            expect(run("set_attribute", { noteId, type: "label", name: "excludeFromLlm", value: "false" })).toEqual(NOT_FOUND);
            expect(buildNoteHint(noteId, false)).toBeNull();
        }

        expect(run("create_note", { parentNoteId: "secret", title: "x", content: "x", type: "text" }))
            .toEqual({ error: "Parent note not found" });
        expect(run("move_note", { noteId: "optedIn", newParentNoteId: "secret" }))
            .toEqual({ error: "Target parent note not found" });
        expect(run("clone_note", { noteId: "optedIn", parentNoteId: "secret" }))
            .toEqual({ error: "Parent note not found" });
        expect(run("set_attribute", { noteId: "optedIn", type: "relation", name: "r", value: "secret" }))
            .toEqual({ error: "Target note not found for relation" });

        const labelId = becca.getNoteOrThrow("secret").getOwnedLabel("excludeFromLlm")?.attributeId;
        expect(labelId).toBeTruthy();
        expect(run("get_attribute", { attributeId: labelId })).toEqual({ error: "Attribute not found" });
        expect(run("delete_attribute", { noteId: "secret", attributeId: labelId })).toEqual({ error: "Attribute not found" });
        expect(run("get_attachment", { attachmentId: "satt" })).toEqual({ error: "Attachment not found" });
        expect(run("get_attachment_content", { attachmentId: "satt" })).toEqual({ error: "Attachment not found" });
    });

    it("leaves excluded notes out of listings, relations and search results", () => {
        expect(run("get_child_notes", { noteId: "visible" })).toEqual([]);
        expect(run("get_subtree", { noteId: "visible" })).not.toHaveProperty("children");

        const meta = run("get_note", { noteId: "visible" });
        expect(meta.childNotes.totalCount).toBe(0);
        expect(meta.attributes.results.map((a: { name: string }) => a.name)).toEqual(["topic"]);
        expect(run("get_attributes", { noteId: "visible" }).map((a: { name: string }) => a.name)).toEqual(["topic"]);
        const linkId = becca.getNoteOrThrow("visible").getOwnedRelation("link")?.attributeId;
        expect(linkId).toBeTruthy();
        expect(run("get_attribute", { attributeId: linkId })).toEqual({ error: "Attribute not found" });

        findResultsMock.mockReturnValue([{ noteId: "secret" }, { noteId: "visible" }, { noteId: "deep" }]);
        const search = run("search_notes", { query: "x" });
        expect(search.totalResults).toBe(2);
        expect(search.results.map((r: { noteId: string }) => r.noteId)).toEqual(["visible", "deep"]);
    });

    it("does not reveal or change the excluded parent of a visible note", () => {
        findResultsMock.mockReturnValue([{ noteId: "deep" }]);
        expect(run("search_notes", { query: "x" }).results[0]).toMatchObject({ noteId: "deep", parentTitle: null });
        expect(run("get_note", { noteId: "deep" }).parentNoteIds).toEqual([]);
        expect(run("move_note", { noteId: "deep", newParentNoteId: "root" }))
            .toEqual({ error: "Note has no parent it can be moved from" });
    });

    it("refuses to delete a note whose subtree holds excluded notes", () => {
        expect(run("delete_note", { noteId: "visible" }))
            .toEqual({ error: "Note contains notes excluded from the assistant and cannot be deleted" });
    });
});
