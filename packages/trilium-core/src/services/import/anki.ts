import striptags from "striptags";

import type BNote from "../../becca/entities/bnote.js";
import { ValidationError } from "../../errors.js";
import * as cls from "../context.js";
import flashcardService from "../flashcards/flashcard_service.js";
import { isClozeContent, renderClozeBack } from "../flashcards/cloze.js";
import noteService from "../notes.js";
import protectedSessionService from "../protected_session.js";
import { sanitizeHtml } from "../sanitizer.js";
import { getSql } from "../sql/index.js";
import type { ReadOnlyDatabase } from "../sql/types.js";
import type TaskContext from "../task_context.js";
import { decodeUtf8 } from "../utils/binary.js";
import { removeFileExtension, unescapeHtml } from "../utils/index.js";
import { getZipProvider, type ZipProvider, type ZipSource } from "../zip_provider.js";

const FIELD_SEPARATOR = "\u001f";
const SQLITE_HEADER = "SQLite format 3\u0000";
const MAX_COLLECTION_SIZE = 256 * 1024 * 1024;
const MAX_NOTE_COUNT = 100_000;

export interface AnkiCollectionRow {
    decks: string;
    models: string;
}

interface AnkiSchemaRow extends AnkiCollectionRow {
    ver: number;
}

interface AnkiDeckRow {
    id: number;
    name: string;
}

interface AnkiFieldRow {
    modelId: number;
    ordinal: number;
    name: string;
}

export interface AnkiCardRow {
    noteId: number;
    modelId: number;
    fields: string;
    tags: string;
    deckId: number;
    originalDeckId: number;
    ordinal: number;
    sourceCardCount?: number;
}

interface AnkiDeck {
    id?: number;
    name?: string;
}

interface AnkiModelField {
    name?: string;
    ord?: number;
}

interface AnkiModel {
    type?: number;
    flds?: AnkiModelField[];
}

export interface AnkiImportPlan {
    deckNames: string[];
    notes: AnkiImportNote[];
}

export interface AnkiImportNote {
    sourceNoteId: string;
    deckName: string;
    title: string;
    content: string;
    tags: string[];
    sourceCardCount: number;
}

interface AnkiCollectionData {
    collection: AnkiCollectionRow;
    cards: AnkiCardRow[];
}

/**
 * Imports card content and deck hierarchy from an Anki package. Scheduling, templates, and media
 * are intentionally left for later wizard stages; imported cards start with Trilium's current FSRS
 * defaults.
 */
async function importAnkiPackage(
    taskContext: TaskContext<"importNotes">,
    source: ZipSource,
    parentNote: BNote,
    originalFileName: string
): Promise<BNote> {
    const databaseBytes = await extractCollectionDatabase(source);
    const data = readCollection(databaseBytes);
    const plan = buildAnkiImportPlan(data.collection, data.cards);

    if (plan.notes.length === 0) {
        throw new ValidationError("The Anki package does not contain any cards.");
    }

    cls.setImportOrderPreserved(true);
    taskContext.setPhase("processing");
    taskContext.resetProgressCount();
    taskContext.setTotalCount(plan.notes.length);

    const isProtected = !!parentNote.isProtected
        && protectedSessionService.isProtectedSessionAvailable();
    let importRoot: BNote | undefined;
    const createdCardNotes: BNote[] = [];

    try {
        importRoot = noteService.createNewNote({
            parentNoteId: parentNote.noteId,
            title: removeFileExtension(originalFileName) || "Anki import",
            content: "",
            type: "book",
            isProtected
        }).note;
        const deckNotes = createDeckHierarchy(importRoot, plan.deckNames, isProtected);

        for (const imported of plan.notes) {
            const deckNote = deckNotes.get(imported.deckName);
            if (!deckNote) {
                throw new Error(`Missing imported Anki deck '${imported.deckName}'.`);
            }

            const { note } = noteService.createNewNote({
                parentNoteId: deckNote.noteId,
                title: imported.title,
                content: imported.content,
                type: "text",
                isProtected,
                attributes: imported.tags.length > 0
                    ? [{ type: "label", name: "ankiTags", value: imported.tags.join(" ") }]
                    : []
            });
            createdCardNotes.push(note);
            flashcardService.createCard({ noteId: note.noteId, deckNoteId: deckNote.noteId });
            taskContext.increaseProgressCount();
        }

        return importRoot;
    } catch (error) {
        cleanupFailedImport(importRoot, createdCardNotes);
        throw error;
    }
}

export function buildAnkiImportPlan(
    collection: AnkiCollectionRow,
    cardRows: AnkiCardRow[]
): AnkiImportPlan {
    const decks = parseRecord<AnkiDeck>(collection.decks, "deck metadata");
    const models = parseRecord<AnkiModel>(collection.models, "note-type metadata");
    const grouped = new Map<string, AnkiCardRow[]>();

    for (const row of cardRows) {
        const key = String(row.noteId);
        const rows = grouped.get(key) ?? [];
        rows.push(row);
        grouped.set(key, rows);
    }

    const notes: AnkiImportNote[] = [];
    const deckNames = new Set<string>();
    for (const [sourceNoteId, rows] of grouped) {
        const first = rows[0];
        if (!first) {
            continue;
        }

        const deckId = first.originalDeckId || first.deckId;
        const deckName = normalizeDeckName(decks[String(deckId)]?.name);
        const model = models[String(first.modelId)];
        const fields = String(first.fields ?? "").split(FIELD_SEPARATOR);
        const frontIndex = findFrontFieldIndex(model, fields.length);
        const front = fields[frontIndex] ?? "";
        const isCloze = model?.type === 1 || fields.some(isClozeContent);
        const contentFields = isCloze
            ? fields
            : fields.filter((_field, index) => index !== frontIndex);
        const content = sanitizeHtml(contentFields.filter(Boolean).join("<hr>"));

        deckNames.add(deckName);
        notes.push({
            sourceNoteId,
            deckName,
            title: buildNoteTitle(front, sourceNoteId, isCloze),
            content,
            tags: parseTags(first.tags),
            sourceCardCount: rows.reduce(
                (total, row) => total + (row.sourceCardCount ?? 1),
                0
            )
        });
    }

    return {
        deckNames: [ ...deckNames ].sort((a, b) => a.localeCompare(b)),
        notes
    };
}

export async function extractCollectionDatabase(
    source: ZipSource,
    zipProvider: ZipProvider = getZipProvider()
): Promise<Uint8Array> {
    let modernCompressed: Uint8Array | undefined;
    let modernLegacy: Uint8Array | undefined;
    let legacy: Uint8Array | undefined;
    let oversizedCollection = false;

    await zipProvider.readZipFile(source, async (entry, readContent) => {
        const fileName = entry.fileName.replace(/^\/+/, "");
        if (fileName === "collection.anki21b") {
            modernCompressed = await readContent();
        } else if (fileName === "collection.anki21") {
            modernLegacy = await readContent();
        } else if (fileName === "collection.anki2") {
            legacy = await readContent();
        }
    }, undefined, (entry) => {
        const isCollection = [
            "collection.anki21b",
            "collection.anki21",
            "collection.anki2"
        ].includes(entry.fileName.replace(/^\/+/, ""));
        if (isCollection && (entry.uncompressedSize ?? 0) > MAX_COLLECTION_SIZE) {
            oversizedCollection = true;
            return false;
        }
        return isCollection;
    });

    if (oversizedCollection) {
        throw new ValidationError("The Anki collection database is too large to import.");
    }

    let bytes: Uint8Array | undefined;
    if (modernCompressed) {
        try {
            bytes = await decompressCollection(modernCompressed);
        } catch (error) {
            if (error instanceof ValidationError) {
                throw error;
            }
            throw new ValidationError(
                `Unable to decompress Anki collection: ${describeError(error)}`
            );
        }
    } else {
        bytes = modernLegacy ?? legacy;
    }

    if (!bytes) {
        throw new ValidationError("The package does not contain an Anki collection database.");
    }
    if (bytes.byteLength > MAX_COLLECTION_SIZE) {
        throw new ValidationError("The Anki collection database is too large to import.");
    }
    if (decodeUtf8(bytes.subarray(0, SQLITE_HEADER.length)) !== SQLITE_HEADER) {
        throw new ValidationError("The Anki collection database is invalid.");
    }

    return bytes;
}

async function decompressCollection(compressed: Uint8Array): Promise<Uint8Array> {
    const { Decompress } = await import("fzstd");
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    const decompressor = new Decompress((chunk) => {
        totalSize += chunk.byteLength;
        if (totalSize > MAX_COLLECTION_SIZE) {
            throw new ValidationError("The Anki collection database is too large to import.");
        }
        chunks.push(chunk);
    });
    decompressor.push(compressed, true);

    const output = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}

function readCollection(bytes: Uint8Array): AnkiCollectionData {
    const database = getSql().openReadOnlyDatabase(bytes);
    try {
        const collection = readAnkiCollectionMetadata(database);
        const noteCount = database.getRows<{ noteCount: number }>(/*sql*/`
            SELECT COUNT(*) AS noteCount
            FROM (SELECT nid FROM cards GROUP BY nid)
        `)[0]?.noteCount ?? 0;
        if (noteCount > MAX_NOTE_COUNT) {
            throw new ValidationError(
                `The Anki package contains more than ${MAX_NOTE_COUNT} notes.`
            );
        }

        const cards = database.getRows<AnkiCardRow>(/*sql*/`
            WITH first_cards AS (
                SELECT nid, MIN(id) AS firstCardId, COUNT(*) AS sourceCardCount
                FROM cards
                GROUP BY nid
            )
            SELECT n.id AS noteId, n.mid AS modelId, n.flds AS fields, n.tags AS tags,
                   c.did AS deckId, c.odid AS originalDeckId, c.ord AS ordinal,
                   first_cards.sourceCardCount AS sourceCardCount
            FROM notes n
            JOIN first_cards ON first_cards.nid = n.id
            JOIN cards c ON c.id = first_cards.firstCardId
            ORDER BY n.id
        `);
        return { collection, cards };
    } catch (error) {
        if (error instanceof ValidationError) {
            throw error;
        }
        throw new ValidationError(`Unable to read Anki collection: ${describeError(error)}`);
    } finally {
        database.close();
    }
}

export function readAnkiCollectionMetadata(database: ReadOnlyDatabase): AnkiCollectionRow {
    const schema = database.getRows<AnkiSchemaRow>(
        "SELECT ver, decks, models FROM col LIMIT 1"
    )[0];
    if (!schema) {
        throw new ValidationError("The Anki collection metadata is missing.");
    }
    if (schema.ver < 15) {
        return schema;
    }

    const decks = Object.fromEntries(database.getRows<AnkiDeckRow>(
        "SELECT id, name FROM decks"
    ).map((deck) => [String(deck.id), { id: deck.id, name: deck.name }]));
    const models: Record<string, AnkiModel> = {};
    for (const field of database.getRows<AnkiFieldRow>(/*sql*/`
        SELECT ntid AS modelId, ord AS ordinal, name
        FROM fields
        ORDER BY ntid, ord
    `)) {
        const model = models[String(field.modelId)] ?? { flds: [] };
        model.flds?.push({ name: field.name, ord: field.ordinal });
        models[String(field.modelId)] = model;
    }

    return {
        decks: JSON.stringify(decks),
        models: JSON.stringify(models)
    };
}

function createDeckHierarchy(
    importRoot: BNote,
    deckNames: string[],
    isProtected: boolean
): Map<string, BNote> {
    const paths = new Map<string, BNote>();

    for (const deckName of deckNames) {
        let parent = importRoot;
        let path = "";
        for (const rawSegment of deckName.split("::")) {
            const segment = rawSegment.trim() || "Unnamed deck";
            path = path ? `${path}::${segment}` : segment;
            const existing = paths.get(path);
            if (existing) {
                parent = existing;
                continue;
            }

            const { note } = noteService.createNewNote({
                parentNoteId: parent.noteId,
                title: segment,
                content: "",
                type: "book",
                isProtected
            });
            paths.set(path, note);
            parent = note;
        }
    }

    return new Map(deckNames.map((name) => [name, paths.get(name)]).filter(
        (entry): entry is [string, BNote] => !!entry[1]
    ));
}

function cleanupFailedImport(importRoot: BNote | undefined, cardNotes: BNote[]) {
    for (const note of cardNotes.reverse()) {
        try {
            flashcardService.removeCardsForNote(note.noteId);
        } catch (cleanupError) {
            console.warn(`Unable to clean up imported card '${note.noteId}'.`, cleanupError);
        }
    }

    try {
        importRoot?.deleteNote();
    } catch (cleanupError) {
        console.warn("Unable to clean up failed Anki import.", cleanupError);
    }
}

function findFrontFieldIndex(model: AnkiModel | undefined, fieldCount: number): number {
    const fields = [ ...(model?.flds ?? []) ].sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
    const preferredNames = model?.type === 1
        ? ["text", "cloze"]
        : ["front", "question", "text", "cloze"];
    const preferred = fields.find((field) =>
        preferredNames.includes(field.name?.toLowerCase() ?? ""));
    const index = preferred?.ord ?? fields[0]?.ord ?? 0;
    return index >= 0 && index < fieldCount ? index : 0;
}

function buildNoteTitle(front: string, sourceNoteId: string, isCloze: boolean): string {
    const rendered = isCloze ? renderClozeBack(front, 0) : front;
    const plainText = unescapeHtml(striptags(rendered))
        .replace(/\[sound:[^\]]+]/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    return (plainText || `Anki card ${sourceNoteId}`).slice(0, 1000);
}

function normalizeDeckName(name: string | undefined): string {
    return name?.split("::").map((segment) => segment.trim() || "Unnamed deck").join("::")
        || "Default";
}

function parseTags(rawTags: string): string[] {
    return [ ...new Set(String(rawTags ?? "").trim().split(/\s+/).filter(Boolean)) ];
}

function parseRecord<T>(value: string, label: string): Record<string, T> {
    try {
        const parsed: unknown = JSON.parse(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("expected an object");
        }
        return parsed as Record<string, T>;
    } catch (error) {
        throw new ValidationError(`Invalid Anki ${label}: ${describeError(error)}`);
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export default {
    importAnkiPackage
};
