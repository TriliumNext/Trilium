/**
 * Knowledge base sources for LLM chat: builds the system-prompt section from
 * the user's selected source notes and resolves the numbered reference list
 * used for citation chunks.
 *
 * Kept separate from system_prompt.ts so that module stays becca-free.
 */

import { becca } from "@triliumnext/core";

import type { KnowledgeBaseSource } from "./types.js";

/** Maximum number of source notes to include in the knowledge base prompt. */
const KB_MAX_SOURCES = 20;
/** Maximum characters of content preview per source note in the KB prompt. */
const KB_PREVIEW_MAX = 1500;

/**
 * Resolve source note IDs to {noteId, title} pairs, preserving order so that
 * the index matches the numbered reference list in the system prompt.
 * Missing notes keep their slot (with the ID as title) to preserve numbering.
 */
export function resolveKnowledgeBaseSources(sourceNoteIds: string[]): KnowledgeBaseSource[] {
    return sourceNoteIds.slice(0, KB_MAX_SOURCES).map(noteId => ({
        noteId,
        title: becca.getNote(noteId)?.getTitleOrProtected() ?? noteId
    }));
}

/**
 * Build the knowledge base section of the system prompt from source note IDs.
 * Includes note metadata and extended content previews for each source.
 */
export function buildKnowledgeBaseSources(sourceNoteIds: string[]): string | null {
    const sources: string[] = [];

    for (const noteId of sourceNoteIds.slice(0, KB_MAX_SOURCES)) {
        const note = becca.getNote(noteId);
        if (!note) continue;

        const title = note.getTitleOrProtected();
        const childNotes = note.getChildNotes().slice(0, 10);

        let entry = `### ${title} (noteId: ${noteId})`;
        if (note.type !== "text") {
            entry += `\nType: ${note.type}`;
        }
        if (childNotes.length > 0) {
            entry += `\nChild notes: ${childNotes.map(c => `${c.getTitleOrProtected()} (${c.noteId})`).join(", ")}`;
        }

        // Build an extended content preview directly (up to KB_PREVIEW_MAX chars).
        // For text notes, strip HTML tags cheaply instead of full markdown conversion.
        if (note.isContentAvailable()) {
            const content = note.getContent();
            if (typeof content === "string" && content.length > 0) {
                const plain = note.type === "text"
                    ? content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
                    : content;
                if (plain.length > 0) {
                    const preview = plain.length > KB_PREVIEW_MAX
                        ? `${plain.slice(0, KB_PREVIEW_MAX)}…`
                        : plain;
                    entry += `\n\n${preview}`;
                }
            }
        }

        sources.push(entry);
    }

    if (sources.length === 0) return null;

    const refList = sourceNoteIds.slice(0, KB_MAX_SOURCES)
        .map((id, i) => {
            const note = becca.getNote(id);
            return note ? `[${i + 1}] ${note.getTitleOrProtected()} [[${id}]]` : null;
        })
        .filter(Boolean);

    return [
        "## Knowledge Base Sources",
        "",
        "The following notes are the user's selected knowledge base. " +
        "Answer questions primarily using information found in these sources. " +
        "Use `get_note_content` to read the full content of any source when the preview is insufficient. " +
        "You can also use `search_notes` to find related information within source subtrees.",
        "",
        "**Citation rules**: When citing a source, use Harvard-style numbered references inline, e.g. [1], [2]. " +
        "Use only the numbers from the reference list below. " +
        "Do NOT append a reference or bibliography section at the end of your response — " +
        "the sources you cite are displayed to the user automatically.",
        "",
        "Reference list for this conversation:",
        ...refList,
        "",
        "If the user's question cannot be answered from these sources, clearly say so and offer to search the broader note collection.",
        "",
        ...sources
    ].join("\n");
}
