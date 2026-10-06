import { describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import BAttribute from "../../becca/entities/battribute.js";
import type BNote from "../../becca/entities/bnote.js";
import { init as clsInit } from "../context.js";
import noteService from "../notes.js";
import flashcardService from "./flashcard_service.js";
import { isFilteredDeckId, resolveFilteredDeckNoteIds } from "./filtered_decks.js";

function runInContext<T>(fn: () => T) {
    return clsInit(fn);
}

function createTextNote(title: string, content = "Back content") {
    return runInContext(() => noteService.createNewNote({
        parentNoteId: "root",
        title,
        content,
        type: "text"
    }).note);
}

function createFilteredDeck(title: string, query: string): BNote {
    return runInContext(() => {
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

        if (query) {
            new BAttribute({
                noteId: note.noteId,
                type: "label",
                name: "searchString",
                value: query
            }).save();
        }

        return note;
    });
}

describe("filtered flashcard decks", () => {
    it("resolves the source notes matched by a filtered deck query", () => {
        const source = createTextNote("Filtered source");
        runInContext(() => flashcardService.createCard({ noteId: source.noteId }));

        const deck = createFilteredDeck("Filtered deck", "#flashcard");

        expect(isFilteredDeckId(deck.noteId)).toBe(true);
        expect(resolveFilteredDeckNoteIds(deck)).toContain(source.noteId);
    });

    it("scopes the due queue to the notes matched by the filtered deck", () => {
        const matching = createTextNote("Matching source");
        const other = createTextNote("Other source");
        const matchingCard = runInContext(() => flashcardService.createCard({ noteId: matching.noteId }));
        runInContext(() => flashcardService.createCard({ noteId: other.noteId }));

        const deck = createFilteredDeck("One-note deck", `note.noteId = "${matching.noteId}"`);

        const due = runInContext(() => flashcardService.getDueCards({ deckNoteId: deck.noteId }));

        expect(due.cards.map((card) => card.cardId)).toContain(matchingCard.cardId);
        expect(due.cards.map((card) => card.noteId)).not.toContain(other.noteId);
    });

    it("lists filtered decks alongside direct decks with computed counts", () => {
        const source = createTextNote("Counted source");
        runInContext(() => flashcardService.createCard({ noteId: source.noteId }));

        const deck = createFilteredDeck("Counted filtered deck", `note.noteId = "${source.noteId}"`);

        const decks = runInContext(() => flashcardService.getDecks().decks);
        const summary = decks.find((entry) => entry.deckNoteId === deck.noteId);

        expect(summary).toBeTruthy();
        expect(summary?.isFiltered).toBe(true);
        expect(summary?.totalCount).toBe(1);
        expect(summary?.newCount).toBe(1);
    });

    it("lists an empty filtered deck with zero counts", () => {
        const deck = createFilteredDeck("Empty filtered deck", "note.noteId = 'missing-note'");

        const decks = runInContext(() => flashcardService.getDecks().decks);
        const summary = decks.find((entry) => entry.deckNoteId === deck.noteId);

        expect(summary).toMatchObject({
            isFiltered: true,
            totalCount: 0,
            dueCount: 0
        });
    });

    it("rejects assigning a card to a filtered deck", () => {
        const source = createTextNote("Assignable source");
        const deck = createFilteredDeck("Target deck", "#flashcard");

        expect(() => runInContext(() => flashcardService.createCard({
            noteId: source.noteId,
            deckNoteId: deck.noteId
        }))).toThrow("Cannot assign cards to a filtered deck.");
    });

    it("rejects moving a card into a filtered deck", () => {
        const source = createTextNote("Movable source");
        const card = runInContext(() => flashcardService.createCard({ noteId: source.noteId }));
        const deck = createFilteredDeck("Move target", "#flashcard");

        expect(() => runInContext(() => flashcardService.moveCardToDeck(card.cardId, {
            deckNoteId: deck.noteId,
            expectedSchedulingRevision: card.schedulingRevision
        }))).toThrow("Cannot move a card into a filtered deck.");
    });

    it("returns an empty due queue for a filtered deck whose query matches nothing", () => {
        const deck = createFilteredDeck("No-match deck", "note.noteId = 'missing-note'");

        const due = runInContext(() => flashcardService.getDueCards({ deckNoteId: deck.noteId }));

        expect(due.cards).toEqual([]);
        expect(due.totalDueCount).toBe(0);
    });
});
