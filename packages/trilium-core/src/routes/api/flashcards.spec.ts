import type {
    FlashcardDecksResponse,
    FlashcardDueResponse,
    FlashcardExportPayload,
    FlashcardImportResponse,
    FlashcardPreviewResponse,
    FlashcardReviewCard,
    FlashcardReviewResponse,
    FlashcardSettingsResponse,
    FlashcardStatsResponse
} from "@triliumnext/commons";
import { beforeAll, describe, expect, it } from "vitest";

import { init as clsInit } from "../../services/context.js";
import noteService from "../../services/notes.js";
import BAttribute from "../../becca/entities/battribute.js";
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

function createFilteredDeck(title: string, query: string) {
    return clsInit(() => {
        const note = noteService.createNewNote({
            parentNoteId: "root",
            title,
            content: "",
            type: "search"
        }).note;

        new BAttribute({
            noteId: note.noteId,
            type: "label",
            name: "flashcardFilteredDeck",
            value: ""
        }).save();
        new BAttribute({
            noteId: note.noteId,
            type: "label",
            name: "searchString",
            value: query
        }).save();

        return note;
    });
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

        const targetDue = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        const setDueRes = await api.put<{ card: FlashcardReviewCard }>(
            `/api/flashcards/cards/${createRes.body.cardId}/due`,
            {
                body: {
                    due: targetDue,
                    expectedSchedulingRevision: moveDeckRes.body.card.schedulingRevision
                }
            }
        );
        expect(setDueRes.status).toBe(200);
        expect(Date.parse(setDueRes.body.card.due)).toBeCloseTo(Date.parse(targetDue), -1);

        const badDueRes = await api.put<{ message: string }>(
            `/api/flashcards/cards/${createRes.body.cardId}/due`,
            { body: { due: "nope" } }
        );
        expect(badDueRes.status).toBe(400);

        const reviewRes = await api.post<FlashcardReviewResponse>(
            `/api/flashcards/cards/${createRes.body.cardId}/reviews`,
            {
                body: {
                    rating: 3,
                    expectedSchedulingRevision: setDueRes.body.card.schedulingRevision,
                    clientRequestId: `${createRes.body.cardId}-api-review`
                }
            }
        );
        expect(reviewRes.status).toBe(200);
        expect(reviewRes.body.reviewId).toBeTruthy();
        expect(reviewRes.body.card.schedulingRevision).toBe(
            setDueRes.body.card.schedulingRevision + 1
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

    it("returns the note's card status by source note", async () => {
        const deck = createTextNote("Status deck source");
        const note = createTextNote("Status flashcard source");

        const missingRes = await api.get<unknown>(`/api/flashcards/notes/${note.noteId}/card`);
        expect(missingRes.status).toBe(200);
        expect(missingRes.body).toBeNull();

        const createRes = await api.post<FlashcardReviewCard>("/api/flashcards/cards", {
            body: { noteId: note.noteId, deckNoteId: deck.noteId }
        });
        expect(createRes.status).toBe(200);

        const statusRes = await api.get<FlashcardReviewCard | null>(
            `/api/flashcards/notes/${note.noteId}/card`
        );
        expect(statusRes.status).toBe(200);
        expect(statusRes.body).toMatchObject({
            cardId: createRes.body.cardId,
            noteId: note.noteId,
            deckNoteId: deck.noteId,
            deckTitle: "Status deck source",
            state: 0
        });

        const invalidRes = await api.get<unknown>("/api/flashcards/notes/bad!id/card");
        expect(invalidRes.status).toBe(400);
    });

    it("scopes the due queue and deck list to a filtered deck", async () => {
        const source = createTextNote("Filtered deck source");
        const createRes = await api.post<FlashcardReviewCard>("/api/flashcards/cards", {
            body: { noteId: source.noteId }
        });
        expect(createRes.status).toBe(200);

        const deck = createFilteredDeck("API filtered deck", `note.noteId = "${source.noteId}"`);

        const dueRes = await api.get<FlashcardDueResponse>("/api/flashcards/due", {
            query: { deckNoteId: deck.noteId }
        });
        expect(dueRes.status).toBe(200);
        expect(dueRes.body.cards.map((card) => card.cardId)).toContain(createRes.body.cardId);

        const decksRes = await api.get<FlashcardDecksResponse>("/api/flashcards/decks");
        expect(decksRes.body.decks.find((candidate) => candidate.deckNoteId === deck.noteId))
            .toMatchObject({
                deckTitle: "API filtered deck",
                isFiltered: true,
                totalCount: 1
            });
    });

    it("validates IDs and due queue limits", async () => {
        const createInvalidRes = await api.post<{ message: string }>("/api/flashcards/cards", {
            body: { noteId: "not valid" }
        });
        expect(createInvalidRes.status).toBe(400);
        expect(createInvalidRes.body.message).toContain("Invalid flashcard noteId");

        const badDeckFilterRes = await api.get<{ message: string }>("/api/flashcards/due", {
            query: { deckNoteId: "not valid" }
        });
        expect(badDeckFilterRes.status).toBe(400);
        expect(badDeckFilterRes.body.message).toContain("Invalid flashcard deckNoteId");

        const badLimitRes = await api.get<{ message: string }>("/api/flashcards/due", {
            query: { limit: "0" }
        });
        expect(badLimitRes.status).toBe(400);
        expect(badLimitRes.body.message).toContain("Invalid flashcard limit");

        const badCardRes = await api.get<{ message: string }>("/api/flashcards/cards/not%20valid");
        expect(badCardRes.status).toBe(400);
        expect(badCardRes.body.message).toContain("Invalid flashcard cardId");

        const note = createTextNote("API validation source");
        const createRes = await api.post<FlashcardReviewCard>("/api/flashcards/cards", {
            body: { noteId: note.noteId }
        });
        const badReviewRequestRes = await api.post<{ message: string }>(
            `/api/flashcards/cards/${createRes.body.cardId}/reviews`,
            {
                body: {
                    rating: 3,
                    expectedSchedulingRevision: createRes.body.schedulingRevision,
                    clientRequestId: "not valid"
                }
            }
        );
        expect(badReviewRequestRes.status).toBe(400);
        expect(badReviewRequestRes.body.message).toContain("Invalid flashcard clientRequestId");

        const badDurationRes = await api.post<{ message: string }>(
            `/api/flashcards/cards/${createRes.body.cardId}/reviews`,
            {
                body: {
                    rating: 3,
                    durationMs: 24 * 60 * 60 * 1000 + 1,
                    expectedSchedulingRevision: createRes.body.schedulingRevision,
                    clientRequestId: `${createRes.body.cardId}-duration`
                }
            }
        );
        expect(badDurationRes.status).toBe(400);
        expect(badDurationRes.body.message).toContain("Invalid review duration");
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

    it("exports and imports scheduling state with merge semantics", async () => {
        const deck = createTextNote("Export deck source");
        const note = createTextNote("Export flashcard source", "Exported back");

        const createRes = await api.post<FlashcardReviewCard>("/api/flashcards/cards", {
            body: { noteId: note.noteId, deckNoteId: deck.noteId }
        });
        expect(createRes.status).toBe(200);

        const exportRes = await api.get<FlashcardExportPayload>("/api/flashcards/export");
        expect(exportRes.status).toBe(200);
        expect(exportRes.body.format).toBe("trilium-flashcards");
        const exportedCard = exportRes.body.cards.find((row) => row.cardId === createRes.body.cardId);
        expect(exportedCard).toBeTruthy();

        // Importing the same payload must leave our fresh card untouched.
        const noopImportRes = await api.post<FlashcardImportResponse>("/api/flashcards/import", {
            body: { payload: exportRes.body }
        });
        expect(noopImportRes.status).toBe(200);
        expect(noopImportRes.body.createdCards).toBe(0);

        const unchangedRes = await api.get<FlashcardReviewCard>(`/api/flashcards/cards/${createRes.body.cardId}`);
        expect(unchangedRes.body.state).toBe(createRes.body.state);
        expect(unchangedRes.body.schedulingRevision).toBe(createRes.body.schedulingRevision);

        // A newer revision wins over local state.
        const newerPayload: FlashcardExportPayload = {
            ...exportRes.body,
            cards: exportRes.body.cards.map((row) =>
                row.cardId === createRes.body.cardId
                    ? { ...exportedCard!, schedulingRevision: createRes.body.schedulingRevision + 50 }
                    : row)
        };
        const updateImportRes = await api.post<FlashcardImportResponse>("/api/flashcards/import", {
            body: { payload: newerPayload }
        });
        expect(updateImportRes.status).toBe(200);

        const fetchedRes = await api.get<FlashcardReviewCard>(`/api/flashcards/cards/${createRes.body.cardId}`);
        expect(fetchedRes.status, JSON.stringify({ import: updateImportRes.body, fetched: fetchedRes.body })).toBe(200);
        expect(fetchedRes.body.schedulingRevision).toBe(createRes.body.schedulingRevision + 50);

        // Malformed payloads are rejected.
        const badImportRes = await api.post<{ message: string }>("/api/flashcards/import", {
            body: { payload: { format: "nope", formatVersion: 99, cards: [], reviews: [] } }
        });
        expect(badImportRes.status).toBe(400);
    });

    it("lists leech cards ordered by lapses", async () => {
        const deck = createTextNote("Leech deck source");
        const note = createTextNote("Leech flashcard source");

        const createRes = await api.post<FlashcardReviewCard>("/api/flashcards/cards", {
            body: { noteId: note.noteId, deckNoteId: deck.noteId }
        });
        expect(createRes.status).toBe(200);

        // Push the card over the leech threshold through an imported newer revision.
        const beforeRes = await api.get<FlashcardExportPayload>("/api/flashcards/export");
        const leechPayload: FlashcardExportPayload = {
            ...beforeRes.body,
            cards: beforeRes.body.cards.map((row) =>
                row.cardId === createRes.body.cardId
                    ? { ...row, lapses: 8, schedulingRevision: (row.schedulingRevision ?? 0) + 1 }
                    : row)
        };
        const importRes = await api.post<FlashcardImportResponse>("/api/flashcards/import", {
            body: { payload: leechPayload }
        });
        expect(importRes.body.updatedCards).toBe(1);

        const leechesRes = await api.get<{ leeches: Array<{ cardId: string; noteTitle: string; lapses: number }> }>("/api/flashcards/leeches");
        expect(leechesRes.status).toBe(200);
        const entry = leechesRes.body.leeches.find((leech) => leech.cardId === createRes.body.cardId);
        expect(entry).toBeTruthy();
        expect(entry!.noteTitle).toBe("Leech flashcard source");
        expect(entry!.lapses).toBe(8);

        // The list is ordered by lapses, descending.
        const lapses = leechesRes.body.leeches.map((leech) => leech.lapses);
        expect([ ...lapses ].sort((a, b) => b - a)).toEqual(lapses);
    });

    it("syncs cloze cards for a note through the API", async () => {
        const note = createTextNote(
            "API cloze source",
            "{{c1::alpha}} {{c2::beta}}"
        );

        const createRes = await api.post<FlashcardReviewCard>("/api/flashcards/cards", {
            body: { noteId: note.noteId }
        });
        expect(createRes.status).toBe(200);
        expect(createRes.body.cardType).toBe("cloze");

        // Remove c2 and add c3; sync reconciles the card set.
        clsInit(() => note.setContent("{{c1::alpha}} {{c3::gamma}}"));
        const syncRes = await api.post<{ createdCount: number; removedCount: number }>(
            `/api/flashcards/notes/${note.noteId}/cards/sync`
        );
        expect(syncRes.status).toBe(200);
        expect(syncRes.body).toEqual({ createdCount: 1, removedCount: 1 });

        const dueRes = await api.get<FlashcardDueResponse>("/api/flashcards/due");
        const noteCards = dueRes.body.cards.filter((card) => card.noteId === note.noteId);
        expect(noteCards.map((card) => card.ordinal)).toEqual([ 0, 2 ]);
    });
});
