/**
 * LLM tools for attribute operations (get, set, delete labels/relations).
 */

import { z } from "zod";

import becca from "../../../becca/becca.js";
import attributeService from "../../attributes.js";
import { flag } from "./helpers.js";
import { defineTools } from "./tool_registry.js";

export const attributeTools = defineTools({
    get_attributes: {
        description: "Get all attributes (labels and relations) of a note. Labels store text values; relations link to other notes by ID.",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the note")
        }),
        execute: ({ noteId }) => {
            const note = becca.getNote(noteId);
            if (!note) {
                return { error: "Note not found" };
            }

            return note.getOwnedAttributes()
                .filter((attr) => !attr.isAutoLink())
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
            if (!attribute) {
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
        description: "Add or update an attribute on a note. If an attribute with the same type and name exists, it is updated; otherwise a new one is created. Use type 'label' for text values, 'relation' for linking to another note (value must be a noteId).",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the note"),
            type: z.enum(["label", "relation"]).describe("The attribute type"),
            name: z.string().describe("The attribute name"),
            value: z.string().optional().describe("The attribute value (for relations, this must be a target noteId)")
        }),
        mutates: true,
        execute: ({ noteId, type, name, value = "" }) => {
            const note = becca.getNote(noteId);
            if (!note) {
                return { error: "Note not found" };
            }
            if (note.isProtected) {
                return { error: "Note is protected and cannot be modified" };
            }
            if (attributeService.isAttributeDangerous(type, name)) {
                return { error: `Attribute '${name}' is potentially dangerous and cannot be set by the LLM` };
            }
            if (type === "relation" && value && !becca.getNote(value)) {
                return { error: "Target note not found for relation" };
            }

            note.setAttribute(type, name, value);

            return {
                success: true,
                noteId: note.noteId,
                type,
                name,
                value
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
            if (!attribute) {
                return { error: "Attribute not found" };
            }
            if (attribute.noteId !== noteId) {
                return { error: "Attribute does not belong to the specified note" };
            }

            const note = becca.getNote(noteId);
            if (note?.isProtected) {
                return { error: "Note is protected and cannot be modified" };
            }

            attribute.markAsDeleted();

            return {
                success: true,
                attributeId
            };
        }
    }
});
