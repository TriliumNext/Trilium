/**
 * Builds the "current note" context hint — the metadata block describing the
 * note the user is viewing, injected into the user turn so the model can answer
 * questions about it without a tool call. Shared by the AI-SDK providers (via
 * BaseProvider.applyNoteHint) and the Claude Agent provider (which prepends it
 * to the prompt text).
 */

import { becca } from "@triliumnext/core";
import { dump } from "js-yaml";

import { getNoteMeta, SYSTEM_PROMPT_LIMITS } from "./tools/helpers.js";

/**
 * Build a context hint about the current note with full metadata (same shape as
 * get_note / ETAPI). Returns `null` when the note no longer exists.
 */
export function buildNoteHint(noteId: string, hasAttachments: boolean): string | null {
    const note = becca.getNote(noteId);
    if (!note) {
        return null;
    }

    const metadata = dump(getNoteMeta(note, SYSTEM_PROMPT_LIMITS), { lineWidth: -1 });
    const lines = [
        "The user is currently viewing the following note.",
        "Use this metadata (including contentPreview) to answer questions about the note without calling tools when possible.",
        "Use get_note_content only if the preview is insufficient."
    ];
    if (hasAttachments) {
        // When the user has attached files alongside this turn, those are
        // almost always the actual subject of the question — the note context
        // is just ambient information about where they happen to be in the app.
        lines.push("The user has attached files in this message. Treat those attachments as the primary subject of their question; refer to this note only for background context if relevant.");
    }
    lines.push("", metadata);
    return lines.join("\n");
}
