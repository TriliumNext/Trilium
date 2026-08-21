import { describe, expect, it } from "vitest";

import { init as clsInit } from "../context.js";
import noteService from "../notes.js";
import { getSql } from "../sql/index.js";
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

        const response = runInContext(() => flashcardService.removeCardsForNote(note.noteId));

        expect(response.removedCount).toBe(1);
        expect(note.hasLabel("flashcard")).toBe(false);
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
});
