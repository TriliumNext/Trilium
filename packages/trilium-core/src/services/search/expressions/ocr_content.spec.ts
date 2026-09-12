import { afterEach, beforeEach, describe, expect, it } from "vitest";

import becca from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import blobService from "../../blob.js";
import { getContext } from "../../context.js";
import noteService from "../../notes.js";
import protectedSessionService from "../../protected_session.js";
import { getSql } from "../../sql/index.js";
import { encodeUtf8 } from "../../utils/binary.js";
import NoteSet from "../note_set.js";
import SearchContext from "../search_context.js";
import OCRContentExpression from "./ocr_content.js";

const PROTECTED_KEY = encodeUtf8("0123456789abcdef"); // exactly 16 bytes

let counter = 0;

/**
 * Creates a fresh text note under root in the real in-memory DB and sets the
 * textRepresentation of its own blob to the given OCR text. Each call uses a
 * unique title since the fixture DB is shared between the `it()`s in this file.
 */
function createNoteWithOcrText(ocrText: string): BNote {
    counter++;
    const { note } = getContext().init(() =>
        noteService.createNewNote({
            parentNoteId: "root",
            // Unique content per note: blobs are keyed by content hash, so
            // identical content would make notes share a single blob row.
            content: `image-binary-placeholder-${counter}`,
            title: `ocr-spec-${counter}`,
            type: "image",
            mime: "image/png"
        })
    );

    setTextRepresentationForBlob(note.blobId!, ocrText);

    return note;
}

/**
 * Creates a fresh text note that owns an attachment whose blob carries the
 * given OCR text. The note's own blob is left without any textRepresentation.
 */
function createNoteWithOcrAttachment(ocrText: string): BNote {
    counter++;
    const { note } = getContext().init(() =>
        noteService.createNewNote({
            parentNoteId: "root",
            title: `ocr-spec-${counter}`,
            content: "<p>no ocr here</p>",
            type: "text"
        })
    );

    const attachment = getContext().init(() =>
        note.saveAttachment({
            role: "image",
            mime: "image/png",
            title: `ocr-attachment-${counter}`,
            content: `attachment-binary-placeholder-${counter}`
        })
    );

    setTextRepresentationForBlob(attachment.blobId!, ocrText);

    return note;
}

/**
 * As {@link createNoteWithOcrText}, for a note the query has to decrypt: the row is flagged protected
 * and the text is stored encrypted, the way the OCR service stores it. Needs an open session.
 */
function createProtectedNoteWithOcrText(ocrText: string): BNote {
    const note = createNoteWithOcrText(blobService.encryptTextRepresentation(ocrText, true));

    getSql().execute("UPDATE notes SET isProtected = 1 WHERE noteId = ?", [note.noteId]);
    note.isProtected = true;

    return note;
}

/** The attachment counterpart: only the attachment row is flagged, which is what the query reads. */
function createProtectedNoteWithOcrAttachment(ocrText: string): BNote {
    const note = createNoteWithOcrAttachment(blobService.encryptTextRepresentation(ocrText, true));

    getSql().execute("UPDATE attachments SET isProtected = 1 WHERE ownerId = ?", [note.noteId]);

    return note;
}

function setTextRepresentationForBlob(blobId: string, textRepresentation: string) {
    getSql().execute("UPDATE blobs SET textRepresentation = ? WHERE blobId = ?", [
        textRepresentation,
        blobId
    ]);
}

/** Build a NoteSet that contains every note currently registered in becca. */
function allNotesSet() {
    return new NoteSet(Object.values(becca.notes));
}

function execute(
    exp: OCRContentExpression,
    inputNoteSet = allNotesSet(),
    searchContext = new SearchContext()
) {
    return exp.execute(inputNoteSet, {}, searchContext);
}

function noteIds(noteSet: NoteSet) {
    return noteSet.notes.map((n) => n.noteId).sort();
}

describe("OCRContentExpression (real DB)", () => {
    it("matches a note whose own blob OCR text contains the token", () => {
        const note = createNoteWithOcrText("Invoice total amount due");

        const exp = new OCRContentExpression(["invoice"]);
        const result = execute(exp);

        expect(result.hasNote(note)).toBe(true);
    });

    it("matches case-insensitively because tokens are stored lowercase by the query", () => {
        // The LIKE pattern uses the token verbatim; SQLite's LIKE is
        // case-insensitive for ASCII, so an upper-case OCR word still matches a
        // lower-case token.
        const note = createNoteWithOcrText("PASSPORT NUMBER 12345");

        const exp = new OCRContentExpression(["passport"]);
        expect(execute(exp).hasNote(note)).toBe(true);
    });

    it("requires every token to be present (AND semantics)", () => {
        const both = createNoteWithOcrText("red apple and green banana");
        const onlyOne = createNoteWithOcrText("red apple only");

        const exp = new OCRContentExpression(["apple", "banana"]);
        const result = execute(exp);

        expect(result.hasNote(both)).toBe(true);
        expect(result.hasNote(onlyOne)).toBe(false);
    });

    it("matches a note via the OCR text of one of its attachments", () => {
        const note = createNoteWithOcrAttachment("Scanned receipt grand total");

        const exp = new OCRContentExpression(["receipt"]);
        const result = execute(exp);

        expect(result.hasNote(note)).toBe(true);
    });

    it("intersects with the input note set, excluding matches outside it", () => {
        const inSet = createNoteWithOcrText("shared keyword alpha");
        const outOfSet = createNoteWithOcrText("shared keyword alpha");

        const exp = new OCRContentExpression(["keyword"]);

        // Restrict the input set to only `inSet`; `outOfSet` carries the same
        // OCR text but must be excluded because it is not in the input set.
        const restricted = new NoteSet([inSet]);
        const result = execute(exp, restricted);

        expect(noteIds(result)).toEqual([inSet.noteId]);
        expect(result.hasNote(outOfSet)).toBe(false);
    });

    it("returns an empty set when no OCR text matches", () => {
        createNoteWithOcrText("totally unrelated content");

        const exp = new OCRContentExpression(["zzznonexistenttokenzzz"]);
        const result = execute(exp);

        expect(result.notes).toHaveLength(0);
    });

    it("returns an empty set for an empty token list without touching the DB", () => {
        const exp = new OCRContentExpression([]);
        const result = execute(exp);

        expect(result.notes).toHaveLength(0);
    });

    it("pushes lowercased tokens longer than 2 chars to highlightedTokens on a hit", () => {
        // OCR text contains both the long token and the short "ab" so the AND
        // query matches; the highlight filter then keeps only the long token.
        createNoteWithOcrText("ab highlighting Demonstration text");

        const searchContext = new SearchContext();
        const exp = new OCRContentExpression(["Demonstration", "ab"]);
        const result = execute(exp, allNotesSet(), searchContext);

        expect(result.notes.length).toBeGreaterThan(0);
        // The long token is lowercased and added; the 2-char token is filtered out.
        expect(searchContext.highlightedTokens).toContain("demonstration");
        expect(searchContext.highlightedTokens).not.toContain("ab");
    });

    it("does not modify highlightedTokens when there is no match", () => {
        const searchContext = new SearchContext();
        const exp = new OCRContentExpression(["definitelymissingtoken"]);
        execute(exp, allNotesSet(), searchContext);

        expect(searchContext.highlightedTokens).toHaveLength(0);
    });

    it("ignores deleted notes and matches against live ones only", () => {
        const note = createNoteWithOcrText("uniquedeletionmarker phrase");

        // Soft-delete the note row directly; findNoteIdsWithMatchingOCR filters
        // on notes.isDeleted = 0.
        getSql().execute("UPDATE notes SET isDeleted = 1 WHERE noteId = ?", [note.noteId]);

        const exp = new OCRContentExpression(["uniquedeletionmarker"]);
        const result = execute(exp);

        expect(result.hasNote(note)).toBe(false);
    });

    it("renders a readable toString with the joined tokens", () => {
        const exp = new OCRContentExpression(["foo", "bar"]);
        expect(exp.toString()).toBe("OCRContent('foo', 'bar')");
    });

    describe("protected notes", () => {
        beforeEach(() => protectedSessionService.setDataKey(PROTECTED_KEY));
        afterEach(() => protectedSessionService.resetDataKey());

        it("matches encrypted text on a note and on an attachment, with the same semantics as the query", () => {
            const note = createProtectedNoteWithOcrText("Protected invoice total");
            const viaAttachment = createProtectedNoteWithOcrAttachment("Protected scanned receipt");

            expect(execute(new OCRContentExpression(["invoice"])).hasNote(note)).toBe(true);
            expect(execute(new OCRContentExpression(["receipt"])).hasNote(viaAttachment)).toBe(true);

            // Case-insensitive, as SQLite's LIKE is for the unprotected ones.
            expect(execute(new OCRContentExpression(["INVOICE"])).hasNote(note)).toBe(true);

            // And every token still has to be there.
            expect(execute(new OCRContentExpression(["invoice", "receipt"])).hasNote(note)).toBe(false);
        });

        it("finds protected and unprotected notes in one search", () => {
            const openly = createNoteWithOcrText("shared marker openly stored");
            const encrypted = createProtectedNoteWithOcrText("shared marker under lock");

            const result = execute(new OCRContentExpression(["marker"]));

            expect(result.hasNote(openly)).toBe(true);
            expect(result.hasNote(encrypted)).toBe(true);
        });

        it("cannot match a protected note once the session is closed", () => {
            const note = createProtectedNoteWithOcrText("Protected passport number");

            protectedSessionService.resetDataKey();

            // Neither by the text it was made from, nor by anything in the stored ciphertext.
            expect(execute(new OCRContentExpression(["passport"])).hasNote(note)).toBe(false);

            const stored = getSql().getValue<string>(
                "SELECT textRepresentation FROM blobs WHERE blobId = ?", [note.blobId ?? ""]);
            expect(execute(new OCRContentExpression([stored.slice(0, 12)])).hasNote(note)).toBe(false);
        });
    });
});
