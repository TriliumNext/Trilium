import type BNote from "../../becca/entities/bnote.js";
import becca from "../../becca/becca.js";
import searchService from "../search/services/search.js";

export const FLASHCARD_FILTERED_DECK_LABEL = "flashcardFilteredDeck";

/**
 * A filtered deck is a note carrying `#flashcardFilteredDeck` whose saved-search
 * query (the `searchString` label, like any Trilium saved search) selects the
 * source notes whose cards belong to the deck. The deck itself never receives
 * cards directly; its card set is recomputed from the query on every read.
 */
export function isFilteredDeck(note: BNote | undefined | null): note is BNote {
    return !!note && note.hasLabel(FLASHCARD_FILTERED_DECK_LABEL);
}

export function isFilteredDeckId(noteId: string): boolean {
    return isFilteredDeck(becca.getNote(noteId));
}

/** Resolves the note IDs selected by a filtered deck's saved-search query. */
export function resolveFilteredDeckNoteIds(note: BNote): string[] {
    const { searchResultNoteIds } = searchService.searchFromNote(note);
    return searchResultNoteIds;
}
