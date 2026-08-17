import type {
    FlashcardActionResponse,
    FlashcardBuryRequest,
    FlashcardCreateRequest,
    FlashcardDeckMoveRequest,
    FlashcardDecksResponse,
    FlashcardDueResponse,
    FlashcardPreviewResponse,
    FlashcardRemoveResponse,
    FlashcardResetRequest,
    FlashcardReviewCard,
    FlashcardReviewRequest,
    FlashcardReviewResponse,
    FlashcardStatsResponse,
    FlashcardSuspensionRequest,
    FlashcardUndoRequest
} from "@triliumnext/commons";

import server, { type ServerErrorResponse } from "./server";

function createCard(request: FlashcardCreateRequest) {
    return server.post<FlashcardReviewCard>("flashcards/cards", request);
}

function getDecks() {
    return server.get<FlashcardDecksResponse>("flashcards/decks");
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

function getPreview(cardId: string) {
    return server.get<FlashcardPreviewResponse>(`flashcards/cards/${cardId}/preview`);
}

function setSuspended(cardId: string, request: FlashcardSuspensionRequest) {
    return withFlashcardConflict(() => server.putWithSilentConflict<FlashcardActionResponse>(
        `flashcards/cards/${cardId}/suspended`,
        request
    ));
}

function resetCard(cardId: string, request: FlashcardResetRequest) {
    return withFlashcardConflict(() => server.postWithSilentConflict<FlashcardActionResponse>(
        `flashcards/cards/${cardId}/reset`,
        request
    ));
}

function buryCard(cardId: string, request: FlashcardBuryRequest) {
    return withFlashcardConflict(() => server.postWithSilentConflict<FlashcardActionResponse>(
        `flashcards/cards/${cardId}/bury`,
        request
    ));
}

function moveCardToDeck(cardId: string, request: FlashcardDeckMoveRequest) {
    return withFlashcardConflict(() => server.putWithSilentConflict<FlashcardActionResponse>(
        `flashcards/cards/${cardId}/deck`,
        request
    ));
}

function undoReview(request: FlashcardUndoRequest) {
    return withFlashcardConflict(() => server.postWithSilentConflict<FlashcardActionResponse>(
        "flashcards/reviews/undo",
        request
    ));
}

function removeCardsForNote(noteId: string) {
    return server.remove<FlashcardRemoveResponse>(`flashcards/notes/${noteId}/cards`);
}

async function reviewCard(cardId: string, request: FlashcardReviewRequest) {
    return await withFlashcardConflict(() => server.postWithSilentConflict<FlashcardReviewResponse>(
        `flashcards/cards/${cardId}/reviews`,
        request
    ));
}

function getStats() {
    return server.get<FlashcardStatsResponse>("flashcards/stats");
}

export class FlashcardConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FlashcardConflictError";
    }
}

function isServerErrorResponse(error: unknown): error is ServerErrorResponse {
    return !!error
        && typeof error === "object"
        && "status" in error
        && "responseText" in error;
}

async function withFlashcardConflict<T>(request: () => Promise<T>) {
    try {
        return await request();
    } catch (e) {
        if (isServerErrorResponse(e) && e.status === 409) {
            throw new FlashcardConflictError(readErrorMessage(e.responseText));
        }

        throw e;
    }
}

function readErrorMessage(responseText: string) {
    try {
        const body = JSON.parse(responseText) as { message?: string };
        return body.message || responseText;
    } catch {
        return responseText;
    }
}

export default {
    createCard,
    getDecks,
    getDueCards,
    getCard,
    getPreview,
    getStats,
    setSuspended,
    resetCard,
    buryCard,
    moveCardToDeck,
    undoReview,
    removeCardsForNote,
    reviewCard
};
