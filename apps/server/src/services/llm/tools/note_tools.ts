/**
 * LLM tools for note operations (search, read, create, update, append).
 */

import { z } from "zod";

import becca from "../../../becca/becca.js";
import markdownImport from "../../import/markdown.js";
import noteService from "../../notes.js";
import SearchContext from "../../search/search_context.js";
import searchService from "../../search/services/search.js";
import TaskContext from "../../task_context.js";
import { PROTECTED_SYSTEM_NOTES, TOOL_LIMITS, getContentPreview, getNoteContentForLlm, getNoteMeta, setNoteContentFromLlm } from "./helpers.js";
import { defineTools } from "./tool_registry.js";

export const noteTools = defineTools({
    search_notes: {
        description: [
            "Search for notes in the user's knowledge base using Trilium search syntax.",
            "For complex queries (boolean logic, relations, regex, ordering), load the 'search_syntax' skill first via load_skill.",
            "Common patterns:",
            "- Full-text: 'rings tolkien' (notes containing both words)",
            "- By label: '#book', '#status = done', '#year >= 2000'",
            "- By type: 'note.type = code'",
            "- By relation: '~author', '~author.title *= Tolkien'",
            "- Combined: 'tolkien #book' (full-text + label filter)",
            "- Negation: '#!archived' (notes WITHOUT label)"
        ].join(" "),
        inputSchema: z.object({
            query: z.string().describe("Search query in Trilium search syntax"),
            fastSearch: z.boolean().optional().describe("If true, skip content search (only titles and attributes). Faster for large databases."),
            includeArchivedNotes: z.boolean().optional().describe("If true, include archived notes in results."),
            ancestorNoteId: z.string().optional().describe("Limit search to a subtree rooted at this note ID."),
            limit: z.number().optional().describe("Maximum number of results to return. Defaults to 10.")
        }),
        execute: ({ query, fastSearch, includeArchivedNotes, ancestorNoteId, limit = 10 }) => {
            const searchContext = new SearchContext({
                fastSearch,
                includeArchivedNotes,
                ancestorNoteId
            });
            const results = searchService.findResultsWithQuery(query, searchContext);

            const notes = results.slice(0, limit).map(sr => {
                const note = becca.notes[sr.noteId];
                if (!note) return null;
                const parentNote = note.getParentNotes()[0];
                return {
                    noteId: note.noteId,
                    title: note.getTitleOrProtected(),
                    type: note.type,
                    parentTitle: parentNote?.getTitleOrProtected() ?? null,
                    contentPreview: getContentPreview(note)
                };
            }).filter(Boolean);

            return {
                totalResults: results.length,
                results: notes
            };
        }
    },

    get_note: {
        description: "Get a note's metadata by its ID. Returns title, type, mime, dates, parent/child relationships, attributes, and a short content preview. Use get_note_content for the full content.",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the note to retrieve")
        }),
        execute: ({ noteId }) => {
            const note = becca.getNote(noteId);
            if (!note) {
                return { error: "Note not found" };
            }

            return getNoteMeta(note, TOOL_LIMITS);
        }
    },

    get_note_content: {
        description: "Read the full content of a note by its ID. Use search_notes first to find relevant note IDs. Text notes are returned as Markdown.",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the note to read")
        }),
        execute: ({ noteId }) => {
            const note = becca.getNote(noteId);
            if (!note) {
                return { error: "Note not found" };
            }
            if (!note.isContentAvailable()) {
                return { error: "Note is protected" };
            }

            return {
                noteId: note.noteId,
                content: getNoteContentForLlm(note)
            };
        }
    },

    update_note_content: {
        description: "Replace the entire content of a note. Use this to completely rewrite a note's content. For text notes, provide Markdown content.",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the note to update"),
            content: z.string().describe("The new content for the note (Markdown for text notes, plain text for code notes)")
        }),
        mutates: true,
        execute: ({ noteId, content }) => {
            const note = becca.getNote(noteId);
            if (!note) {
                return { error: "Note not found" };
            }
            if (!note.isContentAvailable()) {
                return { error: "Note is protected and cannot be modified" };
            }
            if (!note.hasStringContent()) {
                return { error: `Cannot update content for note type: ${note.type}` };
            }

            note.saveRevision({ source: "llm" });
            setNoteContentFromLlm(note, content);
            return {
                success: true,
                noteId: note.noteId,
                title: note.getTitleOrProtected()
            };
        }
    },

    append_to_note: {
        description: "Append content to the end of an existing note. For text notes, provide Markdown content.",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the note to append to"),
            content: z.string().describe("The content to append (Markdown for text notes, plain text for code notes)")
        }),
        mutates: true,
        execute: ({ noteId, content }) => {
            const note = becca.getNote(noteId);
            if (!note) {
                return { error: "Note not found" };
            }
            if (!note.isContentAvailable()) {
                return { error: "Note is protected and cannot be modified" };
            }
            if (!note.hasStringContent()) {
                return { error: `Cannot update content for note type: ${note.type}` };
            }

            const existingContent = note.getContent();
            if (typeof existingContent !== "string") {
                return { error: "Note has binary content" };
            }

            let newContent: string;
            if (note.type === "text") {
                const htmlToAppend = markdownImport.renderToHtml(content, note.getTitleOrProtected());
                newContent = existingContent + htmlToAppend;
            } else {
                newContent = existingContent + (existingContent.endsWith("\n") ? "" : "\n") + content;
            }

            note.saveRevision({ source: "llm" });
            note.setContent(newContent);
            return {
                success: true,
                noteId: note.noteId,
                title: note.getTitleOrProtected()
            };
        }
    },

    create_note: {
        description: [
            "Create a new note in the user's knowledge base. Returns the created note's ID and title.",
            "Note types:",
            "- 'text': rich text (provide content in Markdown)",
            "- 'code': source code (must also set mime)",
            "- 'render': displays output of a child code note (content is empty, add a code note as child and set ~renderNote relation)",
            "- 'book': container that displays children as a book/list",
            "- 'mermaid': Mermaid diagram source",
            "- 'canvas': Excalidraw drawing (JSON content)",
            "- 'webView': embedded web page (set content to URL or HTML)",
            "- 'relationMap': visual map of note relations (JSON content)",
            "- 'search': saved search (content is the search query)",
            "- 'mindMap': mind map (JSON content)",
            "Common mime values for code notes:",
            "'application/javascript;env=frontend' (JS frontend),",
            "'application/javascript;env=backend' (JS backend),",
            "'text/jsx' (Preact JSX, preferred for frontend widgets),",
            "'text/css', 'text/html', 'application/json', 'text/x-python', 'text/x-sh'."
        ].join(" "),
        inputSchema: z.object({
            parentNoteId: z.string().describe("The ID of the parent note. Use 'root' for top-level notes."),
            title: z.string().describe("The title of the new note"),
            content: z.string().describe("The content of the note (Markdown for text notes, plain text for code notes, empty string for render notes)"),
            type: z.enum(["text", "code", "render", "book", "mermaid", "canvas", "webView", "relationMap", "search", "mindMap"]).describe("The type of note to create."),
            mime: z.string().optional().describe("MIME type, REQUIRED for code notes (e.g. 'application/javascript;env=backend', 'text/jsx'). Ignored for other types.")
        }),
        mutates: true,
        execute: ({ parentNoteId, title, content, type, mime }) => {
            if (type === "code" && !mime) {
                return { error: "mime is required when creating code notes" };
            }

            const parentNote = becca.getNote(parentNoteId);
            if (!parentNote) {
                return { error: "Parent note not found" };
            }
            if (!parentNote.isContentAvailable()) {
                return { error: "Cannot create note under a protected parent" };
            }

            const htmlContent = type === "text"
                ? markdownImport.renderToHtml(content, title)
                : content;

            try {
                const { note } = noteService.createNewNote({
                    parentNoteId,
                    title,
                    content: htmlContent,
                    type,
                    ...(mime ? { mime } : {})
                });

                return {
                    success: true,
                    noteId: note.noteId,
                    title: note.getTitleOrProtected(),
                    type: note.type
                };
            } catch (err) {
                return { error: err instanceof Error ? err.message : "Failed to create note" };
            }
        }
    },

    rename_note: {
        description: "Change the title of an existing note.",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the note to rename"),
            newTitle: z.string().describe("The new title for the note")
        }),
        mutates: true,
        execute: ({ noteId, newTitle }) => {
            const note = becca.getNote(noteId);
            if (!note) {
                return { error: "Note not found" };
            }
            if (note.isProtected) {
                return { error: "Note is protected and cannot be renamed" };
            }

            const trimmedTitle = newTitle.trim();
            if (!trimmedTitle) {
                return { error: "Title cannot be empty" };
            }

            note.title = trimmedTitle;
            note.save();

            return {
                success: true,
                noteId: note.noteId,
                title: note.getTitleOrProtected()
            };
        }
    },

    delete_note: {
        description: "Delete a note and all its branches (parent links). This is a soft delete (recoverable via 'Recent Changes'). Cannot delete system notes (root, _hidden, etc.).",
        inputSchema: z.object({
            noteId: z.string().describe("The ID of the note to delete")
        }),
        mutates: true,
        execute: ({ noteId }) => {
            if (PROTECTED_SYSTEM_NOTES.has(noteId)) {
                return { error: "Cannot delete system notes" };
            }

            const note = becca.getNote(noteId);
            if (!note) {
                return { error: "Note not found" };
            }
            if (note.isProtected) {
                return { error: "Note is protected and cannot be deleted" };
            }

            const title = note.getTitleOrProtected();
            const taskContext = new TaskContext("no-progress-reporting", "deleteNotes", null);
            note.deleteNote(null, taskContext);

            return {
                success: true,
                noteId,
                deletedTitle: title
            };
        }
    }
});
