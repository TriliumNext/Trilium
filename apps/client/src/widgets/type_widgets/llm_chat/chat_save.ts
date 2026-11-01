import appContext from "../../../components/app_context.js";
import dateNoteService from "../../../services/date_notes.js";
import { t } from "../../../services/i18n.js";
import note_create from "../../../services/note_create.js";
import toast from "../../../services/toast.js";
import { renderMarkdown } from "./chat_markdown.js";
import { stripQuoteSources } from "./chat_quote.js";

/**
 * Whether the "Save to sub-note" command should be offered for a right-clicked message: only in a
 * note chat (a note to parent under), only with no active text selection (a selection means the
 * selection commands apply, and a whole-message save would be confusing), and only when the message
 * actually has text to save.
 */
export function canSaveToSubNote(notePath: string | null | undefined, hasSelection: boolean, markdown: string): boolean {
    return !!notePath && !hasSelection && markdown.trim().length > 0;
}

/** Save a message as a child note under `parentNotePath`, opening it in the active tab (note chats). */
export function saveMessageToSubNote(parentNotePath: string, markdown: string) {
    return createNoteFromMessage(markdown, { parentNotePath, open: "activeTab" });
}

/**
 * Whether the "Save as note" command should be offered: the sidebar chat's equivalent of "Save to
 * sub-note" (which needs a parent note the sidebar doesn't have). Same conditions minus the parent:
 * no active text selection, and the message has text to save.
 */
export function canSaveAsNote(hasSelection: boolean, markdown: string): boolean {
    return !hasSelection && markdown.trim().length > 0;
}

/** Save a message as a note in the inbox, opening it in a new tab (sidebar chat, which has no parent). */
export async function saveMessageAsInboxNote(markdown: string) {
    const inboxNote = await dateNoteService.getInboxNote();
    if (!inboxNote) {
        toast.showError(t("llm_chat.save_note_failed"));
        return;
    }
    return createNoteFromMessage(markdown, { parentNotePath: inboxNote.noteId, open: "newTab" });
}

interface CreateNoteFromMessageOpts {
    /** The note path (or bare note id) to create the note under. */
    parentNotePath: string;
    /** "activeTab" navigates the current tab in place; "newTab" opens a fresh tab. Both focus the title. */
    open: "activeTab" | "newTab";
}

/**
 * Create an untitled text note from a message's markdown under `parentNotePath` and focus its title so
 * the user names it. The content is rendered from the message's markdown source (not scraped from the
 * rendered chat DOM), so it lands in CKEditor's storage form — math, mermaid diagrams, and code survive
 * intact. Quote attribution lines are stripped (their message-id anchors are meaningless outside the
 * chat). Errors surface as a toast.
 */
async function createNoteFromMessage(markdown: string, { parentNotePath, open }: CreateNoteFromMessageOpts) {
    try {
        const content = renderMarkdown(stripQuoteSources(markdown));
        if (open === "activeTab") {
            await note_create.createNote(parentNotePath, { content, type: "text", focus: "title" });
            return;
        }
        // Create without navigating the active tab, then open the note in a new tab with its title focused.
        const { note } = await note_create.createNote(parentNotePath, { content, type: "text", activate: false });
        if (note) {
            await appContext.tabManager.openTabWithNoteWithHoisting(note.noteId, { activate: true });
            void appContext.triggerEvent("focusAndSelectTitle", { isNewNote: true });
        }
    } catch (e) {
        console.error("Failed to create a note from message:", e);
        toast.showError(t("llm_chat.save_note_failed"));
    }
}
