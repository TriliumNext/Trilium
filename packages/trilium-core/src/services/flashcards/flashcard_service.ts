import { dayjs } from "@triliumnext/commons";
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
const FLASHCARD_LEECH_LABEL = "flashcardLeech";
const FLASHCARD_LEECH_THRESHOLD = 8;
const FLASHCARD_SCHEDULER_CONFIG_OPTION = "flashcardSchedulerConfig";
const FLASHCARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_REVIEW_DURATION_MS = 24 * 60 * 60 * 1000;

function createCard(request: FlashcardCreateRequest) {
    assertValidId(request?.noteId, "noteId");
    const note = becca.getNoteOrThrow(request.noteId);

    if (!note.isContentAvailable()) {
        throw new ForbiddenError(
            "Cannot create flashcard for protected note while protected session is locked."
        );
    }

    if (request.deckNoteId) {
        assertValidId(request.deckNoteId, "deckNoteId");
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
        JOIN notes source_notes
          ON source_notes.noteId = flashcards.noteId
         AND source_notes.isDeleted = 0
        WHERE flashcards.isDeleted = 0
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

    if (deckNoteId) {
        assertValidId(deckNoteId, "deckNoteId");
    }

    const due = getLimitedDueRows({
        deckNoteId,
        limit,
        config: getCurrentSchedulerConfig()
    });

    return {
        cards: due.rows.map((row) => buildReviewCard(row, { includeBack: false })),
        totalDueCount: due.totalDueCount
    };
}

function getLimitedDueRows({
    deckNoteId,
    limit,
    config
}: {
    deckNoteId?: string;
    limit: number;
    config: ReturnType<typeof getCurrentSchedulerConfig>;
}) {
    const now = dateUtils.utcNowDateTime();
    const dayRange = getStudyDayRange(config.dayRolloverHour);
    const dailyNewUsed = countReviewsInStudyDay({ stateCondition: "state = 0", dayRange });
    const dailyReviewUsed = countReviewsInStudyDay({ stateCondition: "state = 2", dayRange });
    const dailyNewRemaining = Math.max(0, config.dailyNewCardLimit - dailyNewUsed);
    const dailyReviewRemaining = Math.max(0, config.dailyReviewLimit - dailyReviewUsed);
    const rows: FlashcardRow[] = [];
    const reviewDueCount = countDueRows({ deckNoteId, now, stateCondition: "flashcards.state = 2" });
    const learningDueCount = countDueRows({
        deckNoteId,
        now,
        stateCondition: "flashcards.state IN (1, 3)"
    });
    const newDueCount = countDueRows({ deckNoteId, now, stateCondition: "flashcards.state = 0" });
    const addRows = (stateCondition: string, rowLimit: number) => {
        if (rowLimit <= 0 || rows.length >= limit) {
            return;
        }

        rows.push(...getDueRows({
            deckNoteId,
            now,
            stateCondition,
            limit: Math.min(rowLimit, limit - rows.length)
        }));
    };

    addRows("flashcards.state = 2", dailyReviewRemaining);
    addRows("flashcards.state IN (1, 3)", limit);
    addRows("flashcards.state = 0", dailyNewRemaining);

    return {
        rows,
        totalDueCount: Math.min(reviewDueCount, dailyReviewRemaining)
            + learningDueCount
            + Math.min(newDueCount, dailyNewRemaining)
    };
}

function countReviewsInStudyDay({
    stateCondition,
    dayRange
}: {
    stateCondition: string;
    dayRange: { start: string; end: string };
}) {
    return getSql().getValue<number>(/*sql*/`
        SELECT COUNT(1) FROM flashcard_reviews
        WHERE ${stateCondition}
          AND reviewedAt >= ?
          AND reviewedAt < ?`, [dayRange.start, dayRange.end]) ?? 0;
}

function countDueRows({
    deckNoteId,
    now,
    stateCondition
}: {
    deckNoteId?: string;
    now: string;
    stateCondition: string;
}) {
    const params: string[] = [now];
    const deckCondition = getDeckCondition(deckNoteId, params);

    return getSql().getValue<number>(/*sql*/`
        SELECT COUNT(1) FROM flashcards
        JOIN notes source_notes
          ON source_notes.noteId = flashcards.noteId
         AND source_notes.isDeleted = 0
        WHERE flashcards.isDeleted = 0
          AND flashcards.suspended = 0
          AND flashcards.due <= ?
          AND ${stateCondition}
          ${deckCondition}`, params) ?? 0;
}

function getDueRows({
    deckNoteId,
    now,
    stateCondition,
    limit
}: {
    deckNoteId?: string;
    now: string;
    stateCondition: string;
    limit: number;
}) {
    const params: (string | number)[] = [now];
    const deckCondition = getDeckCondition(deckNoteId, params);

    return getSql().getRows<FlashcardRow>(/*sql*/`
        SELECT flashcards.* FROM flashcards
        JOIN notes source_notes
          ON source_notes.noteId = flashcards.noteId
         AND source_notes.isDeleted = 0
        WHERE flashcards.isDeleted = 0
          AND flashcards.suspended = 0
          AND flashcards.due <= ?
          AND ${stateCondition}
          ${deckCondition}
        ORDER BY flashcards.due, flashcards.cardId
        LIMIT ?`, [ ...params, limit ]);
}

function getDeckCondition(deckNoteId: string | undefined, params: (string | number)[]) {
    if (!deckNoteId) {
        return "";
    }

    params.push(deckNoteId);
    return "AND flashcards.deckNoteId = ?";
}

function getStudyDayRange(dayRolloverHour: number) {
    const localNow = dayjs(dateUtils.localNowDateTime(), dateUtils.LOCAL_DATETIME_FORMAT);
    let start = localNow
        .hour(dayRolloverHour)
        .minute(0)
        .second(0)
        .millisecond(0);

    if (localNow.isBefore(start)) {
        start = start.subtract(1, "day");
    }

    return {
        start: dateUtils.utcDateTimeStr(start.toDate()),
        end: dateUtils.utcDateTimeStr(start.add(1, "day").toDate())
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
    removeLeechLabel(card.noteId);

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

    assertValidId(request.deckNoteId, "deckNoteId");
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
    assertValidId(noteId, "noteId");
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

    const leechLabel = note.getOwnedLabel(FLASHCARD_LEECH_LABEL);
    if (leechLabel) {
        leechLabel.markAsDeleted(deleteId);
    }

    return { removedCount: rows.length };
}

function reviewCard(cardId: string, request: FlashcardReviewRequest): FlashcardReviewResponse {
    validateRating(request.rating);
    assertValidId(request?.clientRequestId, "clientRequestId");

    const duplicate = getSql().getRow<FlashcardReviewRow | null>(/*sql*/`
        SELECT * FROM flashcard_reviews
        WHERE clientRequestId = ?`, [request.clientRequestId]);

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

    if (card.suspended) {
        throw new ConflictError(`Flashcard '${cardId}' is suspended and cannot be reviewed.`);
    }

    const note = becca.getNote(card.noteId);
    if (!note || note.isDeleted) {
        throw new NotFoundError("Flashcard source note was not found.");
    }

    if (!note.isContentAvailable()) {
        throw new ForbiddenError(
            "Cannot review protected flashcard while protected session is locked."
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
        const leech = isLeech(scheduled.card);
        const updatedCard = new BFlashcard({
            ...card,
            ...scheduled.card,
            suspended: scheduled.card.suspended || leech
        }).save();

        if (leech) {
            addLeechLabel(card.noteId);
        }

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
            clientRequestId: request.clientRequestId
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
    assertValidId(request?.reviewId, "reviewId");
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

    const leechBeforeReview = review.lapsesBefore >= FLASHCARD_LEECH_THRESHOLD;
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
        suspended: leechBeforeReview ? card.suspended : false,
        schedulingRevision: (card.schedulingRevision ?? 0) + 1
    }).save();

    if (!leechBeforeReview) {
        removeLeechLabel(card.noteId);
    }

    return {
        card: buildReviewCard(updated.getPojo() as FlashcardRow, { includeBack: false })
    };
}

function getStats(): FlashcardStatsResponse {
    const today = new Date();
    const todayStart = `${dateUtils.utcDateStr(today)} 00:00:00.000Z`;
    const sql = getSql();
    const ratingCounts = getRatingCounts();
    const totalReviews = ratingCounts[1] + ratingCounts[2] + ratingCounts[3] + ratingCounts[4];
    const dueCount = getLimitedDueRows({
        limit: 1,
        config: getCurrentSchedulerConfig()
    }).totalDueCount;

    return {
        dueCount,
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
        leechCount: sql.getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE isDeleted = 0 AND lapses >= ?`, [FLASHCARD_LEECH_THRESHOLD]) ?? 0,
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
    assertValidId(cardId, "cardId");
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
    const note = becca.getNote(card.noteId);

    if (!note || note.isDeleted) {
        throw new NotFoundError("Flashcard source note was not found.");
    }

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
        leech: isLeech(card),
        schedulingRevision: card.schedulingRevision ?? 0,
        retrievability: getFlashcardRetrievability(card)
    };
}

function isLeech(card: Pick<FlashcardRow, "lapses">) {
    return card.lapses >= FLASHCARD_LEECH_THRESHOLD;
}

function addLeechLabel(noteId: string) {
    const note = becca.getNoteOrThrow(noteId);

    if (note.hasOwnedLabel(FLASHCARD_LEECH_LABEL)) {
        return;
    }

    new BAttribute({
        noteId,
        type: "label",
        name: FLASHCARD_LEECH_LABEL,
        value: FLASHCARD_LEECH_THRESHOLD.toString(),
        isInheritable: false
    }).save();
}

function removeLeechLabel(noteId: string, deleteId = randomString(10)) {
    const leechLabel = becca.getNoteOrThrow(noteId).getOwnedLabel(FLASHCARD_LEECH_LABEL);

    if (leechLabel) {
        leechLabel.markAsDeleted(deleteId);
    }
}

function getCurrentSchedulerConfig() {
    const optionValue = optionService.getOptionOrNull(FLASHCARD_SCHEDULER_CONFIG_OPTION)
        ?? DEFAULT_FLASHCARD_SCHEDULER_CONFIG_JSON;
    return parseFlashcardSchedulerConfig(optionValue);
}

function assertValidId(id: string | undefined, fieldName: string) {
    if (!id || !FLASHCARD_ID_PATTERN.test(id)) {
        throw new ValidationError(`Invalid flashcard ${fieldName}.`);
    }
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

    if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > MAX_REVIEW_DURATION_MS) {
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
