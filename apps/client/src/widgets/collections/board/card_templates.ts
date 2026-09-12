import { buildNoteTypeId } from "@triliumnext/commons";

import { type NoteTypeOption } from "../../../services/note_types";

/**
 * What a board makes its cards from.
 *
 * A card template is a {@link NoteTypeOption} like any other: the list, the ids and the dialog that
 * narrows them down are the app's, and what the board adds is which of them it offers, which it
 * last used, and that a new card is made from that one.
 */
export interface CardTemplates {
    /** What the board offers, in the order it stores them. */
    offered: NoteTypeOption[];
    /** The one a card would be made from now. */
    current?: NoteTypeOption;
    onSelect: (template: NoteTypeOption) => void;
    /** Opens the dialog that decides what the board offers. */
    onMore: () => void;
}

/** What a board offers until the reader says otherwise. */
export const DEFAULT_CARD_TEMPLATES = [
    buildNoteTypeId("text", "text/html"),
    buildNoteTypeId("code", "text/x-markdown"),
    buildNoteTypeId("canvas", "application/json"),
    buildNoteTypeId("spreadsheet", "application/json")
];

/**
 * The template a new card is made from: the one the board last used, or the first it offers.
 *
 * A board whose stored template is no longer offered falls back rather than making nothing: the
 * template may have been switched off, or the note behind it deleted.
 */
export function currentCardTemplate(offered: NoteTypeOption[], stored: string | undefined) {
    return offered.find((template) => template.id === stored) ?? offered[0];
}
