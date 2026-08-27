/**
 * Builds the "current note" context hint — the metadata block describing the
 * note the user is viewing, injected into the user turn so the model can answer
 * questions about it without a tool call. Shared by the AI-SDK providers (via
 * BaseProvider.applyNoteHint) and the Claude Agent provider (which prepends it
 * to the prompt text).
 */

import becca from "../../becca/becca.js";
import { dump } from "js-yaml";

import { getNoteMeta, SYSTEM_PROMPT_LIMITS } from "./tools/helpers.js";

/**
 * The most of a `viewContext` that reaches the model; a widget that reports more than this is cut
 * off so the context window is not spent on it.
 */
export const VIEW_CONTEXT_MAX_LENGTH = 8000;

/**
 * Build a context hint about the current note with full metadata (same shape as
 * get_note / ETAPI). Returns `null` when the note no longer exists.
 *
 * `viewContext` is what the client's widget reports about its own state (see
 * `LlmChatConfig.viewContext`); it is framed and capped here but written by the widget.
 */
export function buildNoteHint(noteId: string, hasAttachments: boolean, viewContext?: string): string | null {
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

    const viewContextHint = buildViewContextHint(viewContext);
    if (viewContextHint) {
        lines.push("", viewContextHint);
    }
    return lines.join("\n");
}

/**
 * Frames what the widget showing the note reports about its state, so the model reads it as the
 * user's screen right now rather than as part of the note. Empty or whitespace-only reports are
 * dropped; longer ones are cut at {@link VIEW_CONTEXT_MAX_LENGTH}.
 */
export function buildViewContextHint(viewContext: string | undefined): string | null {
    const trimmed = viewContext?.trim();
    if (!trimmed) {
        return null;
    }
    const body = trimmed.length > VIEW_CONTEXT_MAX_LENGTH
        ? `${trimmed.slice(0, VIEW_CONTEXT_MAX_LENGTH)}\n[view context truncated]`
        : trimmed;
    return [
        "The view showing this note reports the following about what is on the user's screen right now.",
        "Treat it as the user's current situation, not as part of the note's content.",
        "",
        body
    ].join("\n");
}
