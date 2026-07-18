import { Request } from "express";

import specialNotesService from "../../services/special_notes";

function createLlmChat() {
    return specialNotesService.createLlmChat();
}

function getMostRecentLlmChat() {
    const chat = specialNotesService.getMostRecentLlmChat();
    // Return null explicitly if no chat found (not undefined)
    return chat || null;
}

function getOrCreateLlmChat() {
    return specialNotesService.getOrCreateLlmChat();
}

function getRecentLlmChats(req: Request) {
    const limit = parseInt(req.query.limit as string) || 10;
    return specialNotesService.getRecentLlmChats(limit);
}

function saveLlmChat(req: Request<{ llmChatNoteId: string }>) {
    return specialNotesService.saveLlmChat(req.body?.llmChatNoteId);
}

export default {
    createLlmChat,
    getMostRecentLlmChat,
    getOrCreateLlmChat,
    getRecentLlmChats,
    saveLlmChat,
};
