import type {
    FlashcardCreateRequest,
    FlashcardDueResponse,
    FlashcardRemoveResponse,
    FlashcardReviewCard,
    FlashcardReviewRequest,
    FlashcardReviewResponse,
    FlashcardStatsResponse
} from "@triliumnext/commons";

import server from "./server";

function createCard(request: FlashcardCreateRequest) {
    return server.post<FlashcardReviewCard>("flashcards/cards", request);
}

function getDueCards({ deckNoteId, limit }: { deckNoteId?: string; limit?: number } = {}) {
    const params = new URLSearchParams();

    if (deckNoteId) {
        params.set("deckNoteId", deckNoteId);
    }

    if (limit !== undefined) {
        params.set("limit", limit.toString());
    }

    const query = params.toString();
    return server.get<FlashcardDueResponse>(`flashcards/due${query ? `?${query}` : ""}`);
}

function getCard(cardId: string) {
    return server.get<FlashcardReviewCard>(`flashcards/cards/${cardId}`);
}

function removeCardsForNote(noteId: string) {
    return server.remove<FlashcardRemoveResponse>(`flashcards/notes/${noteId}/cards`);
}

function reviewCard(cardId: string, request: FlashcardReviewRequest) {
    return server.post<FlashcardReviewResponse>(`flashcards/cards/${cardId}/reviews`, request);
}

function getStats() {
    return server.get<FlashcardStatsResponse>("flashcards/stats");
}

export default {
    createCard,
    getDueCards,
    getCard,
    getStats,
    removeCardsForNote,
    reviewCard
};
