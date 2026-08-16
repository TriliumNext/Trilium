import type { FlashcardCreateRequest, FlashcardReviewRequest } from "@triliumnext/commons";
import type { Request } from "express";

import flashcardService from "../../services/flashcards/flashcard_service.js";

function createCard(req: Request<{}, {}, FlashcardCreateRequest>) {
    return flashcardService.createCard(req.body);
}

function getDueCards(req: Request<{}, {}, {}, { deckNoteId?: string; limit?: string }>) {
    return flashcardService.getDueCards({
        deckNoteId: req.query.deckNoteId,
        limit: req.query.limit ? Number(req.query.limit) : undefined
    });
}

function getCard(req: Request<{ cardId: string }>) {
    return flashcardService.getCard(req.params.cardId);
}

function reviewCard(req: Request<{ cardId: string }, {}, FlashcardReviewRequest>) {
    return flashcardService.reviewCard(req.params.cardId, req.body);
}

function getStats() {
    return flashcardService.getStats();
}

export default {
    createCard,
    getDueCards,
    getCard,
    getStats,
    reviewCard
};
