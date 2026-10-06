import type {
    FlashcardRating,
    FlashcardRow,
    FlashcardSchedulerSettings,
    FlashcardState
} from "@triliumnext/commons";
import {
    fsrs,
    Rating,
    type Card,
    type FSRSParameters,
    type Grade,
    type RecordLogItem,
    type StepUnit
} from "ts-fsrs";

import { ValidationError } from "../../errors.js";
import dateUtils from "../utils/date";

export const FSRS_ALGORITHM = "fsrs-6";
export const FSRS_ALGORITHM_VERSION = "ts-fsrs@5.4.1";
const FSRS_WEIGHT_COUNT = 21;

export interface FlashcardSchedulerConfig extends Omit<FlashcardSchedulerSettings,
    "learningSteps" | "relearningSteps" | "weights"> {
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

type FlashcardScheduleCard = Omit<FlashcardRow,
    | "cardId"
    | "noteId"
    | "deckNoteId"
    | "ordinal"
    | "utcDateCreated"
    | "utcDateModified"
    | "isDeleted"
    | "deleteId">;

export interface FlashcardScheduleResult {
    card: FlashcardScheduleCard;
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
        elapsedDaysBefore: number;
        scheduledDays: number;
        scheduledDaysBefore: number;
        learningSteps: number;
        learningStepsBefore: number;
        repsBefore: number;
        lapsesBefore: number;
        lastReviewBefore?: string | null;
        schedulingRevisionBefore: number;
        schedulingRevisionAfter: number;
        reviewedAt: string;
        schedulerConfig: string;
    };
}

export const DEFAULT_FLASHCARD_SCHEDULER_CONFIG: FlashcardSchedulerConfig = {
    requestRetention: 0.9,
    maximumInterval: 36500,
    enableFuzz: true,
    enableShortTerm: true,
    learningSteps: ["1m", "10m"],
    relearningSteps: ["10m"],
    dailyNewCardLimit: 20,
    dailyReviewLimit: 200,
    dayRolloverHour: 4
};

export const DEFAULT_FLASHCARD_SCHEDULER_CONFIG_JSON = serializeFlashcardSchedulerConfig(
    DEFAULT_FLASHCARD_SCHEDULER_CONFIG
);

export function createEmptyFlashcardSchedule(
    now = new Date(),
    config = DEFAULT_FLASHCARD_SCHEDULER_CONFIG
) {
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
        schedulerConfig: serializeFlashcardSchedulerConfig(config),
        schedulingRevision: 0
    };
}

export function previewFlashcard(
    card: FlashcardRow,
    now = new Date(),
    config?: FlashcardSchedulerConfig
): FlashcardReviewPreview[] {
    validateFlashcardState(card);
    const schedulerConfig = config ?? getSchedulerConfigForCard(card);
    validateSchedulerConfig(schedulerConfig);

    const scheduler = fsrs(toFsrsParameters(schedulerConfig));
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

export function scheduleFlashcard(
    card: FlashcardRow,
    rating: FlashcardRating,
    now = new Date(),
    config?: FlashcardSchedulerConfig
): FlashcardScheduleResult {
    validateRating(rating);
    validateFlashcardState(card);
    const schedulerConfig = config ?? getSchedulerConfigForCard(card);
    validateSchedulerConfig(schedulerConfig);

    const scheduler = fsrs(toFsrsParameters(schedulerConfig));
    const result = scheduler.next(toFsrsCard(card), now, rating as Grade);

    return toScheduleResult(card, result, schedulerConfig);
}

export function getFlashcardRetrievability(
    card: FlashcardRow,
    now = new Date(),
    config?: FlashcardSchedulerConfig
) {
    validateFlashcardState(card);
    const schedulerConfig = config ?? getSchedulerConfigForCard(card);
    validateSchedulerConfig(schedulerConfig);

    const scheduler = fsrs(toFsrsParameters(schedulerConfig));
    return scheduler.get_retrievability(toFsrsCard(card), now, false);
}

export function serializeFlashcardSchedulerConfig(config: FlashcardSchedulerConfig) {
    validateSchedulerConfig(config);

    return JSON.stringify({
        requestRetention: config.requestRetention,
        maximumInterval: config.maximumInterval,
        enableFuzz: config.enableFuzz,
        enableShortTerm: config.enableShortTerm,
        learningSteps: config.learningSteps,
        relearningSteps: config.relearningSteps,
        dailyNewCardLimit: config.dailyNewCardLimit,
        dailyReviewLimit: config.dailyReviewLimit,
        dayRolloverHour: config.dayRolloverHour,
        weights: config.weights ?? null
    });
}

export function parseFlashcardSchedulerConfig(configJson: string) {
    let parsed: unknown;
    try {
        parsed = JSON.parse(configJson);
    } catch (e) {
        throw new ValidationError(`Invalid flashcard scheduler config JSON: ${String(e)}`);
    }

    return normalizeSchedulerConfig(parsed);
}

export function normalizeFlashcardSchedulerConfig(value: unknown) {
    return normalizeSchedulerConfig(value);
}

function getSchedulerConfigForCard(card: FlashcardRow) {
    if (!card.schedulerConfig) {
        return DEFAULT_FLASHCARD_SCHEDULER_CONFIG;
    }

    return parseFlashcardSchedulerConfig(card.schedulerConfig);
}

function validateFlashcardState(card: FlashcardRow) {
    validateStoredDate(card.due, "due");

    if (card.lastReview) {
        validateStoredDate(card.lastReview, "lastReview");
    }

    if (![0, 1, 2, 3].includes(card.state)) {
        throw new ValidationError(`Invalid flashcard state '${card.state}'.`);
    }

    validateNonNegativeNumber(card.stability, "stability");
    validateNonNegativeNumber(card.difficulty, "difficulty");
    validateNonNegativeInteger(card.elapsedDays, "elapsedDays");
    validateNonNegativeInteger(card.scheduledDays, "scheduledDays");
    validateNonNegativeInteger(card.learningSteps, "learningSteps");
    validateNonNegativeInteger(card.reps, "reps");
    validateNonNegativeInteger(card.lapses, "lapses");

    if (card.schedulingRevision !== undefined) {
        validateNonNegativeInteger(card.schedulingRevision, "schedulingRevision");
    }
}

function normalizeSchedulerConfig(value: unknown): FlashcardSchedulerConfig {
    if (!value || typeof value !== "object") {
        throw new ValidationError("Flashcard scheduler config must be an object.");
    }

    const config = value as Partial<FlashcardSchedulerConfig> & { weights?: number[] | null };
    const normalized = {
        requestRetention: config.requestRetention,
        maximumInterval: config.maximumInterval,
        enableFuzz: config.enableFuzz,
        enableShortTerm: config.enableShortTerm,
        learningSteps: config.learningSteps,
        relearningSteps: config.relearningSteps,
        dailyNewCardLimit: config.dailyNewCardLimit
            ?? DEFAULT_FLASHCARD_SCHEDULER_CONFIG.dailyNewCardLimit,
        dailyReviewLimit: config.dailyReviewLimit
            ?? DEFAULT_FLASHCARD_SCHEDULER_CONFIG.dailyReviewLimit,
        dayRolloverHour: config.dayRolloverHour
            ?? DEFAULT_FLASHCARD_SCHEDULER_CONFIG.dayRolloverHour,
        weights: config.weights ?? undefined
    } as FlashcardSchedulerConfig;

    validateSchedulerConfig(normalized);
    return normalized;
}

function validateSchedulerConfig(config: FlashcardSchedulerConfig) {
    if (!Number.isFinite(config.requestRetention)
        || config.requestRetention <= 0
        || config.requestRetention >= 1) {
        throw new ValidationError("Flashcard request retention must be between 0 and 1.");
    }

    validatePositiveInteger(config.maximumInterval, "maximumInterval");
    validateBoolean(config.enableFuzz, "enableFuzz");
    validateBoolean(config.enableShortTerm, "enableShortTerm");
    validateStepList(config.learningSteps, "learningSteps");
    validateStepList(config.relearningSteps, "relearningSteps");
    validateNonNegativeInteger(config.dailyNewCardLimit, "dailyNewCardLimit");
    validateNonNegativeInteger(config.dailyReviewLimit, "dailyReviewLimit");

    if (!Number.isInteger(config.dayRolloverHour)
        || config.dayRolloverHour < 0
        || config.dayRolloverHour > 23) {
        throw new ValidationError("Flashcard dayRolloverHour must be an integer from 0 to 23.");
    }

    if (config.weights !== undefined) {
        if (!Array.isArray(config.weights)) {
            throw new ValidationError("Flashcard weights must be an array.");
        }

        if (config.weights.length !== FSRS_WEIGHT_COUNT) {
            throw new ValidationError(`Flashcard weights must contain ${FSRS_WEIGHT_COUNT} values.`);
        }

        for (const [index, weight] of config.weights.entries()) {
            validatePositiveNumber(weight, `weights[${index}]`);
        }
    }
}

function validateStoredDate(value: string, field: string) {
    const error = dateUtils.validateUtcDateTime(value);

    if (error) {
        throw new ValidationError(`Invalid flashcard ${field}: ${error}`);
    }
}

function validateNonNegativeNumber(value: number, field: string) {
    if (!Number.isFinite(value) || value < 0) {
        throw new ValidationError(`Flashcard ${field} must be a non-negative number.`);
    }
}

function validatePositiveNumber(value: number, field: string) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new ValidationError(`Flashcard ${field} must be a positive number.`);
    }
}

function validateBoolean(value: boolean, field: string) {
    if (typeof value !== "boolean") {
        throw new ValidationError(`Flashcard ${field} must be a boolean.`);
    }
}

function validateNonNegativeInteger(value: number, field: string) {
    if (!Number.isInteger(value) || value < 0) {
        throw new ValidationError(`Flashcard ${field} must be a non-negative integer.`);
    }
}

function validatePositiveInteger(value: number, field: string) {
    if (!Number.isInteger(value) || value < 1) {
        throw new ValidationError(`Flashcard ${field} must be a positive integer.`);
    }
}

function validateStepList(steps: StepUnit[], field: string) {
    if (!Array.isArray(steps)) {
        throw new ValidationError(`Flashcard ${field} must be an array.`);
    }

    for (const [index, step] of steps.entries()) {
        if (typeof step !== "string" || !/^\d+(?:\.\d+)?[mhd]$/.test(step)) {
            throw new ValidationError(`Invalid flashcard ${field}[${index}] '${step}'.`);
        }
    }
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

function toScheduleResult(
    sourceCard: FlashcardRow,
    result: RecordLogItem,
    schedulerConfig: FlashcardSchedulerConfig
): FlashcardScheduleResult {
    const schedulerConfigJson = serializeFlashcardSchedulerConfig(schedulerConfig);

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
            lastReview: result.card.last_review
                ? dateUtils.utcDateTimeStr(result.card.last_review)
                : null,
            suspended: !!sourceCard.suspended,
            algorithm: FSRS_ALGORITHM,
            algorithmVersion: FSRS_ALGORITHM_VERSION,
            schedulerConfig: schedulerConfigJson,
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
            elapsedDaysBefore: sourceCard.elapsedDays,
            scheduledDays: result.log.scheduled_days,
            scheduledDaysBefore: sourceCard.scheduledDays,
            learningSteps: result.log.learning_steps,
            learningStepsBefore: sourceCard.learningSteps,
            repsBefore: sourceCard.reps,
            lapsesBefore: sourceCard.lapses,
            lastReviewBefore: sourceCard.lastReview,
            schedulingRevisionBefore: sourceCard.schedulingRevision ?? 0,
            schedulingRevisionAfter: (sourceCard.schedulingRevision ?? 0) + 1,
            reviewedAt: dateUtils.utcDateTimeStr(result.log.review),
            schedulerConfig: schedulerConfigJson
        }
    };
}

function toRatings(): FlashcardRating[] {
    return [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as FlashcardRating[];
}

function validateRating(rating: FlashcardRating) {
    if (!toRatings().includes(rating)) {
        throw new ValidationError(`Invalid flashcard rating '${rating}'.`);
    }
}
