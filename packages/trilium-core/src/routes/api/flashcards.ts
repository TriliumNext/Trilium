import type {
    FlashcardBuryRequest,
    FlashcardCreateRequest,
    FlashcardDeckMoveRequest,
    FlashcardImportRequest,
    FlashcardResetRequest,
    FlashcardReviewRequest,
    FlashcardSettingsUpdateRequest,
    FlashcardSuspensionRequest,
    FlashcardUndoRequest
} from "@triliumnext/commons";
import type { Request } from "express";

import flashcardService from "../../services/flashcards/flashcard_service.js";

function createCard(req: Request<{}, {}, FlashcardCreateRequest>) {
    return flashcardService.createCard(req.body);
}

function getDecks() {
    return flashcardService.getDecks();
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

function getCardForNote(req: Request<{ noteId: string }>) {
    return flashcardService.getCardForNote(req.params.noteId);
}

function getPreview(req: Request<{ cardId: string }>) {
    return flashcardService.getPreview(req.params.cardId);
}

function getSettings() {
    return flashcardService.getSettings();
}

function setSettings(req: Request<{}, {}, FlashcardSettingsUpdateRequest>) {
    return flashcardService.setSettings(req.body);
}

function setSuspended(req: Request<{ cardId: string }, {}, FlashcardSuspensionRequest>) {
    return flashcardService.setSuspended(req.params.cardId, req.body);
}

function resetCard(req: Request<{ cardId: string }, {}, FlashcardResetRequest>) {
    return flashcardService.resetCard(req.params.cardId, req.body);
}

function buryCard(req: Request<{ cardId: string }, {}, FlashcardBuryRequest>) {
    return flashcardService.buryCard(req.params.cardId, req.body);
}

function moveCardToDeck(req: Request<{ cardId: string }, {}, FlashcardDeckMoveRequest>) {
    return flashcardService.moveCardToDeck(req.params.cardId, req.body);
}

function undoReview(req: Request<{}, {}, FlashcardUndoRequest>) {
    return flashcardService.undoReview(req.body);
}

function removeCardsForNote(req: Request<{ noteId: string }>) {
    return flashcardService.removeCardsForNote(req.params.noteId);
}

function syncCardsForNote(req: Request<{ noteId: string }>) {
    return flashcardService.syncNoteCards(req.params.noteId);
}

function reviewCard(req: Request<{ cardId: string }, {}, FlashcardReviewRequest>) {
    return flashcardService.reviewCard(req.params.cardId, req.body);
}

function getStats() {
    return flashcardService.getStats();
}

function exportAll() {
    return flashcardService.exportAll();
}

function getLeeches() {
    return flashcardService.getLeeches();
}

function importData(req: Request<{}, {}, FlashcardImportRequest>) {
    return flashcardService.importData(req.body);
}

export default {
    createCard,
    getDecks,
    getDueCards,
    getCard,
    getCardForNote,
    getPreview,
    getSettings,
    setSettings,
    getStats,
    setSuspended,
    resetCard,
    buryCard,
    moveCardToDeck,
    undoReview,
    removeCardsForNote,
    syncCardsForNote,
    reviewCard,
    exportAll,
    getLeeches,
    importData
};
