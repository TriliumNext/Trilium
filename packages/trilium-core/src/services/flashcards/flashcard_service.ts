import type {
    FlashcardActionResponse,
    FlashcardBuryRequest,
    FlashcardCardSummary,
    FlashcardCreateRequest,
    FlashcardDeckMoveRequest,
    FlashcardDeckSummary,
    FlashcardDecksResponse,
    FlashcardDueResponse,
    FlashcardRating,
    FlashcardResetRequest,
    FlashcardReviewCard,
    FlashcardPreviewResponse,
    FlashcardRemoveResponse,
    FlashcardReviewRequest,
    FlashcardReviewResponse,
    FlashcardReviewRow,
    FlashcardRow,
    FlashcardSettingsResponse,
    FlashcardSettingsUpdateRequest,
    FlashcardStatsResponse,
    FlashcardSuspensionRequest,
    FlashcardUndoRequest
} from "@triliumnext/commons";

import becca from "../../becca/becca.js";
import BAttribute from "../../becca/entities/battribute.js";
import BFlashcard from "../../becca/entities/bflashcard.js";
import BFlashcardReview from "../../becca/entities/bflashcard_review.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors.js";
import optionService from "../options.js";
import { getSql } from "../sql/index.js";
import dateUtils from "../utils/date";
import { randomString } from "../utils/index.js";
import {
    createEmptyFlashcardSchedule,
    DEFAULT_FLASHCARD_SCHEDULER_CONFIG_JSON,
    getFlashcardRetrievability,
    normalizeFlashcardSchedulerConfig,
    parseFlashcardSchedulerConfig,
    previewFlashcard,
    scheduleFlashcard,
    serializeFlashcardSchedulerConfig
} from "./fsrs_scheduler.js";

const DEFAULT_DUE_LIMIT = 20;
const MAX_DUE_LIMIT = 100;
const BURY_DURATION_MS = 24 * 60 * 60 * 1000;
const FLASHCARD_LABEL = "flashcard";
const FLASHCARD_SCHEDULER_CONFIG_OPTION = "flashcardSchedulerConfig";

function createCard(request: FlashcardCreateRequest) {
    const note = becca.getNoteOrThrow(request.noteId);

    if (!note.isContentAvailable()) {
        throw new ForbiddenError(
            `Cannot create flashcard for protected note '${request.noteId}' `
            + "while protected session is locked."
        );
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
        ...createEmptyFlashcardSchedule(now, getCurrentSchedulerConfig()),
        noteId: note.noteId,
        deckNoteId,
        ordinal: 0
    }).save();

    return buildReviewCard(card.getPojo() as FlashcardRow, { includeBack: true });
}

function getDecks(): FlashcardDecksResponse {
    const now = dateUtils.utcNowDateTime();
    const rows = getSql().getRows<Omit<FlashcardDeckSummary, "deckTitle">>(/*sql*/`
        SELECT
            deckNoteId,
            COUNT(1) AS totalCount,
            SUM(CASE WHEN suspended = 0 AND due <= ? THEN 1 ELSE 0 END) AS dueCount,
            SUM(CASE WHEN suspended = 0 AND state = 0 THEN 1 ELSE 0 END) AS newCount,
            SUM(CASE WHEN suspended = 0 AND state IN (1, 3) THEN 1 ELSE 0 END) AS learningCount,
            SUM(CASE WHEN suspended = 0 AND state = 2 THEN 1 ELSE 0 END) AS reviewCount,
            SUM(CASE WHEN suspended = 1 THEN 1 ELSE 0 END) AS suspendedCount
        FROM flashcards
        WHERE isDeleted = 0
        GROUP BY deckNoteId`, [now]);

    const decks = rows.map((row) => ({
        ...row,
        deckTitle: becca.getNote(row.deckNoteId)?.getTitleOrProtected() || "[missing]"
    }));

    decks.sort((a, b) => a.deckTitle.localeCompare(b.deckTitle)
        || a.deckNoteId.localeCompare(b.deckNoteId));

    return { decks };
}

function getDueCards({
    deckNoteId,
    limit = DEFAULT_DUE_LIMIT
}: { deckNoteId?: string; limit?: number } = {}): FlashcardDueResponse {
    limit = normalizeLimit(limit);
    const now = dateUtils.utcNowDateTime();

    const filterParams: (string | number)[] = [now];
    let deckCondition = "";

    if (deckNoteId) {
        deckCondition = "AND deckNoteId = ?";
        filterParams.push(deckNoteId);
    }

    const totalDueCount = getSql().getValue<number>(/*sql*/`
        SELECT COUNT(1) FROM flashcards
        WHERE isDeleted = 0
          AND suspended = 0
          AND due <= ?
          ${deckCondition}`, filterParams) ?? 0;

    const rows = getSql().getRows<FlashcardRow>(/*sql*/`
        SELECT * FROM flashcards
        WHERE isDeleted = 0
          AND suspended = 0
          AND due <= ?
          ${deckCondition}
        ORDER BY
            CASE
                WHEN state = 2 THEN 0
                WHEN state IN (1, 3) THEN 1
                ELSE 2
            END,
            due,
            cardId
        LIMIT ?`, [ ...filterParams, limit ]);

    return {
        cards: rows.map((row) => buildReviewCard(row, { includeBack: false })),
        totalDueCount
    };
}

function getCard(
    cardId: string,
    { includeBack = true }: { includeBack?: boolean } = {}
): FlashcardReviewCard {
    return buildReviewCard(getCardRow(cardId), { includeBack });
}

function getPreview(cardId: string): FlashcardPreviewResponse {
    const card = getCardRow(cardId);

    return {
        cardId: card.cardId || "",
        schedulingRevision: card.schedulingRevision ?? 0,
        previews: previewFlashcard(card, new Date(), getCurrentSchedulerConfig())
    };
}

function getSettings(): FlashcardSettingsResponse {
    return {
        schedulerConfig: getCurrentSchedulerConfig()
    };
}

function setSettings(request: FlashcardSettingsUpdateRequest): FlashcardSettingsResponse {
    if (!request?.schedulerConfig) {
        throw new ValidationError("Flashcard settings request requires schedulerConfig.");
    }

    const schedulerConfig = normalizeFlashcardSchedulerConfig(request.schedulerConfig);
    optionService.setOption(
        FLASHCARD_SCHEDULER_CONFIG_OPTION,
        serializeFlashcardSchedulerConfig(schedulerConfig)
    );

    return { schedulerConfig };
}

function setSuspended(
    cardId: string,
    request: FlashcardSuspensionRequest
): FlashcardActionResponse {
    if (!request || typeof request.suspended !== "boolean") {
        throw new ValidationError("Flashcard suspension request requires a boolean value.");
    }

    const card = getCardRow(cardId);
    assertExpectedRevision(card, request.expectedSchedulingRevision);

    const updated = new BFlashcard({
        ...card,
        suspended: request.suspended,
        schedulingRevision: (card.schedulingRevision ?? 0) + 1
    }).save();

    return {
        card: buildReviewCard(updated.getPojo() as FlashcardRow, { includeBack: false })
    };
}

function resetCard(cardId: string, request: FlashcardResetRequest = {}): FlashcardActionResponse {
    const card = getCardRow(cardId);
    assertExpectedRevision(card, request.expectedSchedulingRevision);

    const resetSchedule = createEmptyFlashcardSchedule(new Date(), getCurrentSchedulerConfig());
    const updated = new BFlashcard({
        ...card,
        ...resetSchedule,
        suspended: false,
        schedulingRevision: (card.schedulingRevision ?? 0) + 1
    }).save();

    return {
        card: buildReviewCard(updated.getPojo() as FlashcardRow, { includeBack: false })
    };
}

function buryCard(cardId: string, request: FlashcardBuryRequest = {}): FlashcardActionResponse {
    const card = getCardRow(cardId);
    assertExpectedRevision(card, request.expectedSchedulingRevision);

    const buriedUntil = new Date(Date.now() + BURY_DURATION_MS);
    const updated = new BFlashcard({
        ...card,
        due: dateUtils.utcDateTimeStr(buriedUntil),
        schedulingRevision: (card.schedulingRevision ?? 0) + 1
    }).save();

    return {
        card: buildReviewCard(updated.getPojo() as FlashcardRow, { includeBack: false })
    };
}

function moveCardToDeck(
    cardId: string,
    request: FlashcardDeckMoveRequest
): FlashcardActionResponse {
    if (!request?.deckNoteId) {
        throw new ValidationError("Flashcard deck move request requires a deck note ID.");
    }

    const card = getCardRow(cardId);
    assertExpectedRevision(card, request.expectedSchedulingRevision);
    becca.getNoteOrThrow(request.deckNoteId);

    const updated = new BFlashcard({
        ...card,
        deckNoteId: request.deckNoteId,
        schedulingRevision: (card.schedulingRevision ?? 0) + 1
    }).save();

    return {
        card: buildReviewCard(updated.getPojo() as FlashcardRow, { includeBack: false })
    };
}

function removeCardsForNote(noteId: string): FlashcardRemoveResponse {
    const note = becca.getNoteOrThrow(noteId);
    const deleteId = randomString(10);
    const rows = getSql().getRows<FlashcardRow>(/*sql*/`
        SELECT * FROM flashcards
        WHERE noteId = ? AND isDeleted = 0`, [noteId]);

    for (const row of rows) {
        const flashcard = becca.flashcards[row.cardId || ""] ?? new BFlashcard(row);
        flashcard.markAsDeleted(deleteId);

        if (row.cardId) {
            delete becca.flashcards[row.cardId];
        }
    }

    const flashcardLabel = note.getOwnedLabel(FLASHCARD_LABEL);
    if (flashcardLabel) {
        flashcardLabel.markAsDeleted(deleteId);
    }

    return { removedCount: rows.length };
}

function reviewCard(cardId: string, request: FlashcardReviewRequest): FlashcardReviewResponse {
    validateRating(request.rating);

    const duplicate = request.clientRequestId
        ? getSql().getRow<FlashcardReviewRow | null>(/*sql*/`
            SELECT * FROM flashcard_reviews
            WHERE clientRequestId = ?`, [request.clientRequestId])
        : null;

    if (duplicate) {
        if (duplicate.cardId !== cardId) {
            throw new ConflictError(
                `Review request '${request.clientRequestId}' belongs to another flashcard.`
            );
        }

        const card = getCardRow(cardId);
        return {
            card: buildCardSummary(card),
            reviewId: duplicate.reviewId || "",
            previews: previewFlashcard(card, new Date(), getCurrentSchedulerConfig())
        };
    }

    const card = getCardRow(cardId);

    assertExpectedRevision(card, request.expectedSchedulingRevision);

    const note = becca.getNoteOrThrow(card.noteId);
    if (!note.isContentAvailable()) {
        throw new ForbiddenError(
            `Cannot review protected note '${card.noteId}' while protected session is locked.`
        );
    }

    const now = new Date();
    const scheduled = scheduleFlashcard(
        card,
        request.rating,
        now,
        getCurrentSchedulerConfig()
    );
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
            elapsedDaysBefore: scheduled.log.elapsedDaysBefore,
            scheduledDays: scheduled.log.scheduledDays,
            scheduledDaysBefore: scheduled.log.scheduledDaysBefore,
            learningSteps: scheduled.log.learningSteps,
            learningStepsBefore: scheduled.log.learningStepsBefore,
            repsBefore: scheduled.log.repsBefore,
            lapsesBefore: scheduled.log.lapsesBefore,
            lastReviewBefore: scheduled.log.lastReviewBefore,
            schedulingRevisionBefore: scheduled.log.schedulingRevisionBefore,
            schedulingRevisionAfter: scheduled.log.schedulingRevisionAfter,
            reviewedAt: scheduled.log.reviewedAt,
            durationMs: normalizeDuration(request.durationMs),
            algorithm: updatedCard.algorithm,
            algorithmVersion: updatedCard.algorithmVersion,
            schedulerConfig: scheduled.log.schedulerConfig,
            clientRequestId: request.clientRequestId || null
        }).save();

        savedReviewId = review.reviewId || "";
    });

    const updated = getCardRow(cardId);

    return {
        card: buildCardSummary(updated),
        reviewId: savedReviewId,
        previews: previewFlashcard(updated, new Date(), getCurrentSchedulerConfig())
    };
}

function undoReview(request: FlashcardUndoRequest): FlashcardActionResponse {
    const review = getSql().getRow<FlashcardReviewRow | null>(/*sql*/`
        SELECT * FROM flashcard_reviews
        WHERE reviewId = ?`, [request.reviewId]);

    if (!review) {
        throw new NotFoundError(`Flashcard review '${request.reviewId}' was not found.`);
    }

    const card = getCardRow(review.cardId);
    assertExpectedRevision(card, request.expectedSchedulingRevision);

    if ((card.schedulingRevision ?? 0) !== review.schedulingRevisionAfter) {
        throw new ConflictError("Only the latest flashcard review can be undone.");
    }

    const updated = new BFlashcard({
        ...card,
        state: review.state,
        due: review.dueBefore,
        stability: review.stabilityBefore,
        difficulty: review.difficultyBefore,
        elapsedDays: review.elapsedDaysBefore,
        scheduledDays: review.scheduledDaysBefore,
        learningSteps: review.learningStepsBefore,
        reps: review.repsBefore,
        lapses: review.lapsesBefore,
        lastReview: review.lastReviewBefore ?? null,
        schedulingRevision: (card.schedulingRevision ?? 0) + 1
    }).save();

    return {
        card: buildReviewCard(updated.getPojo() as FlashcardRow, { includeBack: false })
    };
}

function getStats(): FlashcardStatsResponse {
    const now = dateUtils.utcNowDateTime();
    const today = new Date();
    const todayStart = `${dateUtils.utcDateStr(today)} 00:00:00.000Z`;
    const sql = getSql();
    const ratingCounts = getRatingCounts();
    const totalReviews = ratingCounts[1] + ratingCounts[2] + ratingCounts[3] + ratingCounts[4];

    return {
        dueCount: sql.getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE isDeleted = 0 AND suspended = 0 AND due <= ?`, [now]) ?? 0,
        newCount: sql.getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE isDeleted = 0 AND suspended = 0 AND state = 0`) ?? 0,
        learningCount: sql.getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE isDeleted = 0 AND suspended = 0 AND state IN (1, 3)`) ?? 0,
        reviewCount: sql.getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE isDeleted = 0 AND suspended = 0 AND state = 2`) ?? 0,
        suspendedCount: sql.getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE isDeleted = 0 AND suspended = 1`) ?? 0,
        reviewedTodayCount: sql.getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE reviewedAt >= ?`, [todayStart]) ?? 0,
        retentionRate: totalReviews === 0 ? null : (totalReviews - ratingCounts[1]) / totalReviews,
        lapseCount: sql.getValue<number>(/*sql*/`
            SELECT COALESCE(SUM(lapses), 0) FROM flashcards
            WHERE isDeleted = 0`) ?? 0,
        dueForecast: getDueForecast(today),
        ratingCounts
    };
}

function getDueForecast(startDate: Date) {
    const dates = Array.from({ length: 7 }, (_item, index) => {
        const date = new Date(startDate);
        date.setUTCDate(date.getUTCDate() + index);
        return dateUtils.utcDateStr(date);
    });
    const rows = getSql().getRows<{ date: string; count: number }>(/*sql*/`
        SELECT substr(due, 1, 10) AS date, COUNT(1) AS count
        FROM flashcards
        WHERE isDeleted = 0
          AND suspended = 0
          AND due >= ?
          AND due < ?
        GROUP BY substr(due, 1, 10)`, [
        `${dates[0]} 00:00:00.000Z`,
        `${dateAfter(daysFromDate(startDate, 7))} 00:00:00.000Z`
    ]);
    const counts = new Map(rows.map((row) => [row.date, row.count]));

    return dates.map((date) => ({
        date,
        count: counts.get(date) ?? 0
    }));
}

function dateAfter(date: Date) {
    return dateUtils.utcDateStr(date);
}

function daysFromDate(date: Date, days: number) {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

function getRatingCounts(): Record<FlashcardRating, number> {
    const rows = getSql().getRows<{ rating: FlashcardRating; count: number }>(/*sql*/`
        SELECT rating, COUNT(1) AS count
        FROM flashcard_reviews
        GROUP BY rating`);
    const ratingCounts: Record<FlashcardRating, number> = {
        1: 0,
        2: 0,
        3: 0,
        4: 0
    };

    for (const row of rows) {
        ratingCounts[row.rating] = row.count;
    }

    return ratingCounts;
}

function getDefaultDeckNoteId(noteId: string) {
    const note = becca.getNoteOrThrow(noteId);
    const parent = note.getStrongParentBranches()[0]?.parentNoteId;
    return parent && parent !== "none" ? parent : "root";
}

function getCardRow(cardId: string): FlashcardRow {
    const card = getSql().getRow<FlashcardRow | null>(/*sql*/`
        SELECT * FROM flashcards
        WHERE cardId = ? AND isDeleted = 0`, [cardId]);

    if (!card) {
        throw new NotFoundError(`Flashcard '${cardId}' was not found.`);
    }

    return card;
}

function buildReviewCard(
    card: FlashcardRow,
    { includeBack }: { includeBack: boolean }
): FlashcardReviewCard {
    const note = becca.getNoteOrThrow(card.noteId);

    if (!note.isContentAvailable()) {
        return {
            ...buildCardSummary(card),
            front: note.getTitleOrProtected(),
            previews: previewFlashcard(card, new Date(), getCurrentSchedulerConfig())
        };
    }

    const content = note.getContent();
    const reviewCard: FlashcardReviewCard = {
        ...buildCardSummary(card),
        front: note.title,
        previews: previewFlashcard(card, new Date(), getCurrentSchedulerConfig())
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
        schedulingRevision: card.schedulingRevision ?? 0,
        retrievability: getFlashcardRetrievability(card)
    };
}

function getCurrentSchedulerConfig() {
    const optionValue = optionService.getOptionOrNull(FLASHCARD_SCHEDULER_CONFIG_OPTION)
        ?? DEFAULT_FLASHCARD_SCHEDULER_CONFIG_JSON;
    return parseFlashcardSchedulerConfig(optionValue);
}

function assertExpectedRevision(card: FlashcardRow, expectedSchedulingRevision?: number) {
    if (expectedSchedulingRevision !== undefined
        && expectedSchedulingRevision !== card.schedulingRevision) {
        throw new ConflictError(
            `Flashcard '${card.cardId}' has changed. Refresh before reviewing.`
        );
    }
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
    getDecks,
    getDueCards,
    getCard,
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
    reviewCard
};
