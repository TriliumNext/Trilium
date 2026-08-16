import type { FlashcardRating, FlashcardRow, FlashcardState } from "@triliumnext/commons";
import { fsrs, Rating, type Card, type FSRSParameters, type Grade, type RecordLogItem, type StepUnit } from "ts-fsrs";

import dateUtils from "../utils/date";

export const FSRS_ALGORITHM = "fsrs-6";
export const FSRS_ALGORITHM_VERSION = "ts-fsrs@5.4.1";

export interface FlashcardSchedulerConfig {
    requestRetention: number;
    maximumInterval: number;
    enableFuzz: boolean;
    enableShortTerm: boolean;
    learningSteps: StepUnit[];
    relearningSteps: StepUnit[];
    weights?: number[];
}

export interface FlashcardReviewPreview {
    rating: FlashcardRating;
    due: string;
    scheduledDays: number;
    state: FlashcardState;
}

export interface FlashcardScheduleResult {
    card: Omit<FlashcardRow, "cardId" | "noteId" | "deckNoteId" | "ordinal" | "utcDateCreated" | "utcDateModified" | "isDeleted" | "deleteId">;
    log: {
        rating: FlashcardRating;
        state: FlashcardState;
        dueBefore: string;
        dueAfter: string;
        stabilityBefore: number;
        stabilityAfter: number;
        difficultyBefore: number;
        difficultyAfter: number;
        elapsedDays: number;
        scheduledDays: number;
        learningSteps: number;
        reviewedAt: string;
    };
}

export const DEFAULT_FLASHCARD_SCHEDULER_CONFIG: FlashcardSchedulerConfig = {
    requestRetention: 0.9,
    maximumInterval: 36500,
    enableFuzz: true,
    enableShortTerm: true,
    learningSteps: ["1m", "10m"],
    relearningSteps: ["10m"]
};

export function createEmptyFlashcardSchedule(now = new Date()) {
    return {
        state: 0 as FlashcardState,
        due: dateUtils.utcDateTimeStr(now),
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        learningSteps: 0,
        reps: 0,
        lapses: 0,
        lastReview: null,
        suspended: false,
        algorithm: FSRS_ALGORITHM,
        algorithmVersion: FSRS_ALGORITHM_VERSION,
        schedulingRevision: 0
    };
}

export function previewFlashcard(card: FlashcardRow, now = new Date(), config = DEFAULT_FLASHCARD_SCHEDULER_CONFIG): FlashcardReviewPreview[] {
    const scheduler = fsrs(toFsrsParameters(config));
    const preview = scheduler.repeat(toFsrsCard(card), now);

    return toRatings().map((rating) => {
        const item = preview[rating];

        return {
            rating,
            due: dateUtils.utcDateTimeStr(item.card.due),
            scheduledDays: item.card.scheduled_days,
            state: item.card.state as FlashcardState
        };
    });
}

export function scheduleFlashcard(card: FlashcardRow, rating: FlashcardRating, now = new Date(), config = DEFAULT_FLASHCARD_SCHEDULER_CONFIG): FlashcardScheduleResult {
    validateRating(rating);

    const scheduler = fsrs(toFsrsParameters(config));
    const result = scheduler.next(toFsrsCard(card), now, rating as Grade);

    return toScheduleResult(card, result);
}

function toFsrsParameters(config: FlashcardSchedulerConfig): Partial<FSRSParameters> {
    return {
        request_retention: config.requestRetention,
        maximum_interval: config.maximumInterval,
        enable_fuzz: config.enableFuzz,
        enable_short_term: config.enableShortTerm,
        learning_steps: config.learningSteps,
        relearning_steps: config.relearningSteps,
        w: config.weights
    };
}

function toFsrsCard(card: FlashcardRow): Card {
    return {
        due: parseStoredDate(card.due),
        stability: card.stability,
        difficulty: card.difficulty,
        elapsed_days: card.elapsedDays,
        scheduled_days: card.scheduledDays,
        learning_steps: card.learningSteps,
        reps: card.reps,
        lapses: card.lapses,
        state: card.state,
        last_review: card.lastReview ? parseStoredDate(card.lastReview) : undefined
    };
}

function parseStoredDate(value: string) {
    return dateUtils.parseDateTime(value);
}

function toScheduleResult(sourceCard: FlashcardRow, result: RecordLogItem): FlashcardScheduleResult {
    return {
        card: {
            state: result.card.state as FlashcardState,
            due: dateUtils.utcDateTimeStr(result.card.due),
            stability: result.card.stability,
            difficulty: result.card.difficulty,
            elapsedDays: result.card.elapsed_days,
            scheduledDays: result.card.scheduled_days,
            learningSteps: result.card.learning_steps,
            reps: result.card.reps,
            lapses: result.card.lapses,
            lastReview: result.card.last_review ? dateUtils.utcDateTimeStr(result.card.last_review) : null,
            suspended: !!sourceCard.suspended,
            algorithm: FSRS_ALGORITHM,
            algorithmVersion: FSRS_ALGORITHM_VERSION,
            schedulingRevision: (sourceCard.schedulingRevision ?? 0) + 1
        },
        log: {
            rating: result.log.rating as FlashcardRating,
            state: result.log.state as FlashcardState,
            dueBefore: dateUtils.utcDateTimeStr(result.log.due),
            dueAfter: dateUtils.utcDateTimeStr(result.card.due),
            stabilityBefore: sourceCard.stability,
            stabilityAfter: result.card.stability,
            difficultyBefore: sourceCard.difficulty,
            difficultyAfter: result.card.difficulty,
            elapsedDays: result.log.elapsed_days,
            scheduledDays: result.log.scheduled_days,
            learningSteps: result.log.learning_steps,
            reviewedAt: dateUtils.utcDateTimeStr(result.log.review)
        }
    };
}

function toRatings(): FlashcardRating[] {
    return [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as FlashcardRating[];
}

function validateRating(rating: FlashcardRating) {
    if (!toRatings().includes(rating)) {
        throw new Error(`Invalid flashcard rating '${rating}'.`);
    }
}
