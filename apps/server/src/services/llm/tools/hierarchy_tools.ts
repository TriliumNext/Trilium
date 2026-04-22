/**
 * LLM tools for navigating the note hierarchy (tree structure, branches).
 */

import { z } from "zod";

import becca from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import branchService from "../../branches.js";
import cloningService from "../../cloning.js";
import { PROTECTED_SYSTEM_NOTES } from "./helpers.js";
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
    },

    move_note: {
        description: "Move a note to a new parent. The note keeps its content and children but changes its location in the tree. Cannot move system notes.",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the note to move"),
            newParentNoteId: z.string().describe("The ID of the new parent note")
        }),
        mutates: true,
        execute: ({ noteId, newParentNoteId }) => {
            const note = becca.getNote(noteId);
            if (!note) {
                return { error: "Note not found" };
            }
            if (PROTECTED_SYSTEM_NOTES.has(noteId)) {
                return { error: "Cannot move system notes" };
            }
            if (note.isProtected) {
                return { error: "Note is protected and cannot be moved" };
            }

            const targetParent = becca.getNote(newParentNoteId);
            if (!targetParent) {
                return { error: "Target parent note not found" };
            }
            if (!targetParent.isContentAvailable()) {
                return { error: "Cannot move note to a protected parent" };
            }
            if (!targetParent.isContentAvailable()) {
                return { error: "Cannot move note to a protected parent" };
            }

            // Use the first (primary) parent branch for the move
            const branches = note.getParentBranches();
            if (branches.length === 0) {
                return { error: "Note has no parent branches" };
            }

            const result = branchService.moveBranchToNote(branches[0], newParentNoteId);
            if (Array.isArray(result)) {
                // Validation error: [statusCode, { success: false, message }]
                const validation = result[1] as { success: boolean; message?: string };
                return { error: validation.message || "Move validation failed" };
            }
            if (!result.success) {
                return { error: "Failed to move note" };
            }

            return {
                success: true,
                noteId: note.noteId,
                title: note.getTitleOrProtected(),
                newParentNoteId,
                newParentTitle: targetParent.getTitleOrProtected()
            };
        }
    },

    clone_note: {
        description: "Clone a note to an additional parent (Trilium supports multiple parents). The note appears in both locations and stays in sync. Use this to organize notes under multiple categories.",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the note to clone"),
            parentNoteId: z.string().describe("The ID of the new additional parent note"),
            prefix: z.string().optional().describe("Optional branch prefix (displayed before the note title in the tree)")
        }),
        mutates: true,
        execute: ({ noteId, parentNoteId, prefix }) => {
            const note = becca.getNote(noteId);
            if (!note) {
                return { error: "Note not found" };
            }
            if (note.isProtected) {
                return { error: "Note is protected and cannot be cloned" };
            }

            const parent = becca.getNote(parentNoteId);
            if (parent && !parent.isContentAvailable()) {
                return { error: "Cannot clone note to a protected parent" };
            }

            const result = cloningService.cloneNoteToParentNote(noteId, parentNoteId, prefix ?? null);
            if (!result.success) {
                return { error: result.message || "Clone failed" };
            }

            return {
                success: true,
                noteId,
                title: note.getTitleOrProtected(),
                parentNoteId,
                parentTitle: parent?.getTitleOrProtected() ?? parentNoteId,
                branchId: result.branchId
            };
        }
    }
});
