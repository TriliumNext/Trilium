import { becca, getLog } from "@triliumnext/core";
import { t } from "i18next";

import { getProvider } from "./index.js";

/** Default title prefixes that indicate the note hasn't been manually renamed. */
function hasDefaultTitle(title: string): boolean {
    // "Chat: <timestamp>" from sidebar/API-created chats
    const chatPrefix = t("special_notes.llm_chat_prefix");
    // "New note" from manually created chats
    const newNoteTitle = t("notes.new-note");

    return title.startsWith(chatPrefix) || title === newNoteTitle;
}

/**
 * Generate a short descriptive title for a chat note based on the first user message,
 * then rename the note. Only renames if the note still has a default title.
 */
export async function generateChatTitle(chatNoteId: string, firstMessage: string): Promise<void> {
    const note = becca.getNote(chatNoteId);
    if (!note) {
        return;
    }

    if (!hasDefaultTitle(note.title)) {
        return;
    }

    const provider = getProvider();
    const title = await provider.generateTitle(firstMessage);
    if (title) {
        note.title = title;
        note.save();
        getLog().info(`Auto-renamed chat note ${chatNoteId} to "${title}"`);
    }
}
