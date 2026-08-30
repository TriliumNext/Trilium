import type {
    EntityChangeRecord,
    EntityRow,
    FlashcardReviewRow,
    FlashcardRow
} from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import BAttribute from "../../becca/entities/battribute.js";
import BFlashcard from "../../becca/entities/bflashcard.js";
import BFlashcardReview from "../../becca/entities/bflashcard_review.js";
import { init as clsInit } from "../context.js";
import noteService from "../notes.js";
import dateUtils from "../utils/date";
import { getSql } from "../sql/index.js";
import syncUpdateService from "../sync_update.js";
import flashcardService from "./flashcard_service.js";

function createTextNote(title: string, content = "Back content") {
    return clsInit(() => noteService.createNewNote({
        parentNoteId: "root",
        title,
        content,
        type: "text"
    }).note);
}

function runInContext<T>(fn: () => T) {
    return clsInit(fn);
}

function makeReviewCardDue(cardId: string, due = "2020-01-01 00:00:00.000Z") {
    getSql().execute(/*sql*/`
        UPDATE flashcards
        SET state = 2, due = ?, stability = 5, difficulty = 5,
            lastReview = '2019-12-31 00:00:00.000Z', reps = 1, scheduledDays = 3
        WHERE cardId = ?`, [due, cardId]);
}

function moveDueDate(cardId: string, due: string) {
    getSql().execute(/*sql*/`
        UPDATE flashcards
        SET due = ?
        WHERE cardId = ?`, [due, cardId]);
}

function countReviewsTodayByState(state: number) {
    return getSql().getValue<number>(/*sql*/`
        SELECT COUNT(1) FROM flashcard_reviews
        WHERE state = ?
          AND reviewedAt >= ?`, [state, `${dateUtils.utcDateStr(new Date())} 00:00:00.000Z`]) ?? 0;
}

function syncedEntity(
    entityName: string,
    entityId: string,
    entity: FlashcardRow | FlashcardReviewRow
): EntityChangeRecord {
    return {
        entityChange: {
            entityName,
            entityId,
            hash: `${entityId}-hash-${entity.utcDateModified}`,
            utcDateChanged: entity.utcDateModified,
            isSynced: true,
            isErased: false,
            changeId: `${entityId}-change-${entity.utcDateModified}`
        },
        entity: entity as unknown as EntityRow
    };
}

describe("flashcard service", () => {
    it("creates one flashcard per note and adds the marker label", () => {
        const note = createTextNote("Flashcard source");

        const first = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        const second = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        expect(first.cardId).toBeTruthy();
        expect(second.cardId).toBe(first.cardId);
        expect(first.front).toBe("Flashcard source");
        expect(first.back).toBe("Back content");
        expect(note.hasLabel("flashcard")).toBe(true);

        const rowCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE noteId = ? AND isDeleted = 0`, [note.noteId]);
        expect(rowCount).toBe(1);
    });

    it("creates and renders one basic card per custom template", () => {
        const note = createTextNote("Template source", "<p>Template back</p>");

        const saved = runInContext(() => flashcardService.setTemplates(note.noteId, {
            templates: [
                { name: "Forward", front: "{{title}}", back: "{{content}}" },
                { name: "Reverse", front: "{{content}}", back: "{{title}} #{{ordinal}}" }
            ]
        }));
        const first = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        const sync = runInContext(() => flashcardService.syncNoteCards(note.noteId));
        const rows = getSql().getRows<FlashcardRow>(/*sql*/`
            SELECT * FROM flashcards
            WHERE noteId = ? AND isDeleted = 0
            ORDER BY ordinal`, [note.noteId]);
        const second = runInContext(() => flashcardService.getCard(rows[1]?.cardId || ""));

        expect(saved.templates.map((template) => template.name)).toEqual(["Forward", "Reverse"]);
        expect(first.front).toBe("Template source");
        expect(first.frontIsHtml).toBe(true);
        expect(note.hasLabel("flashcard")).toBe(true);
        expect(first.back).toBe("<p>Template back</p>");
        expect(sync).toEqual({ createdCount: 0, removedCount: 0 });
        expect(rows.map((row) => row.ordinal)).toEqual([0, 1]);
        expect(second.front).toBe("<p>Template back</p>");
        expect(second.back).toBe("Template source #2");

        const trimmed = runInContext(() => flashcardService.setTemplates(note.noteId, {
            templates: [ { name: "Only", front: "{{title}}", back: "{{content}}" } ]
        }));
        const liveCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE noteId = ? AND isDeleted = 0`, [note.noteId]);

        expect(trimmed.templates).toHaveLength(1);
        expect(liveCount).toBe(1);
    });

    it("uses imported rich front HTML when present", () => {
        const note = createTextNote("Imported plain title", "Rendered back");
        runInContext(() => new BAttribute({
            noteId: note.noteId,
            type: "label",
            name: "flashcardFrontHtml",
            value: "<img src=\"front.png\"><b>Rich front</b>",
            isInheritable: false
        }).save());

        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        expect(card.front).toBe("<img src=\"front.png\"><b>Rich front</b>");
        expect(card.frontIsHtml).toBe(true);
        expect(card.back).toBe("Rendered back");
    });

    it("previews review outcomes without writing rows or entity changes", () => {
        const note = createTextNote("Preview source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        const reviewCountBefore = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews`);
        const entityChangeCountBefore = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM entity_changes`);

        const preview = runInContext(() => flashcardService.getPreview(card.cardId));
        const storedCard = runInContext(() => flashcardService.getCard(card.cardId, {
            includeBack: false
        }));

        expect(preview.cardId).toBe(card.cardId);
        expect(preview.schedulingRevision).toBe(card.schedulingRevision);
        expect(preview.previews.map((item) => item.rating)).toEqual([1, 2, 3, 4]);
        expect(storedCard.schedulingRevision).toBe(card.schedulingRevision);
        expect(getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews`)).toBe(reviewCountBefore);
        expect(getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM entity_changes`)).toBe(entityChangeCountBefore);
    });

    it("applies validated scheduler settings to new cards and reviews", () => {
        const originalSettings = runInContext(() => flashcardService.getSettings());
        const note = createTextNote("Settings source");

        runInContext(() => flashcardService.setSettings({
            schedulerConfig: {
                ...originalSettings.schedulerConfig,
                maximumInterval: 42,
                enableFuzz: false
            }
        }));

        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        const cardConfig = getSql().getValue<string>(/*sql*/`
            SELECT schedulerConfig FROM flashcards
            WHERE cardId = ?`, [card.cardId]);
        expect(JSON.parse(cardConfig || "{}")).toMatchObject({
            maximumInterval: 42,
            enableFuzz: false
        });

        const review = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId: `${card.cardId}-settings`
        }));
        const reviewConfig = getSql().getValue<string>(/*sql*/`
            SELECT schedulerConfig FROM flashcard_reviews
            WHERE reviewId = ?`, [review.reviewId]);
        expect(JSON.parse(reviewConfig || "{}")).toMatchObject({
            maximumInterval: 42,
            enableFuzz: false
        });

        expect(() => runInContext(() => flashcardService.setSettings({
            schedulerConfig: {
                ...originalSettings.schedulerConfig,
                requestRetention: 1
            }
        }))).toThrow("Flashcard request retention must be between 0 and 1.");

        runInContext(() => flashcardService.setSettings(originalSettings));
    });

    it("includes scheduler config snapshots in flashcard sync hashes", () => {
        const note = createTextNote("Sync hash source");
        const originalSettings = runInContext(() => flashcardService.getSettings());

        runInContext(() => flashcardService.setSettings({
            schedulerConfig: {
                ...originalSettings.schedulerConfig,
                maximumInterval: 42
            }
        }));

        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        const reviewed = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId: `${card.cardId}-sync-hash`
        }));
        const flashcard = becca.getFlashcard(card.cardId);
        const flashcardReview = becca.getFlashcardReview(reviewed.reviewId);

        if (!flashcard || !flashcardReview) {
            throw new Error("Expected synced flashcard entities.");
        }

        const changedConfig = JSON.stringify({
            ...originalSettings.schedulerConfig,
            maximumInterval: 43
        });
        const changedCard = new BFlashcard({
            ...flashcard.getPojo(),
            schedulerConfig: changedConfig
        });
        const changedReview = new BFlashcardReview({
            ...flashcardReview.getPojo(),
            schedulerConfig: changedConfig
        });

        expect(flashcard.schedulerConfig).toContain("maximumInterval");
        expect(flashcardReview.schedulerConfig).toContain("maximumInterval");
        expect(changedCard.generateHash()).not.toBe(flashcard.generateHash());
        expect(changedReview.generateHash()).not.toBe(flashcardReview.generateHash());

        runInContext(() => flashcardService.setSettings(originalSettings));
    });

    it("applies synced erasures for flashcards and review logs", () => {
        const note = createTextNote("Sync erase source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        const reviewed = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId: `${card.cardId}-sync-erase`
        }));

        runInContext(() => syncUpdateService.updateEntities([
            {
                entityChange: {
                    entityName: "flashcard_reviews",
                    entityId: reviewed.reviewId,
                    hash: "deleted",
                    isErased: true,
                    utcDateChanged: "2999-01-01 00:00:00.000Z",
                    isSynced: true,
                    changeId: `${reviewed.reviewId}-erased`
                },
                entity: undefined
            },
            {
                entityChange: {
                    entityName: "flashcards",
                    entityId: card.cardId,
                    hash: "deleted",
                    isErased: true,
                    utcDateChanged: "2999-01-01 00:00:00.000Z",
                    isSynced: true,
                    changeId: `${card.cardId}-erased`
                },
                entity: undefined
            }
        ], "remote-instance"));

        expect(getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE reviewId = ?`, [reviewed.reviewId])).toBe(0);
        expect(getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE cardId = ?`, [card.cardId])).toBe(0);
    });

    it("applies synced flashcard and review rows in either order", () => {
        const source = createTextNote("Synced source");
        const deck = createTextNote("Synced deck");
        const schedulerConfig = JSON.stringify(flashcardService.getSettings().schedulerConfig);
        const cardRow: FlashcardRow = {
            cardId: "syncedFlashcard01",
            noteId: source.noteId,
            deckNoteId: deck.noteId,
            ordinal: 0,
            state: 2,
            due: "2025-01-01 00:00:00.000Z",
            stability: 5,
            difficulty: 5,
            elapsedDays: 1,
            scheduledDays: 1,
            learningSteps: 0,
            reps: 1,
            lapses: 0,
            lastReview: "2024-12-31 00:00:00.000Z",
            suspended: false,
            algorithm: "fsrs-6",
            algorithmVersion: "ts-fsrs@5.4.1",
            schedulerConfig,
            schedulingRevision: 1,
            utcDateCreated: "2025-01-01 00:00:00.000Z",
            utcDateModified: "2025-01-01 00:00:00.000Z",
            isDeleted: false,
            deleteId: null
        };
        const reviewRow: FlashcardReviewRow = {
            reviewId: "syncedReview01",
            cardId: cardRow.cardId || "",
            rating: 3,
            state: 0,
            dueBefore: "2024-12-31 00:00:00.000Z",
            dueAfter: cardRow.due,
            stabilityBefore: 0,
            stabilityAfter: cardRow.stability,
            difficultyBefore: 0,
            difficultyAfter: cardRow.difficulty,
            elapsedDays: 0,
            elapsedDaysBefore: 0,
            scheduledDays: 0,
            scheduledDaysBefore: 0,
            learningSteps: 0,
            learningStepsBefore: 0,
            repsBefore: 0,
            lapsesBefore: 0,
            lastReviewBefore: null,
            schedulingRevisionBefore: 0,
            schedulingRevisionAfter: 1,
            reviewedAt: "2025-01-01 00:00:00.000Z",
            durationMs: 123,
            algorithm: cardRow.algorithm || "fsrs-6",
            algorithmVersion: cardRow.algorithmVersion || "ts-fsrs@5.4.1",
            schedulerConfig,
            clientRequestId: "syncedRequest01",
            utcDateCreated: "2025-01-01 00:00:00.000Z",
            utcDateModified: "2025-01-01 00:00:00.000Z"
        };

        runInContext(() => syncUpdateService.updateEntities([
            syncedEntity("flashcard_reviews", reviewRow.reviewId || "", reviewRow),
            syncedEntity("flashcards", cardRow.cardId || "", cardRow)
        ], "remote-instance"));

        expect(getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE reviewId = ?`, [reviewRow.reviewId])).toBe(1);
        expect(becca.getFlashcard(cardRow.cardId || "")?.deckNoteId).toBe(deck.noteId);
        expect(becca.getFlashcardReview(reviewRow.reviewId || "")?.cardId).toBe(cardRow.cardId);

        runInContext(() => syncUpdateService.updateEntities([
            syncedEntity("flashcards", cardRow.cardId || "", {
                ...cardRow,
                due: "2025-01-02 00:00:00.000Z",
                schedulingRevision: 2,
                utcDateModified: "2025-01-02 00:00:00.000Z"
            })
        ], "remote-instance"));

        expect(flashcardService.getCard(cardRow.cardId || "").schedulingRevision).toBe(2);
    });

    it("returns deck summaries with safe counts", () => {
        const firstDeck = createTextNote("Deck A");
        const secondDeck = createTextNote("Deck B");
        const firstNote = createTextNote("Deck A card one");
        const secondNote = createTextNote("Deck A card two");
        const thirdNote = createTextNote("Deck B card one");

        const firstCard = runInContext(() => flashcardService.createCard({
            noteId: firstNote.noteId,
            deckNoteId: firstDeck.noteId
        }));
        const secondCard = runInContext(() => flashcardService.createCard({
            noteId: secondNote.noteId,
            deckNoteId: firstDeck.noteId
        }));
        runInContext(() => flashcardService.createCard({
            noteId: thirdNote.noteId,
            deckNoteId: secondDeck.noteId
        }));
        runInContext(() => flashcardService.setSuspended(secondCard.cardId, {
            suspended: true,
            expectedSchedulingRevision: secondCard.schedulingRevision
        }));

        const decks = runInContext(() => flashcardService.getDecks().decks);
        const firstSummary = decks.find((deck) => deck.deckNoteId === firstDeck.noteId);
        const secondSummary = decks.find((deck) => deck.deckNoteId === secondDeck.noteId);

        expect(firstSummary).toMatchObject({
            deckTitle: "Deck A",
            totalCount: 2,
            dueCount: 1,
            newCount: 1,
            learningCount: 0,
            reviewCount: 0,
            suspendedCount: 1
        });
        expect(secondSummary).toMatchObject({
            deckTitle: "Deck B",
            totalCount: 1,
            dueCount: 1,
            newCount: 1,
            learningCount: 0,
            reviewCount: 0,
            suspendedCount: 0
        });
        expect(firstSummary).toBeDefined();
        expect(secondSummary).toBeDefined();
        if (!firstSummary || !secondSummary) {
            throw new Error("Expected both flashcard deck summaries.");
        }
        expect(decks.indexOf(firstSummary)).toBeLessThan(decks.indexOf(secondSummary));
        expect(firstCard.deckTitle).toBe("Deck A");
    });

    it("returns due cards in stable order with limit and total count", () => {
        const deck = createTextNote("Due queue deck");
        const emptyDeck = createTextNote("Empty due queue deck");
        const firstNote = createTextNote("Due queue first");
        const secondNote = createTextNote("Due queue second");
        const thirdNote = createTextNote("Due queue third");
        const futureNote = createTextNote("Due queue future");
        const firstCard = runInContext(() => flashcardService.createCard({
            noteId: firstNote.noteId,
            deckNoteId: deck.noteId
        }));
        const secondCard = runInContext(() => flashcardService.createCard({
            noteId: secondNote.noteId,
            deckNoteId: deck.noteId
        }));
        const thirdCard = runInContext(() => flashcardService.createCard({
            noteId: thirdNote.noteId,
            deckNoteId: deck.noteId
        }));
        const futureCard = runInContext(() => flashcardService.createCard({
            noteId: futureNote.noteId,
            deckNoteId: deck.noteId
        }));

        getSql().execute(/*sql*/`
            UPDATE flashcards
            SET due = ?, state = 2, stability = 5, difficulty = 5,
                lastReview = '2019-12-31 00:00:00.000Z', reps = 1, scheduledDays = 3
            WHERE cardId = ?`, [
            "2020-01-03 00:00:00.000Z",
            firstCard.cardId
        ]);
        getSql().execute("UPDATE flashcards SET due = ? WHERE cardId = ?", [
            "2020-01-01 00:00:00.000Z",
            secondCard.cardId
        ]);
        getSql().execute("UPDATE flashcards SET due = ? WHERE cardId = ?", [
            "2020-01-02 00:00:00.000Z",
            thirdCard.cardId
        ]);
        getSql().execute("UPDATE flashcards SET due = ? WHERE cardId = ?", [
            "2999-01-01 00:00:00.000Z",
            futureCard.cardId
        ]);

        const limited = runInContext(() => flashcardService.getDueCards({
            deckNoteId: deck.noteId,
            limit: 2
        }));
        expect(limited.totalDueCount).toBe(3);
        expect(limited.cards.map((card) => card.cardId)).toEqual([
            firstCard.cardId,
            secondCard.cardId
        ]);
        expect(limited.cards.every((card) => card.back === undefined)).toBe(true);

        const empty = runInContext(() => flashcardService.getDueCards({
            deckNoteId: emptyDeck.noteId
        }));
        expect(empty.totalDueCount).toBe(0);
        expect(empty.cards).toEqual([]);

        expect(() => runInContext(() => flashcardService.getDueCards({
            deckNoteId: deck.noteId,
            limit: 0
        }))).toThrow("Invalid flashcard limit");
    });

    it("applies daily new and review limits to the due queue", () => {
        const originalSettings = runInContext(() => flashcardService.getSettings());
        const deck = createTextNote("Limited deck");
        const firstNewNote = createTextNote("Limited new one");
        const secondNewNote = createTextNote("Limited new two");
        const firstReviewNote = createTextNote("Limited review one");
        const secondReviewNote = createTextNote("Limited review two");
        const firstNewCard = runInContext(() => flashcardService.createCard({
            noteId: firstNewNote.noteId,
            deckNoteId: deck.noteId
        }));
        const secondNewCard = runInContext(() => flashcardService.createCard({
            noteId: secondNewNote.noteId,
            deckNoteId: deck.noteId
        }));
        const firstReviewCard = runInContext(() => flashcardService.createCard({
            noteId: firstReviewNote.noteId,
            deckNoteId: deck.noteId
        }));
        const secondReviewCard = runInContext(() => flashcardService.createCard({
            noteId: secondReviewNote.noteId,
            deckNoteId: deck.noteId
        }));

        try {
            const existingNewReviews = countReviewsTodayByState(0);
            const existingReviewReviews = countReviewsTodayByState(2);

            runInContext(() => flashcardService.setSettings({
                schedulerConfig: {
                    ...originalSettings.schedulerConfig,
                    dailyNewCardLimit: existingNewReviews + 1,
                    dailyReviewLimit: existingReviewReviews + 1,
                    dayRolloverHour: 0,
                    enableFuzz: false
                }
            }));
            makeReviewCardDue(firstReviewCard.cardId);
            makeReviewCardDue(secondReviewCard.cardId, "2020-01-02 00:00:00.000Z");
            moveDueDate(firstNewCard.cardId, "2020-01-01 00:00:00.000Z");
            moveDueDate(secondNewCard.cardId, "2020-01-02 00:00:00.000Z");

            const initial = runInContext(() => flashcardService.getDueCards({
                deckNoteId: deck.noteId,
                limit: 10
            }));
            expect(initial.totalDueCount).toBe(2);
            expect(initial.cards.map((card) => card.cardId)).toEqual([
                firstReviewCard.cardId,
                firstNewCard.cardId
            ]);

            runInContext(() => flashcardService.reviewCard(firstReviewCard.cardId, {
                rating: 3,
                expectedSchedulingRevision: firstReviewCard.schedulingRevision,
                clientRequestId: `${firstReviewCard.cardId}-daily-review-limit`
            }));
            runInContext(() => flashcardService.reviewCard(firstNewCard.cardId, {
                rating: 3,
                expectedSchedulingRevision: firstNewCard.schedulingRevision,
                clientRequestId: `${firstNewCard.cardId}-daily-new-limit`
            }));

            const afterLimitsReached = runInContext(() => flashcardService.getDueCards({
                deckNoteId: deck.noteId,
                limit: 10
            }));
            expect(afterLimitsReached.totalDueCount).toBe(0);
            expect(afterLimitsReached.cards).toEqual([]);
            expect(secondNewCard.cardId).toBeTruthy();
            expect(secondReviewCard.cardId).toBeTruthy();
        } finally {
            runInContext(() => flashcardService.setSettings(originalSettings));
        }
    });

    it("does not expose protected note content while protected session is locked", () => {
        const note = createTextNote("Protected source", "Secret answer");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        note.isProtected = true;

        const lockedCard = runInContext(() => flashcardService.getCard(card.cardId));

        expect(lockedCard.front).toBe("[protected]");
        expect(lockedCard.back).toBeUndefined();
        expect(lockedCard.noteTitle).toBe("[protected]");

        const dueCard = runInContext(() => flashcardService.getDueCards().cards
            .find((candidate) => candidate.cardId === card.cardId));
        expect(dueCard).toMatchObject({
            front: "[protected]",
            noteTitle: "[protected]"
        });
        expect(dueCard?.back).toBeUndefined();
        expect(() => runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId: `${card.cardId}-protected-review`
        }))).toThrow("Cannot review protected flashcard while protected session is locked.");
    });

    it("hides active cards whose source note is missing", () => {
        const note = createTextNote("Missing source", "Hidden answer");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        getSql().execute(/*sql*/`
            UPDATE notes
            SET isDeleted = 1
            WHERE noteId = ?`, [note.noteId]);
        delete becca.notes[note.noteId];

        const due = runInContext(() => flashcardService.getDueCards({ limit: 100 }));
        expect(due.cards.some((dueCard) => dueCard.cardId === card.cardId)).toBe(false);
        expect(() => runInContext(() => flashcardService.getCard(card.cardId)))
            .toThrow("Flashcard source note was not found.");
        expect(() => runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId: `${card.cardId}-missing-source-review`
        }))).toThrow("Flashcard source note was not found.");
    });

    it("reviews a card and rejects stale scheduling revisions", () => {
        const note = createTextNote("Review source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        const statsBefore = runInContext(() => flashcardService.getStats());

        const response = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId: `${card.cardId}-good`
        }));

        expect(response.reviewId).toBeTruthy();
        expect(response.card.schedulingRevision).toBe(card.schedulingRevision + 1);

        const statsAfter = runInContext(() => flashcardService.getStats());
        expect(statsAfter.reviewedTodayCount).toBe(statsBefore.reviewedTodayCount + 1);
        expect(statsAfter.ratingCounts[3]).toBe(statsBefore.ratingCounts[3] + 1);
        expect(statsAfter.retentionRate).not.toBeNull();
        expect(statsAfter.lapseCount).toBeGreaterThanOrEqual(0);
        expect(statsAfter.dueForecast).toHaveLength(7);

        const reviewCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE cardId = ?`, [card.cardId]);
        expect(reviewCount).toBe(1);
        expect(getSql().getValue<string>(/*sql*/`
            SELECT schedulerConfig FROM flashcard_reviews
            WHERE cardId = ?`, [card.cardId])).toContain("requestRetention");
        expect(getSql().getValue<string>(/*sql*/`
            SELECT schedulerConfig FROM flashcards
            WHERE cardId = ?`, [card.cardId])).toContain("requestRetention");

        expect(() => runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId: `${card.cardId}-stale`
        }))).toThrow("Refresh before reviewing");

        const countAfterStaleReview = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE cardId = ?`, [card.cardId]);
        expect(countAfterStaleReview).toBe(1);
    });

    it("suspends leech cards after repeated lapses", () => {
        const note = createTextNote("Leech source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        getSql().execute(/*sql*/`
            UPDATE flashcards
            SET state = 2, due = '2020-01-01 00:00:00.000Z', stability = 5,
                difficulty = 5, lastReview = '2019-12-31 00:00:00.000Z', reps = 7,
                scheduledDays = 3, lapses = 7
            WHERE cardId = ?`, [card.cardId]);

        const reviewed = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 1,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId: `${card.cardId}-leech`
        }));
        const stats = runInContext(() => flashcardService.getStats());

        expect(reviewed.card.leech).toBe(true);
        expect(reviewed.card.suspended).toBe(true);
        expect(note.hasLabel("flashcardLeech")).toBe(true);
        expect(stats.leechCount).toBeGreaterThanOrEqual(1);

        const undone = runInContext(() => flashcardService.undoReview({
            reviewId: reviewed.reviewId,
            expectedSchedulingRevision: reviewed.card.schedulingRevision
        }));
        expect(undone.card.leech).toBe(false);
        expect(undone.card.suspended).toBe(false);
        expect(note.hasLabel("flashcardLeech")).toBe(false);
    });

    it("keeps a manually resumed leech active after a later review", () => {
        const note = createTextNote("Resumed leech source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        getSql().execute(/*sql*/`
            UPDATE flashcards
            SET state = 2, due = '2020-01-01 00:00:00.000Z', stability = 5,
                difficulty = 5, lastReview = '2019-12-31 00:00:00.000Z', reps = 7,
                scheduledDays = 3, lapses = 7
            WHERE cardId = ?`, [card.cardId]);

        const leechReview = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 1,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId: `${card.cardId}-initial-leech`
        }));
        const resumed = runInContext(() => flashcardService.setSuspended(card.cardId, {
            suspended: false,
            expectedSchedulingRevision: leechReview.card.schedulingRevision
        }));
        const laterReview = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: resumed.card.schedulingRevision,
            clientRequestId: `${card.cardId}-after-resume`
        }));

        expect(laterReview.card.leech).toBe(true);
        expect(laterReview.card.suspended).toBe(false);
        expect(note.hasLabel("flashcardLeech")).toBe(true);
    });

    it("undoes the latest review and restores the previous schedule", () => {
        const note = createTextNote("Undo review source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        const reviewed = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId: `${card.cardId}-undo`
        }));
        expect(reviewed.card.schedulingRevision).toBe(card.schedulingRevision + 1);

        const undone = runInContext(() => flashcardService.undoReview({
            reviewId: reviewed.reviewId,
            expectedSchedulingRevision: reviewed.card.schedulingRevision
        }));

        expect(undone.card.state).toBe(card.state);
        expect(undone.card.due).toBe(card.due);
        expect(undone.card.schedulingRevision).toBe(reviewed.card.schedulingRevision + 1);
        const isDueAgain = flashcardService.getDueCards().cards
            .some((dueCard) => dueCard.cardId === card.cardId);
        expect(isDueAgain).toBe(true);

        const reviewCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE cardId = ?`, [card.cardId]);
        expect(reviewCount).toBe(1);
    });

    it("rejects undo when another scheduling action changed the card", () => {
        const note = createTextNote("Undo conflict source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        const reviewed = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId: `${card.cardId}-undo-conflict`
        }));

        runInContext(() => flashcardService.buryCard(card.cardId, {
            expectedSchedulingRevision: reviewed.card.schedulingRevision
        }));

        expect(() => runInContext(() => flashcardService.undoReview({
            reviewId: reviewed.reviewId
        }))).toThrow("Only the latest flashcard review can be undone");
    });

    it("returns the original result for duplicate client request IDs", () => {
        const note = createTextNote("Duplicate review source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        const clientRequestId = `${card.cardId}-duplicate`;

        const first = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId
        }));
        const duplicate = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 1,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId
        }));

        expect(duplicate.reviewId).toBe(first.reviewId);
        expect(duplicate.card.schedulingRevision).toBe(first.card.schedulingRevision);

        const reviewCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE cardId = ?`, [card.cardId]);
        expect(reviewCount).toBe(1);
    });

    it("rejects duplicate client request IDs from another card", () => {
        const firstNote = createTextNote("First duplicate source");
        const secondNote = createTextNote("Second duplicate source");
        const firstCard = runInContext(() => flashcardService.createCard({
            noteId: firstNote.noteId
        }));
        const secondCard = runInContext(() => flashcardService.createCard({
            noteId: secondNote.noteId
        }));
        const clientRequestId = `${firstCard.cardId}-shared`;

        runInContext(() => flashcardService.reviewCard(firstCard.cardId, {
            rating: 3,
            expectedSchedulingRevision: firstCard.schedulingRevision,
            clientRequestId
        }));

        expect(() => runInContext(() => flashcardService.reviewCard(secondCard.cardId, {
            rating: 3,
            expectedSchedulingRevision: secondCard.schedulingRevision,
            clientRequestId
        }))).toThrow("belongs to another flashcard");

        const secondReviewCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE cardId = ?`, [secondCard.cardId]);
        expect(secondReviewCount).toBe(0);
    });

    it("suspends, resumes, and resets a card", () => {
        const note = createTextNote("Lifecycle source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        const suspended = runInContext(() => flashcardService.setSuspended(card.cardId, {
            suspended: true,
            expectedSchedulingRevision: card.schedulingRevision
        }));
        expect(suspended.card.suspended).toBe(true);
        expect(suspended.card.schedulingRevision).toBe(card.schedulingRevision + 1);
        const dueWhileSuspended = flashcardService.getDueCards().cards
            .some((dueCard) => dueCard.cardId === card.cardId);
        expect(dueWhileSuspended).toBe(false);

        const resumed = runInContext(() => flashcardService.setSuspended(card.cardId, {
            suspended: false,
            expectedSchedulingRevision: suspended.card.schedulingRevision
        }));
        expect(resumed.card.suspended).toBe(false);

        const buried = runInContext(() => flashcardService.buryCard(card.cardId, {
            expectedSchedulingRevision: resumed.card.schedulingRevision
        }));
        expect(Date.parse(buried.card.due)).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
        const dueWhileBuried = flashcardService.getDueCards().cards
            .some((dueCard) => dueCard.cardId === card.cardId);
        expect(dueWhileBuried).toBe(false);

        const resetAfterBury = runInContext(() => flashcardService.resetCard(card.cardId, {
            expectedSchedulingRevision: buried.card.schedulingRevision
        }));

        const reviewed = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: resetAfterBury.card.schedulingRevision,
            clientRequestId: `${card.cardId}-before-reset`
        }));
        const reset = runInContext(() => flashcardService.resetCard(card.cardId, {
            expectedSchedulingRevision: reviewed.card.schedulingRevision
        }));

        expect(reset.card.suspended).toBe(false);
        expect(reset.card.state).toBe(0);
        expect(reset.card.schedulingRevision).toBe(reviewed.card.schedulingRevision + 1);

        const reviewCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE cardId = ?`, [card.cardId]);
        expect(reviewCount).toBe(1);
    });

    it("sets a manual due date with conflict protection", () => {
        const note = createTextNote("Due date source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
        const rescheduled = runInContext(() => flashcardService.setCardDueDate(card.cardId, {
            due: future.toISOString(),
            expectedSchedulingRevision: card.schedulingRevision
        }));
        expect(rescheduled.card.schedulingRevision).toBe(card.schedulingRevision + 1);
        expect(Date.parse(rescheduled.card.due)).toBeCloseTo(future.getTime(), -1);

        // Not due within the queue until the manual date passes.
        let isDue = flashcardService.getDueCards().cards
            .some((dueCard) => dueCard.cardId === card.cardId);
        expect(isDue).toBe(false);

        const backdated = runInContext(() => flashcardService.setCardDueDate(card.cardId, {
            due: new Date(Date.now() - 1000).toISOString(),
            expectedSchedulingRevision: rescheduled.card.schedulingRevision
        }));
        expect(Date.parse(backdated.card.due)).toBeLessThan(Date.now());
        isDue = flashcardService.getDueCards().cards
            .some((dueCard) => dueCard.cardId === card.cardId);
        expect(isDue).toBe(true);

        expect(() => runInContext(() => flashcardService.setCardDueDate(card.cardId, {
            due: "not-a-date",
            expectedSchedulingRevision: backdated.card.schedulingRevision
        }))).toThrow("parseable due");

        expect(() => runInContext(() => flashcardService.setCardDueDate(card.cardId, {
            due: new Date().toISOString(),
            expectedSchedulingRevision: card.schedulingRevision
        }))).toThrow("Refresh before reviewing");
    });

    it("moves a card to another deck with conflict protection", () => {
        const oldDeck = createTextNote("Old deck");
        const newDeck = createTextNote("New deck");
        const note = createTextNote("Move deck source");
        const card = runInContext(() => flashcardService.createCard({
            noteId: note.noteId,
            deckNoteId: oldDeck.noteId
        }));

        const moved = runInContext(() => flashcardService.moveCardToDeck(card.cardId, {
            deckNoteId: newDeck.noteId,
            expectedSchedulingRevision: card.schedulingRevision
        }));

        expect(moved.card.deckNoteId).toBe(newDeck.noteId);
        expect(moved.card.deckTitle).toBe("New deck");
        expect(moved.card.schedulingRevision).toBe(card.schedulingRevision + 1);
        expect(() => runInContext(() => flashcardService.moveCardToDeck(card.cardId, {
            deckNoteId: oldDeck.noteId,
            expectedSchedulingRevision: card.schedulingRevision
        }))).toThrow("Refresh before reviewing");
    });

    it("removes a note's flashcards and marker label", () => {
        const note = createTextNote("Remove source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        runInContext(() => new BAttribute({
            noteId: note.noteId,
            type: "label",
            name: "flashcardLeech",
            value: "8",
            isInheritable: false
        }).save());

        const response = runInContext(() => flashcardService.removeCardsForNote(note.noteId));

        expect(response.removedCount).toBe(1);
        expect(note.hasLabel("flashcard")).toBe(false);
        expect(note.hasLabel("flashcardLeech")).toBe(false);
        const isCardStillDue = flashcardService.getDueCards().cards
            .some((dueCard) => dueCard.cardId === card.cardId);
        expect(isCardStillDue).toBe(false);

        const deletedCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE cardId = ? AND isDeleted = 1`, [card.cardId]);
        expect(deletedCount).toBe(1);

        const recreated = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        expect(recreated.cardId).not.toBe(card.cardId);
        expect(note.hasLabel("flashcard")).toBe(true);
    });

    it("creates one card per cloze index and renders elisions", () => {
        const note = createTextNote(
            "Cloze source",
            "{{c1::Berlin}} is the capital of {{c2::Germany}}"
        );

        const first = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        expect(note.hasLabel("flashcard")).toBe(true);
        expect(first.cardType).toBe("cloze");
        expect(first.front).toContain('class="flashcard-cloze"');
        expect(first.front).toContain("Germany");
        expect(first.back).toContain('class="flashcard-cloze-revealed">Berlin</span>');

        const rows = getSql().getRows<{ cardId: string; ordinal: number; cardType: string }>(/*sql*/`
            SELECT cardId, ordinal, cardType FROM flashcards
            WHERE noteId = ? AND isDeleted = 0 ORDER BY ordinal`, [note.noteId]);
        expect(rows.map((row) => [ row.ordinal, row.cardType ])).toEqual([
            [ 0, "cloze" ],
            [ 1, "cloze" ]
        ]);

        const second = runInContext(() => flashcardService.getCard(rows[1].cardId));
        expect(second.front).toContain("Berlin");
        expect(second.front).not.toContain("Germany");
        expect(second.back).toContain('class="flashcard-cloze-revealed">Germany</span>');

        // Creating again is idempotent — no extra rows.
        runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        const rowCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards WHERE noteId = ? AND isDeleted = 0`, [note.noteId]);
        expect(rowCount).toBe(2);
    });

    it("keeps schedules keyed to cloze indices when the note content changes", () => {
        const note = createTextNote(
            "Cloze sync source",
            "{{c1::alpha}} {{c2::beta}} {{c4::delta}}"
        );
        runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        let rows = getSql().getRows<{ cardId: string; ordinal: number }>(/*sql*/`
            SELECT cardId, ordinal FROM flashcards
            WHERE noteId = ? AND isDeleted = 0 ORDER BY ordinal`, [note.noteId]);
        expect(rows.map((row) => row.ordinal)).toEqual([ 0, 1, 3 ]);

        // Review the beta card so it has a schedule worth protecting.
        const betaCard = rows.find((row) => row.ordinal === 1);
        makeReviewCardDue(betaCard?.cardId || "");

        runInContext(() => note.setContent("{{c1::alpha}} {{c4::delta}}"));
        const sync = runInContext(() => flashcardService.syncNoteCards(note.noteId));

        expect(sync).toEqual({ createdCount: 0, removedCount: 1 });
        rows = getSql().getRows<{ cardId: string; ordinal: number }>(/*sql*/`
            SELECT cardId, ordinal FROM flashcards
            WHERE noteId = ? AND isDeleted = 0 ORDER BY ordinal`, [note.noteId]);
        expect(rows.map((row) => row.ordinal)).toEqual([ 0, 3 ]);

        const deletedCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards WHERE cardId = ? AND isDeleted = 1`, [betaCard?.cardId]);
        expect(deletedCount).toBe(1);

        // Adding a new deletion creates only its missing card.
        runInContext(() => note.setContent("{{c1::alpha}} {{c3::gamma}} {{c4::delta}}"));
        const secondSync = runInContext(() => flashcardService.syncNoteCards(note.noteId));
        expect(secondSync.createdCount).toBe(1);
    });

    it("leaves basic cards and non-cloze notes alone during sync", () => {
        const note = createTextNote("Basic source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        const sync = runInContext(() => flashcardService.syncNoteCards(note.noteId));
        expect(sync).toEqual({ createdCount: 0, removedCount: 0 });

        const rowCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards WHERE noteId = ? AND isDeleted = 0`, [note.noteId]);
        expect(rowCount).toBe(1);

        const summary = runInContext(() => flashcardService.getCardForNote(note.noteId));
        expect(summary?.cardType).toBe("basic");
        expect(card.cardType).toBe("basic");
    });
});
