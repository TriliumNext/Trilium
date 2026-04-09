/**
 * LLM tools for navigating the note hierarchy (tree structure, branches).
 */

import { z } from "zod";

import becca from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import { defineTools } from "./tool_registry.js";

//#region Subtree tool implementation
const MAX_DEPTH = 5;
const MAX_CHILDREN_PER_LEVEL = 10;

interface SubtreeNode {
    noteId: string;
    title: string;
    type: string;
    children?: SubtreeNode[] | string;
}

function buildSubtree(note: BNote, depth: number, maxDepth: number): SubtreeNode {
    const node: SubtreeNode = {
        noteId: note.noteId,
        title: note.getTitleOrProtected(),
        type: note.type
    };

    if (depth >= maxDepth) {
        const childCount = note.getChildNotes().length;
        if (childCount > 0) {
            node.children = `${childCount} children not shown (depth limit reached)`;
        }
        return node;
    }

    const children = note.getChildNotes();
    if (children.length === 0) {
        return node;
    }

    const shown = children.slice(0, MAX_CHILDREN_PER_LEVEL);
    node.children = shown.map((child) => buildSubtree(child, depth + 1, maxDepth));

    if (children.length > MAX_CHILDREN_PER_LEVEL) {
        node.children.push({
            noteId: "",
            title: `... and ${children.length - MAX_CHILDREN_PER_LEVEL} more`,
            type: "truncated"
        });
    }

    return node;
}
//#endregion

export const hierarchyTools = defineTools({
    get_child_notes: {
        description: "Get the immediate child notes of a note. Returns each child's ID, title, type, and whether it has children of its own. Use noteId 'root' to list top-level notes.",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the parent note (use 'root' for top-level)")
        }),
        execute: ({ noteId }) => {
            const note = becca.getNote(noteId);
            if (!note) {
                return { error: "Note not found" };
            }

            return note.getChildNotes().map((child) => ({
                noteId: child.noteId,
                title: child.getTitleOrProtected(),
                type: child.type,
                childCount: child.getChildNotes().length
            }));
        }
    },

    get_subtree: {
        description: "Get a nested subtree of notes starting from a given note, traversing multiple levels deep. Useful for understanding the structure of a section of the note tree. Each level shows up to 10 children.",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the root note for the subtree (use 'root' for the entire tree)"),
            depth: z.number().min(1).max(MAX_DEPTH).optional().describe(`How many levels deep to traverse (1-${MAX_DEPTH}). Defaults to 2.`)
        }),
        execute: ({ noteId, depth = 2 }) => {
            const note = becca.getNote(noteId);
            if (!note) {
                return { error: "Note not found" };
            }

            return buildSubtree(note, 0, depth);
        }
    }
});
