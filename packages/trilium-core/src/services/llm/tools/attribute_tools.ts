/**
 * LLM tools for attribute operations (get, set, delete labels/relations).
 */

import attributeService from "../../../services/attributes.js";
import becca from "../../../becca/becca.js";
import { z } from "zod";

import { flag, getLlmNote, isAttributeVisibleToLlm } from "./helpers.js";
import { defineTools } from "./tool_registry.js";

export const attributeTools = defineTools({
    get_attributes: {
        description: "Get all attributes (labels and relations) of a note. Labels store text values; relations link to other notes by ID.",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the note")
        }),
        execute: ({ noteId }) => {
            const note = getLlmNote(noteId);
            if (!note) {
                return { error: "Note not found" };
            }

            return note.getOwnedAttributes()
                .filter((attr) => !attr.isAutoLink() && isAttributeVisibleToLlm(attr))
                .map((attr) => ({
                    attributeId: attr.attributeId,
                    type: attr.type,
                    name: attr.name,
                    value: attr.value,
                    isInheritable: flag(attr.isInheritable)
                }));
        }
    },

    get_attribute: {
        description: "Get a single attribute by its ID.",
        inputSchema: z.object({
            attributeId: z.string().describe("The ID of the attribute")
        }),
        execute: ({ attributeId }) => {
            const attribute = becca.getAttribute(attributeId);
            if (!attribute || !isAttributeVisibleToLlm(attribute)) {
                return { error: "Attribute not found" };
            }

            return {
                attributeId: attribute.attributeId,
                noteId: attribute.noteId,
                type: attribute.type,
                name: attribute.name,
                value: attribute.value,
                isInheritable: flag(attribute.isInheritable)
            };
        }
    },

    set_attribute: {
        description: "Add or update an attribute on a note. In the default mode 'set', an existing attribute with the same type and name is updated (the reply gives the value it replaced); otherwise a new one is created. Mode 'add' always creates a new attribute, so a note can carry several values of one name (e.g. #tag=MCP and #tag=Blender). To change one of several same-name attributes, pass its attributeId from get_attributes. Use type 'label' for text values, 'relation' for linking to another note (value must be a noteId). Attributes that run code (such as #run, #widget, ~renderNote) are saved with a 'disabled:' prefix (e.g. #disabled:run) and stay inactive until the user enables them; when that happens, tell the user which note to open and how to enable it (the reply says how).",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the note"),
            type: z.enum(["label", "relation"]).describe("The attribute type"),
            name: z.string().describe("The attribute name"),
            value: z.string().optional().describe("The attribute value (for relations, this must be a target noteId)"),
            mode: z.enum(["set", "add"]).optional().describe("'set' (default) updates the existing attribute of this name; 'add' creates another one next to it, for multi-valued labels such as #tag"),
            attributeId: z.string().optional().describe("The ID of the attribute to update (from get_attributes), when several share the name; type and name must match it. Not used with mode 'add'")
        }),
        mutates: true,
        execute: ({ noteId, type, name, value = "", mode = "set", attributeId }) => {
            const note = getLlmNote(noteId);
            if (!note) {
                return { error: "Note not found" };
            }
            if (note.isProtected) {
                return { error: "Note is protected and cannot be modified" };
            }
            if (type === "relation" && value && !getLlmNote(value)) {
                return { error: "Target note not found for relation" };
            }

            const sigil = type === "label" ? "#" : "~";

            const target = attributeId ? becca.getAttribute(attributeId) : null;
            if (attributeId) {
                if (mode === "add") {
                    return { error: "attributeId updates an existing attribute, so it cannot be combined with mode \"add\"" };
                }
                if (!target || !isAttributeVisibleToLlm(target)) {
                    return { error: "Attribute not found" };
                }
                if (target.noteId !== note.noteId) {
                    return { error: "Attribute does not belong to the specified note" };
                }
                if (target.type !== type || target.name !== name.trim()) {
                    return { error: `Attribute is ${target.type === "label" ? "#" : "~"}${target.name}, not ${sigil}${name.trim()}` };
                }
            }

            if (attributeService.isAttributeDangerous(type, name)) {
                const disabledName = `disabled:${name.trim()}`;
                // An active attribute left in place would keep running its old value while the reply says it is inactive.
                const activeAttributes = target ? [ target ]
                    : mode === "set" ? note.getOwnedAttributes(type, name.trim())
                    : [];
                for (const attribute of activeAttributes) {
                    attribute.markAsDeleted();
                }
                if (mode === "add" || target) {
                    note.addAttribute(type, disabledName, value);
                } else {
                    note.setAttribute(type, disabledName, value);
                }

                return {
                    success: true,
                    noteId: note.noteId,
                    type,
                    name: disabledName,
                    value,
                    disabled: true,
                    message: `${sigil}${name.trim()} can run code, so it was saved as ${sigil}${disabledName} and is inactive. `
                        + (target
                            ? `This removed the active ${sigil}${name.trim()}=${target.value} it replaced; other ${sigil}${name.trim()} attributes stay as they were. `
                            : activeAttributes.length
                                ? `This removed the active ${sigil}${name.trim()}, so the note runs none of it until the user enables the new one. `
                                : "")
                        + `Tell the user which note to open and to enable it there once they have reviewed the code: `
                        + `a render note shows an "Enable render note" button, other notes a toggle next to the badge beside the note title.`
                };
            }

            const result = { success: true, noteId: note.noteId, type, name, value };

            if (mode === "add") {
                note.addAttribute(type, name, value);
                return result;
            }

            if (target) {
                const previousValue = target.value;
                if (previousValue === value) {
                    return result;
                }
                target.value = value;
                target.save();
                return { ...result, previousValue };
            }

            const [ existing, ...others ] = note.getOwnedAttributes(type, name);
            const previousValue = existing?.value;
            note.setAttribute(type, name, value);
            if (previousValue === undefined || previousValue === value) {
                return result;
            }

            return {
                ...result,
                previousValue,
                message: `Replaced ${sigil}${name}=${previousValue}. `
                    + (others.length
                        ? `${others.length} other ${sigil}${name} ${others.length === 1 ? "attribute was" : "attributes were"} left unchanged; to change one of them, pass its attributeId. `
                        : "")
                    + `To keep several values of ${sigil}${name}, use mode "add" instead.`
            };
        }
    },

    delete_attribute: {
        description: "Remove an attribute from a note by its attribute ID.",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the note that owns the attribute"),
            attributeId: z.string().describe("The ID of the attribute to delete")
        }),
        mutates: true,
        execute: ({ noteId, attributeId }) => {
            const attribute = becca.getAttribute(attributeId);
            if (!attribute || !isAttributeVisibleToLlm(attribute)) {
                return { error: "Attribute not found" };
            }
            if (attribute.noteId !== noteId) {
                return { error: "Attribute does not belong to the specified note" };
            }

            const note = getLlmNote(noteId);
            if (note?.isProtected) {
                return { error: "Note is protected and cannot be modified" };
            }

            attribute.markAsDeleted();

            return {
                success: true,
                attributeId,
                type: attribute.type,
                name: attribute.name,
                value: attribute.value
            };
        }
    }
});
