import type {
    FlashcardDecksResponse,
    FlashcardDueResponse,
    FlashcardPreviewResponse,
    FlashcardReviewCard,
    FlashcardReviewResponse,
    FlashcardSettingsResponse,
    FlashcardStatsResponse
} from "@triliumnext/commons";
import { beforeAll, describe, expect, it } from "vitest";

import { init as clsInit } from "../../services/context.js";
import noteService from "../../services/notes.js";
import { getSql } from "../../services/sql/index.js";
import { CoreApiTester } from "../../test/api_tester";

let api: CoreApiTester;

function createTextNote(title: string, content = "Back content") {
    return clsInit(() => noteService.createNewNote({
        parentNoteId: "root",
        title,
        content,
        type: "text"
    }).note);
}

describe("Flashcards API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("reads and updates validated scheduler settings", async () => {
        const getRes = await api.get<FlashcardSettingsResponse>("/api/flashcards/settings");
        expect(getRes.status).toBe(200);
        expect(getRes.body.schedulerConfig.requestRetention).toBe(0.9);

        const updateRes = await api.put<FlashcardSettingsResponse>("/api/flashcards/settings", {
            body: {
                schedulerConfig: {
                    ...getRes.body.schedulerConfig,
                    requestRetention: 0.85,
                    maximumInterval: 90,
                    enableFuzz: false
                }
            }
        });
        expect(updateRes.status).toBe(200);
        expect(updateRes.body.schedulerConfig).toMatchObject({
            requestRetention: 0.85,
            maximumInterval: 90,
            enableFuzz: false
        });

        const invalidRes = await api.put<{ message: string }>("/api/flashcards/settings", {
            body: {
                schedulerConfig: {
                    ...updateRes.body.schedulerConfig,
                    learningSteps: ["tomorrow"]
                }
            }
        });
        expect(invalidRes.status).toBe(400);
        expect(invalidRes.body.message).toContain("Invalid flashcard learningSteps");

        await api.put<FlashcardSettingsResponse>("/api/flashcards/settings", {
            body: { schedulerConfig: getRes.body.schedulerConfig }
        });
    });

    it("creates, lists, fetches, and reviews cards", async () => {
        const deck = createTextNote("API deck source");
        const note = createTextNote("API flashcard source");

        const createRes = await api.post<FlashcardReviewCard>("/api/flashcards/cards", {
            body: { noteId: note.noteId, deckNoteId: deck.noteId }
        });
        expect(createRes.status).toBe(200);
        expect(createRes.body.front).toBe("API flashcard source");
        expect(createRes.body.back).toBe("Back content");

        const decksRes = await api.get<FlashcardDecksResponse>("/api/flashcards/decks");
        expect(decksRes.status).toBe(200);
        expect(decksRes.body.decks.find((candidate) => candidate.deckNoteId === deck.noteId))
            .toMatchObject({
                deckTitle: "API deck source",
                totalCount: 1,
                dueCount: 1,
                newCount: 1,
                suspendedCount: 0
            });

        const dueRes = await api.get<FlashcardDueResponse>("/api/flashcards/due", {
            query: { limit: 5 }
        });
        expect(dueRes.status).toBe(200);
        expect(dueRes.body.cards.some((card) => card.cardId === createRes.body.cardId)).toBe(true);
        expect(dueRes.body.totalDueCount).toBeGreaterThanOrEqual(dueRes.body.cards.length);

        const getRes = await api.get<FlashcardReviewCard>(
            `/api/flashcards/cards/${createRes.body.cardId}`
        );
        expect(getRes.status).toBe(200);
        expect(getRes.body.back).toBe("Back content");

        const previewRes = await api.get<FlashcardPreviewResponse>(
            `/api/flashcards/cards/${createRes.body.cardId}/preview`
        );
        expect(previewRes.status).toBe(200);
        expect(previewRes.body.cardId).toBe(createRes.body.cardId);
        expect(previewRes.body.schedulingRevision).toBe(createRes.body.schedulingRevision);
        expect(previewRes.body.previews.map((preview) => preview.rating)).toEqual([1, 2, 3, 4]);

        const secondDeck = createTextNote("API second deck");
        const moveDeckRes = await api.put<{ card: FlashcardReviewCard }>(
            `/api/flashcards/cards/${createRes.body.cardId}/deck`,
            {
                body: {
                    deckNoteId: secondDeck.noteId,
                    expectedSchedulingRevision: createRes.body.schedulingRevision
                }
            }
        );
        expect(moveDeckRes.status).toBe(200);
        expect(moveDeckRes.body.card.deckNoteId).toBe(secondDeck.noteId);
        expect(moveDeckRes.body.card.schedulingRevision).toBe(
            createRes.body.schedulingRevision + 1
        );

        const reviewRes = await api.post<FlashcardReviewResponse>(
            `/api/flashcards/cards/${createRes.body.cardId}/reviews`,
            {
                body: {
                    rating: 3,
                    expectedSchedulingRevision: moveDeckRes.body.card.schedulingRevision,
                    clientRequestId: `${createRes.body.cardId}-api-review`
                }
            }
        );
        expect(reviewRes.status).toBe(200);
        expect(reviewRes.body.reviewId).toBeTruthy();
        expect(reviewRes.body.card.schedulingRevision).toBe(
            moveDeckRes.body.card.schedulingRevision + 1
        );

        const undoRes = await api.post<{ card: FlashcardReviewCard }>(
            "/api/flashcards/reviews/undo",
            {
                body: {
                    reviewId: reviewRes.body.reviewId,
                    expectedSchedulingRevision: reviewRes.body.card.schedulingRevision
                }
            }
        );
        expect(undoRes.status).toBe(200);
        expect(undoRes.body.card.state).toBe(createRes.body.state);
        expect(undoRes.body.card.schedulingRevision).toBe(
            reviewRes.body.card.schedulingRevision + 1
        );
    });

    it("returns conflict without writing for stale reviews", async () => {
        const note = createTextNote("API stale source");
        const createRes = await api.post<FlashcardReviewCard>("/api/flashcards/cards", {
            body: { noteId: note.noteId }
        });

        await api.post<FlashcardReviewResponse>(
            `/api/flashcards/cards/${createRes.body.cardId}/reviews`,
            {
                body: {
                    rating: 3,
                    expectedSchedulingRevision: createRes.body.schedulingRevision,
                    clientRequestId: `${createRes.body.cardId}-api-good`
                }
            }
        );

        const staleRes = await api.post<{ message: string }>(
            `/api/flashcards/cards/${createRes.body.cardId}/reviews`,
            {
                body: {
                    rating: 2,
                    expectedSchedulingRevision: createRes.body.schedulingRevision,
                    clientRequestId: `${createRes.body.cardId}-api-stale`
                }
            }
        );
        expect(staleRes.status).toBe(409);
        expect(staleRes.body.message).toContain("Refresh before reviewing");

        const reviewCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE cardId = ?`, [createRes.body.cardId]);
        expect(reviewCount).toBe(1);
    });

    it("suspends, resumes, and resets cards", async () => {
        const note = createTextNote("API lifecycle source");
        const createRes = await api.post<FlashcardReviewCard>("/api/flashcards/cards", {
            body: { noteId: note.noteId }
        });

        const suspendRes = await api.put<{ card: FlashcardReviewCard }>(
            `/api/flashcards/cards/${createRes.body.cardId}/suspended`,
            {
                body: {
                    suspended: true,
                    expectedSchedulingRevision: createRes.body.schedulingRevision
                }
            }
        );
        expect(suspendRes.status).toBe(200);
        expect(suspendRes.body.card.suspended).toBe(true);

        const resumeRes = await api.put<{ card: FlashcardReviewCard }>(
            `/api/flashcards/cards/${createRes.body.cardId}/suspended`,
            {
                body: {
                    suspended: false,
                    expectedSchedulingRevision: suspendRes.body.card.schedulingRevision
                }
            }
        );
        expect(resumeRes.status).toBe(200);
        expect(resumeRes.body.card.suspended).toBe(false);

        const buryRes = await api.post<{ card: FlashcardReviewCard }>(
            `/api/flashcards/cards/${createRes.body.cardId}/bury`,
            {
                body: {
                    expectedSchedulingRevision: resumeRes.body.card.schedulingRevision
                }
            }
        );
        expect(buryRes.status).toBe(200);
        expect(Date.parse(buryRes.body.card.due)).toBeGreaterThan(
            Date.now() + 23 * 60 * 60 * 1000
        );

        const resetRes = await api.post<{ card: FlashcardReviewCard }>(
            `/api/flashcards/cards/${createRes.body.cardId}/reset`,
            {
                body: {
                    expectedSchedulingRevision: buryRes.body.card.schedulingRevision
                }
            }
        );
        expect(resetRes.status).toBe(200);
        expect(resetRes.body.card.state).toBe(0);
        expect(resetRes.body.card.suspended).toBe(false);
    });

    it("returns stats and removes cards for a note", async () => {
        const note = createTextNote("API remove source");
        const createRes = await api.post<FlashcardReviewCard>("/api/flashcards/cards", {
            body: { noteId: note.noteId }
        });

        const statsRes = await api.get<FlashcardStatsResponse>("/api/flashcards/stats");
        expect(statsRes.status).toBe(200);
        expect(statsRes.body.dueCount).toBeGreaterThanOrEqual(1);
        expect(statsRes.body.reviewedTodayCount).toBeGreaterThanOrEqual(0);
        expect(statsRes.body.ratingCounts[1]).toBeGreaterThanOrEqual(0);
        expect(statsRes.body.ratingCounts[2]).toBeGreaterThanOrEqual(0);
        expect(statsRes.body.ratingCounts[3]).toBeGreaterThanOrEqual(0);
        expect(statsRes.body.ratingCounts[4]).toBeGreaterThanOrEqual(0);
        expect(statsRes.body.lapseCount).toBeGreaterThanOrEqual(0);
        expect(statsRes.body.dueForecast).toHaveLength(7);

        const removeRes = await api.delete<{ removedCount: number }>(
            `/api/flashcards/notes/${note.noteId}/cards`
        );
        expect(removeRes.status).toBe(200);
        expect(removeRes.body.removedCount).toBe(1);

        const getRemovedRes = await api.get<{ message: string }>(
            `/api/flashcards/cards/${createRes.body.cardId}`
        );
        expect(getRemovedRes.status).toBe(404);
    });
});
