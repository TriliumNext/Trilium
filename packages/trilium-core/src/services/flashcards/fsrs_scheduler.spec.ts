import type { FlashcardRow } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import {
    createEmptyFlashcardSchedule,
    DEFAULT_FLASHCARD_SCHEDULER_CONFIG_JSON,
    FSRS_ALGORITHM,
    FSRS_ALGORITHM_VERSION,
    getFlashcardRetrievability,
    previewFlashcard,
    scheduleFlashcard,
    type FlashcardSchedulerConfig
} from "./fsrs_scheduler.js";

const TEST_CONFIG: FlashcardSchedulerConfig = {
    requestRetention: 0.9,
    maximumInterval: 36500,
    enableFuzz: false,
    enableShortTerm: true,
    learningSteps: ["1m", "10m"],
    relearningSteps: ["10m"],
    dailyNewCardLimit: 20,
    dailyReviewLimit: 200,
    dayRolloverHour: 4
};

const NOW = new Date("2025-01-02T03:04:05.000Z");

function newCard(): FlashcardRow {
    return {
        cardId: "card1",
        noteId: "note1",
        deckNoteId: "deck1",
        ordinal: 0,
        utcDateCreated: "2025-01-01 00:00:00.000Z",
        utcDateModified: "2025-01-01 00:00:00.000Z",
        isDeleted: false,
        deleteId: null,
        ...createEmptyFlashcardSchedule(NOW)
    };
}

describe("FSRS flashcard scheduler", () => {
    it("creates empty FSRS card state", () => {
        const card = createEmptyFlashcardSchedule(NOW);

        expect(card).toMatchObject({
            state: 0,
            due: "2025-01-02 03:04:05.000Z",
            stability: 0,
            difficulty: 0,
            reps: 0,
            lapses: 0,
            algorithm: FSRS_ALGORITHM,
            algorithmVersion: FSRS_ALGORITHM_VERSION,
            schedulerConfig: DEFAULT_FLASHCARD_SCHEDULER_CONFIG_JSON,
            schedulingRevision: 0
        });
    });

    it("previews all four review outcomes without mutating source card", () => {
        const card = newCard();
        const before = { ...card };
        const previews = previewFlashcard(card, NOW, TEST_CONFIG);

        expect(previews.map((preview) => preview.rating)).toEqual([1, 2, 3, 4]);
        expect(previews.every((preview) => preview.due.length > 0)).toBe(true);
        expect(card).toEqual(before);
    });

    it("matches deterministic golden vectors for new and review cards", () => {
        expect(previewFlashcard(newCard(), NOW, TEST_CONFIG)).toEqual([
            { rating: 1, due: "2025-01-02 03:05:05.000Z", scheduledDays: 0, state: 1 },
            { rating: 2, due: "2025-01-02 03:10:05.000Z", scheduledDays: 0, state: 1 },
            { rating: 3, due: "2025-01-02 03:14:05.000Z", scheduledDays: 0, state: 1 },
            { rating: 4, due: "2025-01-10 03:04:05.000Z", scheduledDays: 8, state: 2 }
        ]);

        expect(previewFlashcard({
            ...newCard(),
            state: 2,
            due: "2025-01-10 03:04:05.000Z",
            stability: 8.2956,
            difficulty: 1,
            elapsedDays: 10,
            scheduledDays: 8,
            reps: 1,
            lastReview: "2025-01-02 03:04:05.000Z"
        }, new Date("2025-01-12T03:04:05.000Z"), TEST_CONFIG)).toEqual([
            { rating: 1, due: "2025-01-12 03:14:05.000Z", scheduledDays: 0, state: 3 },
            { rating: 2, due: "2025-02-11 03:04:05.000Z", scheduledDays: 30, state: 2 },
            { rating: 3, due: "2025-02-25 03:04:05.000Z", scheduledDays: 44, state: 2 },
            { rating: 4, due: "2025-03-28 03:04:05.000Z", scheduledDays: 75, state: 2 }
        ]);
    });

    it("applies rating and returns next card state plus review log", () => {
        const card = newCard();
        const result = scheduleFlashcard(card, 3, NOW, TEST_CONFIG);

        expect(result.card.reps).toBe(1);
        expect(result.card.schedulingRevision).toBe(1);
        expect(result.card.algorithm).toBe(FSRS_ALGORITHM);
        expect(result.card.algorithmVersion).toBe(FSRS_ALGORITHM_VERSION);
        expect(JSON.parse(result.card.schedulerConfig || "{}")).toMatchObject({
            enableFuzz: false,
            requestRetention: 0.9
        });
        expect(result.log.rating).toBe(3);
        expect(result.log.reviewedAt).toBe("2025-01-02 03:04:05.000Z");
        expect(result.log.dueBefore).toBe(card.due);
        expect(result.log.dueAfter).toBe(result.card.due);
        expect(result.log.schedulerConfig).toBe(result.card.schedulerConfig);
    });

    it("uses persisted scheduler config when no explicit config is passed", () => {
        const card = {
            ...newCard(),
            schedulerConfig: JSON.stringify({
                ...TEST_CONFIG,
                maximumInterval: 10,
                weights: null
            })
        };
        const result = scheduleFlashcard(card, 3, NOW);

        expect(JSON.parse(result.card.schedulerConfig || "{}")).toMatchObject({
            maximumInterval: 10,
            enableFuzz: false
        });
    });

    it("computes retrievability without mutating source card", () => {
        const reviewed = {
            ...newCard(),
            ...scheduleFlashcard(newCard(), 3, NOW, TEST_CONFIG).card
        };
        const before = { ...reviewed };
        const retrievability = getFlashcardRetrievability(reviewed, NOW, TEST_CONFIG);

        expect(retrievability).toBeGreaterThanOrEqual(0);
        expect(retrievability).toBeLessThanOrEqual(1);
        expect(reviewed).toEqual(before);
    });

    it("handles calendar boundary dates through canonical UTC strings", () => {
        const card = {
            ...newCard(),
            due: "2024-02-29 23:59:00.000Z"
        };
        const previews = previewFlashcard(card, new Date("2024-03-01T00:01:00.000Z"), TEST_CONFIG);

        expect(previews).toHaveLength(4);
        expect(previews.every((preview) => preview.due.endsWith("Z"))).toBe(true);
    });

    it("rejects malformed persisted card state before previewing", () => {
        expect(() => previewFlashcard({
            ...newCard(),
            due: "not-a-date"
        }, NOW, TEST_CONFIG)).toThrow("Invalid flashcard due");

        expect(() => previewFlashcard({
            ...newCard(),
            state: 9 as FlashcardRow["state"]
        }, NOW, TEST_CONFIG)).toThrow("Invalid flashcard state '9'");

        expect(() => previewFlashcard({
            ...newCard(),
            reps: -1
        }, NOW, TEST_CONFIG)).toThrow("Flashcard reps must be a non-negative integer.");
    });

    it("rejects corrupted persisted scheduler config", () => {
        expect(() => previewFlashcard({
            ...newCard(),
            schedulerConfig: "{not-json"
        }, NOW)).toThrow("Invalid flashcard scheduler config JSON");

        expect(() => previewFlashcard({
            ...newCard(),
            schedulerConfig: JSON.stringify({
                ...TEST_CONFIG,
                enableFuzz: "yes"
            })
        }, NOW)).toThrow("Flashcard enableFuzz must be a boolean.");
    });

    it("rejects invalid scheduler configuration before applying ratings", () => {
        expect(() => scheduleFlashcard(newCard(), 3, NOW, {
            ...TEST_CONFIG,
            requestRetention: 1
        })).toThrow("Flashcard request retention must be between 0 and 1.");

        expect(() => scheduleFlashcard(newCard(), 3, NOW, {
            ...TEST_CONFIG,
            maximumInterval: 0
        })).toThrow("Flashcard maximumInterval must be a positive integer.");

        expect(() => scheduleFlashcard(newCard(), 3, NOW, {
            ...TEST_CONFIG,
            learningSteps: ["tomorrow"] as unknown as FlashcardSchedulerConfig["learningSteps"]
        })).toThrow("Invalid flashcard learningSteps[0] 'tomorrow'.");

        expect(() => scheduleFlashcard(newCard(), 3, NOW, {
            ...TEST_CONFIG,
            dailyNewCardLimit: -1
        })).toThrow("Flashcard dailyNewCardLimit must be a non-negative integer.");

        expect(() => scheduleFlashcard(newCard(), 3, NOW, {
            ...TEST_CONFIG,
            dayRolloverHour: 24
        })).toThrow("Flashcard dayRolloverHour must be an integer from 0 to 23.");
    });
});
