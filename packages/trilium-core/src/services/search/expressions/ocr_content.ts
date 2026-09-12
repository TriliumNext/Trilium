import becca from "../../../becca/becca.js";
import blobService from "../../blob.js";
import protectedSessionService from "../../protected_session.js";
import { getSql } from "../../sql/index.js";
import NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";
import Expression from "./expression.js";

/**
 * Search expression for finding text within OCR-extracted content (textRepresentation)
 * from image notes and their attachments.
 *
 * Unprotected text is matched by the database, which is what it is for. A protected note's text is
 * stored encrypted and there is nothing in it for SQL to compare against, so those are read out and
 * matched here instead — and only while a protected session is open, since otherwise they cannot be
 * read at all.
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
     * Find all noteIds that have OCR text matching all tokens.
     * Checks both the note's own blob and its attachment blobs.
     */
    private findNoteIdsWithMatchingOCR(): Set<string> {
        if (this.tokens.length === 0) return new Set();

        const matchingNoteIds = new Set<string>();

        this.collectUnprotectedMatches(matchingNoteIds);
        this.collectProtectedMatches(matchingNoteIds);

        return matchingNoteIds;
    }

    /** The stored text is the readable text, so all tokens must appear in it. */
    private collectUnprotectedMatches(matchingNoteIds: Set<string>) {
        const likeConditions = this.tokens.map(() => `b.textRepresentation LIKE ?`).join(' AND ');
        const params = this.tokens.map(token => `%${token}%`);
        const sql = getSql();

        // Notes whose own blob matches.
        const noteIds = sql.getColumn<string>(`
            SELECT n.noteId
            FROM notes n
            JOIN blobs b ON n.blobId = b.blobId
            WHERE b.textRepresentation IS NOT NULL
              AND n.isDeleted = 0
              AND n.isProtected = 0
              AND ${likeConditions}
        `, params);

        // Notes that own an attachment whose blob matches.
        const attachmentOwnerIds = sql.getColumn<string>(`
            SELECT a.ownerId
            FROM attachments a
            JOIN blobs b ON a.blobId = b.blobId
            WHERE b.textRepresentation IS NOT NULL
              AND a.isDeleted = 0
              AND a.isProtected = 0
              AND ${likeConditions}
        `, params);

        for (const noteId of [...noteIds, ...attachmentOwnerIds]) {
            matchingNoteIds.add(noteId);
        }
    }

    /**
     * The same search over blobs whose text is encrypted, decrypting each one to compare it.
     *
     * Only rows that are protected are read, and their text is what OCR pulled out of one file
     * rather than the file itself, so this stays far smaller than the note-content search that
     * already works this way.
     */
    private collectProtectedMatches(matchingNoteIds: Set<string>) {
        if (!protectedSessionService.isProtectedSessionAvailable()) {
            return;
        }

        const sql = getSql();
        const queries = [
            /*sql*/`
                SELECT n.noteId AS noteId, b.textRepresentation AS textRepresentation
                FROM notes n
                JOIN blobs b ON n.blobId = b.blobId
                WHERE b.textRepresentation IS NOT NULL
                  AND n.isDeleted = 0
                  AND n.isProtected = 1`,
            /*sql*/`
                SELECT a.ownerId AS noteId, b.textRepresentation AS textRepresentation
                FROM attachments a
                JOIN blobs b ON a.blobId = b.blobId
                WHERE b.textRepresentation IS NOT NULL
                  AND a.isDeleted = 0
                  AND a.isProtected = 1`
        ];

        for (const query of queries) {
            for (const row of sql.iterateRows<{ noteId: string; textRepresentation: string }>(query)) {
                if (matchingNoteIds.has(row.noteId)) {
                    continue;
                }

                const text = blobService.decryptTextRepresentation(row.textRepresentation, true);

                if (text && this.matchesAllTokens(text)) {
                    matchingNoteIds.add(row.noteId);
                }
            }
        }
    }

    /**
     * The in-memory equivalent of the LIKE conditions above: every token must appear, ignoring case.
     * Case folding is done on both sides, so unlike SQLite's LIKE this also holds outside ASCII. A
     * token is compared literally, where LIKE would read `%` or `_` in one as a wildcard.
     */
    private matchesAllTokens(text: string): boolean {
        const haystack = text.toLowerCase();

        return this.tokens.every(token => haystack.includes(token.toLowerCase()));
    }

    toString(): string {
        return `OCRContent('${this.tokens.join("', '")}')`;
    }
}
