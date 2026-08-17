export const FLASHCARD_STATES = [0, 1, 2, 3] as const;
export type FlashcardState = (typeof FLASHCARD_STATES)[number];

export const FLASHCARD_RATINGS = [1, 2, 3, 4] as const;
export type FlashcardRating = (typeof FLASHCARD_RATINGS)[number];

export interface FlashcardRow {
    cardId?: string;
    noteId: string;
    deckNoteId: string;
    ordinal?: number;
    state: FlashcardState;
    due: string;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    learningSteps: number;
    reps: number;
    lapses: number;
    lastReview?: string | null;
    suspended?: boolean;
    algorithm?: string;
    algorithmVersion?: string;
    schedulingRevision?: number;
    utcDateCreated?: string;
    utcDateModified?: string;
    isDeleted?: boolean;
    deleteId?: string | null;
}

export interface FlashcardCardSummary {
    cardId: string;
    noteId: string;
    deckNoteId: string;
    noteTitle: string;
    deckTitle: string;
    state: FlashcardState;
    due: string;
    suspended: boolean;
    schedulingRevision: number;
}

export interface FlashcardReviewCard extends FlashcardCardSummary {
    front: string;
    back?: string;
    previews: FlashcardReviewPreview[];
}

export interface FlashcardReviewPreview {
    rating: FlashcardRating;
    due: string;
    scheduledDays: number;
    state: FlashcardState;
}

export interface FlashcardCreateRequest {
    noteId: string;
    deckNoteId?: string;
}

export interface FlashcardReviewRequest {
    rating: FlashcardRating;
    durationMs?: number;
    expectedSchedulingRevision?: number;
    clientRequestId?: string;
}

export interface FlashcardSuspensionRequest {
    suspended: boolean;
    expectedSchedulingRevision?: number;
}

export interface FlashcardResetRequest {
    expectedSchedulingRevision?: number;
}

export interface FlashcardActionResponse {
    card: FlashcardReviewCard;
}

export interface FlashcardReviewResponse {
    card: FlashcardCardSummary;
    reviewId: string;
    previews: FlashcardReviewPreview[];
}

export interface FlashcardDueResponse {
    cards: FlashcardReviewCard[];
}

export interface FlashcardStatsResponse {
    dueCount: number;
    newCount: number;
    learningCount: number;
    reviewCount: number;
    suspendedCount: number;
}

export interface FlashcardRemoveResponse {
    removedCount: number;
}

export interface FlashcardReviewRow {
    reviewId?: string;
    cardId: string;
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
    durationMs?: number | null;
    algorithm: string;
    algorithmVersion: string;
    clientRequestId?: string | null;
    utcDateCreated?: string;
    utcDateModified?: string;
}
