import { becca, cls, note_service as noteService } from "@triliumnext/core";
import { beforeAll, describe, expect, it } from "vitest";

import { attributeTools } from "./attribute_tools.js";
import type { ToolDefinition } from "./tool_registry.js";

function getTool(name: string): ToolDefinition {
    for (const [n, def] of attributeTools) {
        if (n === name) return def;
    }
    throw new Error(`Tool ${name} not registered`);
}

/** Create a fresh note under root in the real (seeded) in-memory DB. */
function createNote(title: string) {
    return cls.init(() => noteService.createNewNote({
        parentNoteId: "root",
        title,
        content: "body",
        type: "text"
    }).note);
}

describe("attribute_tools", () => {
    let noteId: string;

    beforeAll(() => {
        const note = createNote("Attr host");
        noteId = note.noteId;
        cls.init(() => {
            note.setLabel("color", "blue");
            note.setRelation("template", "root");
        });
    });

    describe("get_attributes", () => {
        it("lists owned, non-auto-link attributes with their fields", () => {
            const result = getTool("get_attributes").execute({ noteId }) as any[];
            const color = result.find((a) => a.name === "color");
            expect(color).toMatchObject({ type: "label", name: "color", value: "blue" });
            expect(color.attributeId).toBeTruthy();
            // A relation is included too.
            expect(result.some((a) => a.type === "relation" && a.name === "template")).toBe(true);
        });

        it("returns an error when the note is missing", () => {
            expect(getTool("get_attributes").execute({ noteId: "missing" }))
                .toEqual({ error: "Note not found" });
        });
    });

    describe("get_attribute", () => {
        it("returns a single attribute by id, including inheritable flag when set", () => {
            const note = createNote("Inheritable host");
            cls.init(() => note.addLabel("shared", "yes", true));
            const attr = note.getOwnedAttributes()[0];

            expect(getTool("get_attribute").execute({ attributeId: attr.attributeId })).toEqual({
                attributeId: attr.attributeId,
                noteId: note.noteId,
                type: "label",
                name: "shared",
                value: "yes",
                isInheritable: true
            });
        });

        it("returns an error when the attribute is missing", () => {
            expect(getTool("get_attribute").execute({ attributeId: "missing" }))
                .toEqual({ error: "Attribute not found" });
        });
    });

    describe("set_attribute", () => {
        it("creates a label on a note", () => {
            const note = createNote("Set label host");
            const result = cls.init(() => getTool("set_attribute").execute({
                noteId: note.noteId,
                type: "label",
                name: "priority",
                value: "high"
            }));
            expect(result).toEqual({
                success: true,
                noteId: note.noteId,
                type: "label",
                name: "priority",
                value: "high"
            });
            expect(note.getLabelValue("priority")).toBe("high");
        });

        it("defaults the value to an empty string when omitted", () => {
            const note = createNote("Empty value host");
            const result = cls.init(() => getTool("set_attribute").execute({
                noteId: note.noteId,
                type: "label",
                name: "marker"
            })) as { value: string };
            expect(result.value).toBe("");
        });

        it("rejects a missing note, protected note, dangerous attribute, and missing relation target", () => {
            expect(getTool("set_attribute").execute({ noteId: "missing", type: "label", name: "x" }))
                .toEqual({ error: "Note not found" });

            const protectedNote = createNote("Protected set host");
            protectedNote.isProtected = true;
            expect(cls.init(() => getTool("set_attribute").execute({
                noteId: protectedNote.noteId, type: "label", name: "x"
            }))).toMatchObject({ error: expect.stringContaining("protected") });
            protectedNote.isProtected = false;

            const dangerHost = createNote("Danger host");
            expect(cls.init(() => getTool("set_attribute").execute({
                noteId: dangerHost.noteId, type: "label", name: "run"
            }))).toMatchObject({ error: expect.stringContaining("dangerous") });

            const relHost = createNote("Relation host");
            expect(cls.init(() => getTool("set_attribute").execute({
                noteId: relHost.noteId, type: "relation", name: "ref", value: "doesNotExist"
            }))).toEqual({ error: "Target note not found for relation" });
        });

        it("creates a relation to an existing target note", () => {
            const note = createNote("Relation ok host");
            const result = cls.init(() => getTool("set_attribute").execute({
                noteId: note.noteId, type: "relation", name: "ref", value: "root"
            }));
            expect(result).toMatchObject({ success: true, type: "relation", value: "root" });
        });
    });

    describe("delete_attribute", () => {
        it("deletes an attribute owned by the note", () => {
            const note = createNote("Delete host");
            cls.init(() => note.setLabel("temp", "1"));
            const attr = note.getOwnedAttributes().find((a) => a.name === "temp")!;

            const result = cls.init(() => getTool("delete_attribute").execute({
                noteId: note.noteId,
                attributeId: attr.attributeId
            }));
            expect(result).toEqual({ success: true, attributeId: attr.attributeId });
            expect(becca.getAttribute(attr.attributeId)).toBeNull();
        });

        it("rejects a missing attribute, a mismatched owner, and a protected owner", () => {
            expect(getTool("delete_attribute").execute({ noteId: "x", attributeId: "missing" }))
                .toEqual({ error: "Attribute not found" });

            const note = createNote("Mismatch host");
            cls.init(() => note.setLabel("keep", "1"));
            const attr = note.getOwnedAttributes()[0];
            expect(getTool("delete_attribute").execute({
                noteId: "root", attributeId: attr.attributeId
            })).toMatchObject({ error: expect.stringContaining("does not belong") });

            const protectedNote = createNote("Protected del host");
            cls.init(() => protectedNote.setLabel("p", "1"));
            const pAttr = protectedNote.getOwnedAttributes()[0];
            protectedNote.isProtected = true;
            expect(getTool("delete_attribute").execute({
                noteId: protectedNote.noteId, attributeId: pAttr.attributeId
            })).toMatchObject({ error: expect.stringContaining("protected") });
            protectedNote.isProtected = false;
        });
    });
});
