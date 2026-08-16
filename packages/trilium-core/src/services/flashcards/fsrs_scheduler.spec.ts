import type { FlashcardRow } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import {
    createEmptyFlashcardSchedule,
    FSRS_ALGORITHM,
    FSRS_ALGORITHM_VERSION,
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
    relearningSteps: ["10m"]
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

    it("applies rating and returns next card state plus review log", () => {
        const card = newCard();
        const result = scheduleFlashcard(card, 3, NOW, TEST_CONFIG);

        expect(result.card.reps).toBe(1);
        expect(result.card.schedulingRevision).toBe(1);
        expect(result.card.algorithm).toBe(FSRS_ALGORITHM);
        expect(result.card.algorithmVersion).toBe(FSRS_ALGORITHM_VERSION);
        expect(result.log.rating).toBe(3);
        expect(result.log.reviewedAt).toBe("2025-01-02 03:04:05.000Z");
        expect(result.log.dueBefore).toBe(card.due);
        expect(result.log.dueAfter).toBe(result.card.due);
    });
});
