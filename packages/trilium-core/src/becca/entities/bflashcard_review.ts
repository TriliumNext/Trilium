import type { FlashcardRating, FlashcardReviewRow, FlashcardState } from "@triliumnext/commons";

import dateUtils from "../../services/utils/date";
import AbstractBeccaEntity from "./abstract_becca_entity.js";

const DEFAULT_SCHEDULER_CONFIG_JSON = JSON.stringify({
    requestRetention: 0.9,
    maximumInterval: 36500,
    enableFuzz: true,
    enableShortTerm: true,
    learningSteps: ["1m", "10m"],
    relearningSteps: ["10m"],
    weights: null
});

class BFlashcardReview extends AbstractBeccaEntity<BFlashcardReview> {
    static get entityName() {
        return "flashcard_reviews";
    }

    static get primaryKeyName() {
        return "reviewId";
    }

    static get hashedProperties() {
        return [
            "reviewId",
            "cardId",
            "rating",
            "state",
            "dueBefore",
            "dueAfter",
            "stabilityBefore",
            "stabilityAfter",
            "difficultyBefore",
            "difficultyAfter",
            "elapsedDays",
            "elapsedDaysBefore",
            "scheduledDays",
            "scheduledDaysBefore",
            "learningSteps",
            "learningStepsBefore",
            "repsBefore",
            "lapsesBefore",
            "lastReviewBefore",
            "schedulingRevisionBefore",
            "schedulingRevisionAfter",
            "reviewedAt",
            "durationMs",
            "algorithm",
            "algorithmVersion",
            "schedulerConfig",
            "clientRequestId",
            "utcDateCreated",
            "utcDateModified"
        ];
    }

    reviewId?: string;
    cardId!: string;
    rating!: FlashcardRating;
    state!: FlashcardState;
    dueBefore!: string;
    dueAfter!: string;
    stabilityBefore!: number;
    stabilityAfter!: number;
    difficultyBefore!: number;
    difficultyAfter!: number;
    elapsedDays!: number;
    elapsedDaysBefore!: number;
    scheduledDays!: number;
    scheduledDaysBefore!: number;
    learningSteps!: number;
    learningStepsBefore!: number;
    repsBefore!: number;
    lapsesBefore!: number;
    lastReviewBefore?: string | null;
    schedulingRevisionBefore!: number;
    schedulingRevisionAfter!: number;
    reviewedAt!: string;
    durationMs?: number | null;
    algorithm!: string;
    algorithmVersion!: string;
    schedulerConfig!: string;
    clientRequestId?: string | null;

    constructor(row?: FlashcardReviewRow) {
        super();

        if (!row) {
            return;
        }

        this.updateFromRow(row);
    }

    updateFromRow(row: FlashcardReviewRow) {
        this.reviewId = row.reviewId;
        this.cardId = row.cardId;
        this.rating = row.rating;
        this.state = row.state;
        this.dueBefore = row.dueBefore;
        this.dueAfter = row.dueAfter;
        this.stabilityBefore = row.stabilityBefore;
        this.stabilityAfter = row.stabilityAfter;
        this.difficultyBefore = row.difficultyBefore;
        this.difficultyAfter = row.difficultyAfter;
        this.elapsedDays = row.elapsedDays;
        this.elapsedDaysBefore = row.elapsedDaysBefore;
        this.scheduledDays = row.scheduledDays;
        this.scheduledDaysBefore = row.scheduledDaysBefore;
        this.learningSteps = row.learningSteps;
        this.learningStepsBefore = row.learningStepsBefore;
        this.repsBefore = row.repsBefore;
        this.lapsesBefore = row.lapsesBefore;
        this.lastReviewBefore = row.lastReviewBefore ?? null;
        this.schedulingRevisionBefore = row.schedulingRevisionBefore;
        this.schedulingRevisionAfter = row.schedulingRevisionAfter;
        this.reviewedAt = row.reviewedAt;
        this.durationMs = row.durationMs ?? null;
        this.algorithm = row.algorithm;
        this.algorithmVersion = row.algorithmVersion;
        this.schedulerConfig = row.schedulerConfig ?? DEFAULT_SCHEDULER_CONFIG_JSON;
        this.clientRequestId = row.clientRequestId ?? null;
        this.utcDateCreated = row.utcDateCreated || dateUtils.utcNowDateTime();
        this.utcDateModified = row.utcDateModified || this.utcDateCreated;
    }

    override beforeSaving() {
        const now = dateUtils.utcNowDateTime();

        if (!this.utcDateCreated) {
            this.utcDateCreated = now;
        }

        this.utcDateModified = now;

        super.beforeSaving();
    }

    getPojo() {
        return {
            reviewId: this.reviewId,
            cardId: this.cardId,
            rating: this.rating,
            state: this.state,
            dueBefore: this.dueBefore,
            dueAfter: this.dueAfter,
            stabilityBefore: this.stabilityBefore,
            stabilityAfter: this.stabilityAfter,
            difficultyBefore: this.difficultyBefore,
            difficultyAfter: this.difficultyAfter,
            elapsedDays: this.elapsedDays,
            elapsedDaysBefore: this.elapsedDaysBefore,
            scheduledDays: this.scheduledDays,
            scheduledDaysBefore: this.scheduledDaysBefore,
            learningSteps: this.learningSteps,
            learningStepsBefore: this.learningStepsBefore,
            repsBefore: this.repsBefore,
            lapsesBefore: this.lapsesBefore,
            lastReviewBefore: this.lastReviewBefore,
            schedulingRevisionBefore: this.schedulingRevisionBefore,
            schedulingRevisionAfter: this.schedulingRevisionAfter,
            reviewedAt: this.reviewedAt,
            durationMs: this.durationMs,
            algorithm: this.algorithm,
            algorithmVersion: this.algorithmVersion,
            schedulerConfig: this.schedulerConfig,
            clientRequestId: this.clientRequestId,
            utcDateCreated: this.utcDateCreated,
            utcDateModified: this.utcDateModified
        };
    }
}

export default BFlashcardReview;
