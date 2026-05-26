import { SaveLlmChatResponse } from "@triliumnext/commons";
import { t } from "i18next";

import becca from "../becca/becca.js";
import dateNoteService from "./date_notes.js";
import dateUtils from "./date_utils.js";
import hoistedNoteService from "./hoisted_note.js";
import noteService from "./notes.js";
import SearchContext from "./search/search_context.js";
import searchService from "./search/services/search.js";

function createLlmChat() {
    const { note } = noteService.createNewNote({
        parentNoteId: getMonthlyParentNoteId("_llmChat", "llmChat"),
        title: `${t("special_notes.llm_chat_prefix")} ${dateUtils.localNowDateTime()}`,
        content: JSON.stringify({
            version: 1,
            messages: []
        }),
        type: "llmChat",
        mime: "application/json"
    });

    note.setLabel("iconClass", "bx bx-message-square-dots");
    note.setLabel("keepCurrentHoisting");

    return note;
}

/**
 * Gets the most recently modified LLM chat note.
 * Used by sidebar chat to persist conversation across page refreshes.
 * Returns null if no chat exists.
 */
function getMostRecentLlmChat() {
    // Search for all llmChat notes and return the most recently modified
    const results = searchService.searchNotes(
        "note.type = llmChat",
        new SearchContext({
            ancestorNoteId: "_llmChat",
            limit: 1,
            orderBy: "utcDateModified",
            orderDirection: "desc"
        })
    );

    return results.length > 0 ? results[0] : null;
}

/**
 * Gets the most recent LLM chat or creates a new one if none exists.
 * Used by sidebar chat for persistent conversations.
 */
function getOrCreateLlmChat() {
    const existingChat = getMostRecentLlmChat();

    if (existingChat) {
        return existingChat;
    }

    return createLlmChat();
}

/**
 * Gets a list of recent LLM chat notes.
 * Used by sidebar chat history popup.
 */
function getRecentLlmChats(limit: number = 10) {
    const results = searchService.searchNotes(
        "note.type = llmChat",
        new SearchContext({
            ancestorNoteId: "_llmChat",
            limit,
            orderBy: "utcDateModified",
            orderDirection: "desc"
        })
    );

    return results.map(note => ({
        noteId: note.noteId,
        title: note.title,
        dateModified: note.utcDateModified
    }));
}

function getLlmChatHome() {
    const workspaceNote = hoistedNoteService.getWorkspaceNote();
    if (!workspaceNote) {
        throw new Error("Unable to find workspace note");
    }

    if (!workspaceNote.isRoot()) {
        return workspaceNote.searchNoteInSubtree("#workspaceLlmChatHome") || workspaceNote.searchNoteInSubtree("#llmChatHome") || workspaceNote;
    }
    const today = dateUtils.localNowDate();

    return workspaceNote.searchNoteInSubtree("#llmChatHome") || dateNoteService.getDayNote(today);

}

function saveLlmChat(llmChatNoteId: string | null) {
    if (!llmChatNoteId) {
        throw new Error(`Missing chat note ID`);
    }

    const llmChatNote = becca.getNote(llmChatNoteId);
    if (!llmChatNote) {
        throw new Error(`Unable to find LLM chat note ID: ${llmChatNoteId}`);
    }

    const llmChatHome = getLlmChatHome();

    const result = llmChatNote.cloneTo(llmChatHome.noteId);

    for (const parentBranch of llmChatNote.getParentBranches()) {
        if (parentBranch.parentNote?.hasAncestor("_hidden")) {
            parentBranch.markAsDeleted();
        }
    }

    return result satisfies SaveLlmChatResponse;
}

function getMonthlyParentNoteId(rootNoteId: string, prefix: string) {
    const month = dateUtils.localNowDate().substring(0, 7);
    const labelName = `${prefix}MonthNote`;

    let monthNote = searchService.findFirstNoteWithQuery(`#${labelName}="${month}"`, new SearchContext({ ancestorNoteId: rootNoteId }));

    if (!monthNote) {
        monthNote = noteService.createNewNote({
            parentNoteId: rootNoteId,
            title: month,
            content: "",
            isProtected: false,
            type: "book"
        }).note;

        monthNote.addLabel(labelName, month);
    }

    return monthNote.noteId;
}

export default {
    createLlmChat,
    getMostRecentLlmChat,
    getOrCreateLlmChat,
    getRecentLlmChats,
    saveLlmChat,
};
