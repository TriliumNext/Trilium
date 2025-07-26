import Expression from "./expression.js";
import SearchContext from "../search_context.js";
import NoteSet from "../note_set.js";
import sql from "../../sql.js";
import becca from "../../../becca/becca.js";

/**
 * Search expression for finding text within OCR-extracted content from images
 */
export default class OCRContentExpression extends Expression {
    private searchText: string;

    constructor(searchText: string) {
        super();
        this.searchText = searchText;
    }

    execute(inputNoteSet: NoteSet, executionContext: object, searchContext: SearchContext): NoteSet {
        // Don't search OCR content if it's not enabled
        if (!this.isOCRSearchEnabled()) {
            return new NoteSet();
        }

        const resultNoteSet = new NoteSet();
        const ocrResults = this.searchOCRContent(this.searchText);

        for (const ocrResult of ocrResults) {
            // Find notes that use this blob
            const notes = sql.getRows<{noteId: string}>(`
                SELECT noteId FROM notes 
                WHERE blobId = ? AND isDeleted = 0
            `, [ocrResult.blobId]);

            for (const noteRow of notes) {
                const note = becca.getNote(noteRow.noteId);
                if (note && !note.isDeleted && inputNoteSet.hasNoteId(note.noteId)) {
                    resultNoteSet.add(note);
                }
            }

            // Find attachments that use this blob and their parent notes
            const attachments = sql.getRows<{ownerId: string}>(`
                SELECT ownerId FROM attachments
                WHERE blobId = ? AND isDeleted = 0
            `, [ocrResult.blobId]);

            for (const attachmentRow of attachments) {
                const note = becca.getNote(attachmentRow.ownerId);
                if (note && !note.isDeleted && inputNoteSet.hasNoteId(note.noteId)) {
                    resultNoteSet.add(note);
                }
            }
        }

        // Add highlight tokens for OCR matches
        if (ocrResults.length > 0) {
            const tokens = this.extractHighlightTokens(this.searchText);
            searchContext.highlightedTokens.push(...tokens);
        }

        return resultNoteSet;
    }

    private isOCRSearchEnabled(): boolean {
        try {
            const optionService = require('../../options.js').default;
            return optionService.getOptionBool('ocrEnabled');
        } catch {
            return false;
        }
    }

    private searchOCRContent(searchText: string): Array<{
        blobId: string;
        ocr_text: string;
    }> {
        try {
            // Search in blobs table for OCR text
            const query = `
                SELECT blobId, ocr_text
                FROM blobs
                WHERE ocr_text LIKE ?
                AND ocr_text IS NOT NULL
                AND ocr_text != ''
                LIMIT 50
            `;
            const params = [`%${searchText}%`];

            return sql.getRows<{
                blobId: string;
                ocr_text: string;
            }>(query, params);
        } catch (error) {
            console.error('Error searching OCR content:', error);
            return [];
        }
    }


    private extractHighlightTokens(searchText: string): string[] {
        // Split search text into words and return them as highlight tokens
        return searchText
            .split(/\s+/)
            .filter(token => token.length > 2)
            .map(token => token.toLowerCase());
    }

    toString(): string {
        return `OCRContent('${this.searchText}')`;
    }
}