import becca from "../../../becca/becca.js";
import * as cls from "../../../services/context.js";
import noteService from "../../../services/notes.js";
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

        it("appends same-name labels in add mode instead of replacing them", () => {
            const note = createNote("Add mode host");
            for (const value of [ "MCP", "AI", "Blender" ]) {
                const result = cls.init(() => getTool("set_attribute").execute({
                    noteId: note.noteId, type: "label", name: "tag", value, mode: "add"
                }));
                expect(result).toEqual({
                    success: true, noteId: note.noteId, type: "label", name: "tag", value
                });
            }
            expect(note.getOwnedLabels("tag").map((l) => l.value)).toEqual([ "MCP", "AI", "Blender" ]);
        });

        it("reports the value it replaced in set mode", () => {
            const note = createNote("Replace host");
            cls.init(() => note.addLabel("tag", "MCP"));

            const result = cls.init(() => getTool("set_attribute").execute({
                noteId: note.noteId, type: "label", name: "tag", value: "Blender"
            }));
            expect(result).toMatchObject({
                success: true, value: "Blender", previousValue: "MCP",
                message: expect.stringContaining("mode \"add\"")
            });
            expect(note.getOwnedLabels("tag").map((l) => l.value)).toEqual([ "Blender" ]);

            const unchanged = cls.init(() => getTool("set_attribute").execute({
                noteId: note.noteId, type: "label", name: "tag", value: "Blender"
            }));
            expect(unchanged).not.toHaveProperty("previousValue");
            expect(unchanged).not.toHaveProperty("message");
        });

        it("names the same-name labels it left untouched in set mode", () => {
            const note = createNote("Several tags host");
            cls.init(() => {
                note.addLabel("tag", "MCP");
                note.addLabel("tag", "AI");
            });

            const result = cls.init(() => getTool("set_attribute").execute({
                noteId: note.noteId, type: "label", name: "tag", value: "Blender"
            }));
            expect(result).toMatchObject({
                previousValue: "MCP", message: expect.stringContaining("1 other #tag")
            });
            expect(note.getOwnedLabels("tag").map((l) => l.value)).toEqual([ "Blender", "AI" ]);
        });

        it("updates the attribute an attributeId names, keeping its place among same-name ones", () => {
            const note = createNote("By id host");
            const [ , ai ] = cls.init(() => [ note.addLabel("tag", "MCP"), note.addLabel("tag", "AI") ]);

            const result = cls.init(() => getTool("set_attribute").execute({
                noteId: note.noteId, type: "label", name: "tag", value: "Blender", attributeId: ai.attributeId
            }));
            expect(result).toEqual({
                success: true, noteId: note.noteId, type: "label", name: "tag", value: "Blender", previousValue: "AI"
            });
            expect(note.getOwnedLabels("tag").map((l) => [ l.attributeId, l.value ]))
                .toEqual([ [ expect.any(String), "MCP" ], [ ai.attributeId, "Blender" ] ]);
        });

        it("rejects an attributeId that is missing, on another note, of another name, or paired with add mode", () => {
            const note = createNote("By id errors host");
            const other = createNote("By id other host");
            const [ tag, foreign ] = cls.init(() => [ note.addLabel("tag", "MCP"), other.addLabel("tag", "AI") ]);
            const call = (args: object) => cls.init(() => getTool("set_attribute").execute({
                noteId: note.noteId, type: "label", name: "tag", value: "x", ...args
            }));

            expect(call({ attributeId: "missing" })).toEqual({ error: "Attribute not found" });
            expect(call({ attributeId: foreign.attributeId }))
                .toEqual({ error: "Attribute does not belong to the specified note" });
            expect(call({ attributeId: tag.attributeId, name: "status" }))
                .toEqual({ error: "Attribute is #tag, not #status" });
            expect(call({ attributeId: tag.attributeId, mode: "add" }))
                .toEqual({ error: "attributeId updates an existing attribute, so it cannot be combined with mode \"add\"" });
            expect(note.getOwnedLabels("tag").map((l) => l.value)).toEqual([ "MCP" ]);
            expect(note.hasOwnedLabel("status")).toBe(false);
        });

        it("points to attributeId and add mode when set mode replaces one of several values", () => {
            const note = createNote("Hint host");
            cls.init(() => {
                note.addLabel("tag", "MCP");
                note.addLabel("tag", "AI");
            });
            const result = cls.init(() => getTool("set_attribute").execute({
                noteId: note.noteId, type: "label", name: "tag", value: "Blender"
            })) as { message: string };
            expect(result.message).toContain("attributeId");
        });

        it("rejects a missing note, protected note, and missing relation target", () => {
            expect(getTool("set_attribute").execute({ noteId: "missing", type: "label", name: "x" }))
                .toEqual({ error: "Note not found" });

            const protectedNote = createNote("Protected set host");
            protectedNote.isProtected = true;
            expect(cls.init(() => getTool("set_attribute").execute({
                noteId: protectedNote.noteId, type: "label", name: "x"
            }))).toMatchObject({ error: expect.stringContaining("protected") });
            protectedNote.isProtected = false;

            const relHost = createNote("Relation host");
            expect(cls.init(() => getTool("set_attribute").execute({
                noteId: relHost.noteId, type: "relation", name: "ref", value: "doesNotExist"
            }))).toEqual({ error: "Target note not found for relation" });
        });

        it("prefixes a dangerous attribute with disabled: instead of activating it", () => {
            const note = createNote("Danger host");
            const result = cls.init(() => getTool("set_attribute").execute({
                noteId: note.noteId, type: "label", name: " run ", value: "frontendStartup"
            }));
            expect(result).toMatchObject({
                success: true, type: "label", name: "disabled:run", value: "frontendStartup",
                disabled: true, message: expect.stringContaining("#run")
            });
            expect(note.getOwnedLabelValue("disabled:run")).toBe("frontendStartup");
            expect(note.hasOwnedLabel("run")).toBe(false);

            const relation = cls.init(() => getTool("set_attribute").execute({
                noteId: note.noteId, type: "relation", name: "renderNote", value: "root"
            }));
            expect(relation).toMatchObject({
                name: "disabled:renderNote", disabled: true, message: expect.stringContaining("~renderNote")
            });
            expect(note.getOwnedRelationValue("disabled:renderNote")).toBe("root");
            expect(note.getOwnedRelation("renderNote")).toBeNull();
        });

        it("removes an active dangerous attribute it replaces with a disabled one", () => {
            const note = createNote("Active danger host");
            cls.init(() => {
                note.addLabel("run", "frontendStartup");
                note.addLabel("run", "backendStartup");
            });
            expect(note.getOwnedLabels("run")).toHaveLength(2);

            const result = cls.init(() => getTool("set_attribute").execute({
                noteId: note.noteId, type: "label", name: "run", value: "hourly"
            }));
            expect(result).toMatchObject({
                success: true, name: "disabled:run", disabled: true,
                message: expect.stringContaining("removed the active #run")
            });
            expect(note.getOwnedLabels("run")).toHaveLength(0);
            expect(note.getOwnedLabelValue("disabled:run")).toBe("hourly");
        });

        it("disables only the dangerous attribute an attributeId names", () => {
            const note = createNote("Danger by id host");
            const [ , hourly ] = cls.init(() => [ note.addLabel("run", "frontendStartup"), note.addLabel("run", "hourly") ]);

            const result = cls.init(() => getTool("set_attribute").execute({
                noteId: note.noteId, type: "label", name: "run", value: "daily", attributeId: hourly.attributeId
            }));
            expect(result).toMatchObject({
                success: true, name: "disabled:run", value: "daily", disabled: true,
                message: expect.stringContaining("removed the active #run=hourly it replaced")
            });
            expect(becca.getAttribute(hourly.attributeId)).toBeNull();
            expect(note.getOwnedLabels("run").map((l) => l.value)).toEqual([ "frontendStartup" ]);
            expect(note.getOwnedLabels("disabled:run").map((l) => l.value)).toEqual([ "daily" ]);
        });

        it("keeps active and disabled dangerous attributes when adding a disabled one", () => {
            const note = createNote("Add danger host");
            cls.init(() => {
                note.addLabel("run", "frontendStartup");
                note.addLabel("disabled:run", "backendStartup");
            });

            const result = cls.init(() => getTool("set_attribute").execute({
                noteId: note.noteId, type: "label", name: "run", value: "hourly", mode: "add"
            }));
            expect(result).toMatchObject({ success: true, name: "disabled:run", disabled: true });
            expect((result as { message: string }).message).not.toContain("removed");
            expect(note.getOwnedLabels("run").map((l) => l.value)).toEqual([ "frontendStartup" ]);
            expect(note.getOwnedLabels("disabled:run").map((l) => l.value))
                .toEqual([ "backendStartup", "hourly" ]);
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
            expect(result).toEqual({
                success: true, attributeId: attr.attributeId, type: "label", name: "temp", value: "1"
            });
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
