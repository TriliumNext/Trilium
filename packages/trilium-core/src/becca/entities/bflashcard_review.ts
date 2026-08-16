import type { FlashcardRating, FlashcardReviewRow, FlashcardState } from "@triliumnext/commons";

import dateUtils from "../../services/utils/date";
import AbstractBeccaEntity from "./abstract_becca_entity.js";

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
            "scheduledDays",
            "learningSteps",
            "reviewedAt",
            "durationMs",
            "algorithm",
            "algorithmVersion",
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
    scheduledDays!: number;
    learningSteps!: number;
    reviewedAt!: string;
    durationMs?: number | null;
    algorithm!: string;
    algorithmVersion!: string;
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
        this.scheduledDays = row.scheduledDays;
        this.learningSteps = row.learningSteps;
        this.reviewedAt = row.reviewedAt;
        this.durationMs = row.durationMs ?? null;
        this.algorithm = row.algorithm;
        this.algorithmVersion = row.algorithmVersion;
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
            scheduledDays: this.scheduledDays,
            learningSteps: this.learningSteps,
            reviewedAt: this.reviewedAt,
            durationMs: this.durationMs,
            algorithm: this.algorithm,
            algorithmVersion: this.algorithmVersion,
            clientRequestId: this.clientRequestId,
            utcDateCreated: this.utcDateCreated,
            utcDateModified: this.utcDateModified
        };
    }
}

export default BFlashcardReview;
