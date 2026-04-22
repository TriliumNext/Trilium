import becca from "../../../becca/becca.js";
import sql from "../../sql.js";
import NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";
import Expression from "./expression.js";

/**
 * Search expression for finding text within OCR-extracted content (textRepresentation)
 * from image notes and their attachments.
 *
 * Uses a single SQL query to find all noteIds whose own blob or attachment blobs
 * contain matching text, then intersects with the input note set.
 */
export default class OCRContentExpression extends Expression {
    private tokens: string[];

    constructor(tokens: string[]) {
        super();
        this.tokens = tokens;
    }

    execute(inputNoteSet: NoteSet, executionContext: object, searchContext: SearchContext): NoteSet {
        const resultNoteSet = new NoteSet();
        const matchingNoteIds = this.findNoteIdsWithMatchingOCR();

        for (const noteId of matchingNoteIds) {
            const note = becca.notes[noteId];
            if (note && inputNoteSet.hasNoteId(noteId)) {
                resultNoteSet.add(note);
            }
        }

        if (resultNoteSet.notes.length > 0) {
            const highlightTokens = this.tokens
                .filter(token => token.length > 2)
                .map(token => token.toLowerCase());
            searchContext.highlightedTokens.push(...highlightTokens);
        }

        return resultNoteSet;
    }

    /**
     * Find all noteIds that have OCR text matching all tokens, in a single query.
     * Checks both the note's own blob and its attachment blobs.
     */
    private findNoteIdsWithMatchingOCR(): Set<string> {
        if (this.tokens.length === 0) return new Set();

        // Build WHERE conditions: all tokens must appear in textRepresentation
        const likeConditions = this.tokens.map(() => `b.textRepresentation LIKE ?`).join(' AND ');
        const params = this.tokens.map(token => `%${token}%`);

        // Find notes whose own blob matches
        const noteIds = sql.getColumn<string>(`
            SELECT n.noteId
            FROM notes n
            JOIN blobs b ON n.blobId = b.blobId
            WHERE b.textRepresentation IS NOT NULL
              AND n.isDeleted = 0
              AND ${likeConditions}
        `, params);

        // Find notes that own attachments whose blob matches
        const attachmentOwnerIds = sql.getColumn<string>(`
            SELECT a.ownerId
            FROM attachments a
            JOIN blobs b ON a.blobId = b.blobId
            WHERE b.textRepresentation IS NOT NULL
              AND a.isDeleted = 0
              AND ${likeConditions}
        `, params);

        return new Set([...noteIds, ...attachmentOwnerIds]);
    }

    toString(): string {
        return `OCRContent('${this.tokens.join("', '")}')`;
    }
}
