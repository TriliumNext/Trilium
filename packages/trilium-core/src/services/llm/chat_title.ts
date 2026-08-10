import becca from "../../becca/becca.js";
import { getLog } from "../../services/log.js";
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
    const log = getLog();

    const note = becca.getNote(chatNoteId);
    if (!note) {
        log.info(`Not naming chat ${chatNoteId}: no such note.`);
        return;
    }

    // Every way out of here is silent from the user's side — the chat keeps the
    // timestamp it was created with — so each one says which it was.
    if (!hasDefaultTitle(note.title)) {
        log.info(`Not naming chat note ${chatNoteId}: "${note.title}" is neither `
            + `"${t("special_notes.llm_chat_prefix")} …" nor "${t("notes.new-note")}", so it was named deliberately.`);
        return;
    }

    // Whichever provider is configured first, which is not necessarily the one
    // the chat itself is talking to.
    const provider = getProvider();
    log.info(`Naming chat note ${chatNoteId} with the ${provider.name} provider.`);

    const title = await provider.generateTitle(firstMessage);
    if (!title) {
        log.info(`Not naming chat note ${chatNoteId}: the ${provider.name} provider returned an empty title.`);
        return;
    }

    note.title = title;
    note.save();
    log.info(`Auto-renamed chat note ${chatNoteId} to "${title}"`);
}
