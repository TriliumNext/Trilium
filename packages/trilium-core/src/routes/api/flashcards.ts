import type {
    FlashcardCreateRequest,
    FlashcardResetRequest,
    FlashcardReviewRequest,
    FlashcardSuspensionRequest
} from "@triliumnext/commons";
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

function setSuspended(req: Request<{ cardId: string }, {}, FlashcardSuspensionRequest>) {
    return flashcardService.setSuspended(req.params.cardId, req.body);
}

function resetCard(req: Request<{ cardId: string }, {}, FlashcardResetRequest>) {
    return flashcardService.resetCard(req.params.cardId, req.body);
}

function removeCardsForNote(req: Request<{ noteId: string }>) {
    return flashcardService.removeCardsForNote(req.params.noteId);
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
    setSuspended,
    resetCard,
    removeCardsForNote,
    reviewCard
};
