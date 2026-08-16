import type {
    FlashcardCardSummary,
    FlashcardCreateRequest,
    FlashcardDueResponse,
    FlashcardRating,
    FlashcardReviewCard,
    FlashcardReviewRequest,
    FlashcardReviewResponse,
    FlashcardReviewRow,
    FlashcardRow,
    FlashcardStatsResponse
} from "@triliumnext/commons";

import becca from "../../becca/becca.js";
import BAttribute from "../../becca/entities/battribute.js";
import BFlashcard from "../../becca/entities/bflashcard.js";
import BFlashcardReview from "../../becca/entities/bflashcard_review.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors.js";
import { getSql } from "../sql/index.js";
import dateUtils from "../utils/date";
import {
    createEmptyFlashcardSchedule,
    DEFAULT_FLASHCARD_SCHEDULER_CONFIG,
    previewFlashcard,
    scheduleFlashcard
} from "./fsrs_scheduler.js";

const DEFAULT_DUE_LIMIT = 20;
const MAX_DUE_LIMIT = 100;
const FLASHCARD_LABEL = "flashcard";

function createCard(request: FlashcardCreateRequest) {
    const note = becca.getNoteOrThrow(request.noteId);

    if (!note.isContentAvailable()) {
        throw new ForbiddenError(`Cannot create flashcard for protected note '${request.noteId}' while protected session is locked.`);
    }

    const deckNoteId = request.deckNoteId || getDefaultDeckNoteId(request.noteId);
    becca.getNoteOrThrow(deckNoteId);

    const existing = getSql().getRow<FlashcardRow | null>(/*sql*/`
        SELECT * FROM flashcards
        WHERE noteId = ? AND ordinal = 0 AND isDeleted = 0`, [request.noteId]);

    if (existing?.cardId) {
        return buildReviewCard(existing, { includeBack: true });
    }

    if (!note.hasLabel(FLASHCARD_LABEL)) {
        new BAttribute({
            noteId: note.noteId,
            type: "label",
            name: FLASHCARD_LABEL,
            value: "",
            isInheritable: false
        }).save();
    }

    const now = new Date();
    const card = new BFlashcard({
        ...createEmptyFlashcardSchedule(now),
        noteId: note.noteId,
        deckNoteId,
        ordinal: 0
    }).save();

    return buildReviewCard(card.getPojo() as FlashcardRow, { includeBack: true });
}

function getDueCards({ deckNoteId, limit = DEFAULT_DUE_LIMIT }: { deckNoteId?: string; limit?: number } = {}): FlashcardDueResponse {
    limit = normalizeLimit(limit);
    const now = dateUtils.utcNowDateTime();

    const params: (string | number)[] = [now];
    let deckCondition = "";

    if (deckNoteId) {
        deckCondition = "AND deckNoteId = ?";
        params.push(deckNoteId);
    }

    params.push(limit);

    const rows = getSql().getRows<FlashcardRow>(/*sql*/`
        SELECT * FROM flashcards
        WHERE isDeleted = 0
          AND suspended = 0
          AND due <= ?
          ${deckCondition}
        ORDER BY due, state, cardId
        LIMIT ?`, params);

    return {
        cards: rows.map((row) => buildReviewCard(row, { includeBack: false }))
    };
}

function getCard(cardId: string, { includeBack = true }: { includeBack?: boolean } = {}): FlashcardReviewCard {
    return buildReviewCard(getCardRow(cardId), { includeBack });
}

function reviewCard(cardId: string, request: FlashcardReviewRequest): FlashcardReviewResponse {
    validateRating(request.rating);

    const duplicate = request.clientRequestId
        ? getSql().getRow<FlashcardReviewRow | null>("SELECT * FROM flashcard_reviews WHERE clientRequestId = ?", [request.clientRequestId])
        : null;

    if (duplicate) {
        const card = getCardRow(cardId);
        return {
            card: buildCardSummary(card),
            reviewId: duplicate.reviewId || "",
            previews: previewFlashcard(card)
        };
    }

    const card = getCardRow(cardId);

    if (request.expectedSchedulingRevision !== undefined
        && request.expectedSchedulingRevision !== card.schedulingRevision) {
        throw new ConflictError(`Flashcard '${cardId}' has changed. Refresh before reviewing.`);
    }

    const note = becca.getNoteOrThrow(card.noteId);
    if (!note.isContentAvailable()) {
        throw new ForbiddenError(`Cannot review protected note '${card.noteId}' while protected session is locked.`);
    }

    const now = new Date();
    const scheduled = scheduleFlashcard(card, request.rating, now, DEFAULT_FLASHCARD_SCHEDULER_CONFIG);
    let savedReviewId = "";

    getSql().transactional(() => {
        const updatedCard = new BFlashcard({
            ...card,
            ...scheduled.card
        }).save();

        const review = new BFlashcardReview({
            cardId,
            rating: scheduled.log.rating,
            state: scheduled.log.state,
            dueBefore: scheduled.log.dueBefore,
            dueAfter: scheduled.log.dueAfter,
            stabilityBefore: scheduled.log.stabilityBefore,
            stabilityAfter: scheduled.log.stabilityAfter,
            difficultyBefore: scheduled.log.difficultyBefore,
            difficultyAfter: scheduled.log.difficultyAfter,
            elapsedDays: scheduled.log.elapsedDays,
            scheduledDays: scheduled.log.scheduledDays,
            learningSteps: scheduled.log.learningSteps,
            reviewedAt: scheduled.log.reviewedAt,
            durationMs: normalizeDuration(request.durationMs),
            algorithm: updatedCard.algorithm,
            algorithmVersion: updatedCard.algorithmVersion,
            clientRequestId: request.clientRequestId || null
        }).save();

        savedReviewId = review.reviewId || "";
    });

    const updated = getCardRow(cardId);

    return {
        card: buildCardSummary(updated),
        reviewId: savedReviewId,
        previews: previewFlashcard(updated)
    };
}

function getStats(): FlashcardStatsResponse {
    const now = dateUtils.utcNowDateTime();
    const sql = getSql();

    return {
        dueCount: sql.getValue<number>("SELECT COUNT(1) FROM flashcards WHERE isDeleted = 0 AND suspended = 0 AND due <= ?", [now]) ?? 0,
        newCount: sql.getValue<number>("SELECT COUNT(1) FROM flashcards WHERE isDeleted = 0 AND suspended = 0 AND state = 0") ?? 0,
        learningCount: sql.getValue<number>("SELECT COUNT(1) FROM flashcards WHERE isDeleted = 0 AND suspended = 0 AND state IN (1, 3)") ?? 0,
        reviewCount: sql.getValue<number>("SELECT COUNT(1) FROM flashcards WHERE isDeleted = 0 AND suspended = 0 AND state = 2") ?? 0,
        suspendedCount: sql.getValue<number>("SELECT COUNT(1) FROM flashcards WHERE isDeleted = 0 AND suspended = 1") ?? 0
    };
}

function getDefaultDeckNoteId(noteId: string) {
    const note = becca.getNoteOrThrow(noteId);
    const parent = note.getStrongParentBranches()[0]?.parentNoteId;
    return parent && parent !== "none" ? parent : "root";
}

function getCardRow(cardId: string): FlashcardRow {
    const card = getSql().getRow<FlashcardRow | null>("SELECT * FROM flashcards WHERE cardId = ? AND isDeleted = 0", [cardId]);

    if (!card) {
        throw new NotFoundError(`Flashcard '${cardId}' was not found.`);
    }

    return card;
}

function buildReviewCard(card: FlashcardRow, { includeBack }: { includeBack: boolean }): FlashcardReviewCard {
    const note = becca.getNoteOrThrow(card.noteId);

    if (!note.isContentAvailable()) {
        return {
            ...buildCardSummary(card),
            front: note.getTitleOrProtected(),
            previews: previewFlashcard(card)
        };
    }

    const content = note.getContent();
    const reviewCard: FlashcardReviewCard = {
        ...buildCardSummary(card),
        front: note.title,
        previews: previewFlashcard(card)
    };

    if (includeBack) {
        reviewCard.back = typeof content === "string" ? content : "";
    }

    return reviewCard;
}

function buildCardSummary(card: FlashcardRow): FlashcardCardSummary {
    const note = becca.getNote(card.noteId);
    const deck = becca.getNote(card.deckNoteId);

    return {
        cardId: card.cardId || "",
        noteId: card.noteId,
        deckNoteId: card.deckNoteId,
        noteTitle: note?.getTitleOrProtected() || "[missing]",
        deckTitle: deck?.getTitleOrProtected() || "[missing]",
        state: card.state,
        due: card.due,
        suspended: !!card.suspended,
        schedulingRevision: card.schedulingRevision ?? 0
    };
}

function normalizeLimit(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new ValidationError(`Invalid flashcard limit '${limit}'.`);
    }

    return Math.min(limit, MAX_DUE_LIMIT);
}

function normalizeDuration(durationMs: number | undefined) {
    if (durationMs === undefined || durationMs === null) {
        return null;
    }

    if (!Number.isInteger(durationMs) || durationMs < 0) {
        throw new ValidationError(`Invalid review duration '${durationMs}'.`);
    }

    return durationMs;
}

function validateRating(rating: FlashcardRating) {
    if (![1, 2, 3, 4].includes(rating)) {
        throw new ValidationError(`Invalid flashcard rating '${rating}'.`);
    }
}

export default {
    createCard,
    getDueCards,
    getCard,
    getStats,
    reviewCard
};
