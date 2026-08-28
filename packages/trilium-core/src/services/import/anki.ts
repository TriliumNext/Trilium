import type { FlashcardRow } from "@triliumnext/commons";
import { parse } from "node-html-parser";
import striptags from "striptags";

import type BNote from "../../becca/entities/bnote.js";
import BFlashcard from "../../becca/entities/bflashcard.js";
import { ValidationError } from "../../errors.js";
import * as cls from "../context.js";
import { getCrypto } from "../encryption/crypto.js";
import { isClozeContent, renderClozeBack, renderClozeFront } from "../flashcards/cloze.js";
import flashcardService from "../flashcards/flashcard_service.js";
import noteService from "../notes.js";
import protectedSessionService from "../protected_session.js";
import { sanitizeHtml } from "../sanitizer.js";
import { getSql } from "../sql/index.js";
import type { ReadOnlyDatabase } from "../sql/types.js";
import type TaskContext from "../task_context.js";
import { decodeUtf8 } from "../utils/binary.js";
import dateUtils from "../utils/date.js";
import { escapeHtml, removeFileExtension, unescapeHtml } from "../utils/index.js";
import { getZipProvider, type ZipProvider, type ZipSource } from "../zip_provider.js";
import {
    applyAttachments,
    buildAttachmentIndex,
    type AttachmentIndex,
    resolveAttachment
} from "./obsidian/attachments.js";

const FIELD_SEPARATOR = "\u001f";
const SQLITE_HEADER = "SQLite format 3\u0000";
const MAX_COLLECTION_SIZE = 256 * 1024 * 1024;
const MAX_ARCHIVED_COLLECTION_SIZE = MAX_COLLECTION_SIZE + 4 * 1024 * 1024;
const MAX_NOTE_COUNT = 100_000;
const MAX_MEDIA_MAP_SIZE = 16 * 1024 * 1024;
const MAX_ARCHIVED_MEDIA_MAP_SIZE = MAX_MEDIA_MAP_SIZE + 1024 * 1024;
const MAX_MEDIA_FILE_SIZE = 64 * 1024 * 1024;
const MAX_ARCHIVED_MEDIA_FILE_SIZE = MAX_MEDIA_FILE_SIZE + 1024 * 1024;
const MAX_MEDIA_TOTAL_SIZE = 256 * 1024 * 1024;
const MAX_MEDIA_ENTRY_COUNT = 100_000;
const SOUND_PATTERN = /\[sound:([^\]]+)]/gi;
const FLASHCARD_FRONT_HTML_LABEL = "flashcardFrontHtml";

export interface AnkiCollectionRow {
    decks: string;
    models: string;
    crt?: number;
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

interface AnkiTemplateRow {
    modelId: number;
    ordinal: number;
    name: string;
    config: Uint8Array;
}

interface AnkiNotetypeRow {
    id: number;
    config: Uint8Array;
}

export interface AnkiCardRow {
    cardId?: number;
    noteId: number;
    modelId: number;
    fields: string;
    tags: string;
    deckId: number;
    originalDeckId: number;
    ordinal: number;
    modifiedAt?: number;
    type?: number;
    queue?: number;
    due?: number;
    interval?: number;
    factor?: number;
    reps?: number;
    lapses?: number;
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

interface AnkiTemplate {
    name?: string;
    ord?: number;
    qfmt?: string;
    afmt?: string;
    did?: number;
}

interface AnkiModel {
    type?: number;
    flds?: AnkiModelField[];
    tmpls?: AnkiTemplate[];
    css?: string;
}

export interface AnkiImportPlan {
    deckNames: string[];
    notes: AnkiImportNote[];
}

export interface AnkiImportNote {
    sourceNoteId: string;
    deckName: string;
    title: string;
    front: string;
    content: string;
    tags: string[];
    sourceCardCount: number;
    schedule?: AnkiSchedule;
}

interface AnkiCollectionData {
    collection: AnkiCollectionRow;
    cards: AnkiCardRow[];
}

interface AnkiSchedule {
    state: 0 | 1 | 2 | 3;
    due: string;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    learningSteps: number;
    reps: number;
    lapses: number;
    lastReview: string | null;
    suspended: boolean;
}

export interface AnkiMediaEntry {
    index: number;
    name: string;
    size?: number;
    sha1?: Uint8Array;
}

/**
 * Imports rendered card content, referenced media, deck hierarchy, and bounded scheduling state
 * from an Anki package. Imported Anki intervals seed Trilium's FSRS-compatible card rows; future
 * reviews still use Trilium's scheduler.
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

    const referencedMedia = collectReferencedMedia(plan.notes);
    const media = await extractAnkiMedia(source, referencedMedia);
    const mediaIndex = buildAttachmentIndex(media);

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
                attributes: [
                    {
                        type: "label" as const,
                        name: FLASHCARD_FRONT_HTML_LABEL,
                        value: imported.front
                    },
                    ...(imported.tags.length > 0
                        ? [{
                            type: "label" as const,
                            name: "ankiTags",
                            value: imported.tags.join(" ")
                        }]
                        : [])
                ]
            });
            createdCardNotes.push(note);
            const shrinkImages = !!taskContext.data?.shrinkImages;
            const frontWithMedia = applyAnkiMedia(note, imported.front, mediaIndex, shrinkImages);
            const contentWithMedia = applyAnkiMedia(
                note,
                imported.content,
                mediaIndex,
                shrinkImages
            );
            if (frontWithMedia !== imported.front) {
                note.setAttribute("label", FLASHCARD_FRONT_HTML_LABEL, frontWithMedia);
            }
            if (contentWithMedia !== imported.content) {
                note.setContent(contentWithMedia);
            }
            const createdCard = flashcardService.createCard({
                noteId: note.noteId,
                deckNoteId: deckNote.noteId
            });
            applyImportedSchedule(createdCard.cardId, imported.schedule);
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
        const sortedRows = rows.sort((a, b) => a.ordinal - b.ordinal);
        for (const row of sortedRows) {
            const model = models[String(row.modelId)];
            const fields = String(row.fields ?? "").split(FIELD_SEPARATOR);
            const isCloze = model?.type === 1 || fields.some(isClozeContent);
            const rendered = renderAnkiCard(model, fields, row.ordinal, isCloze, sourceNoteId);
            const deckId = row.originalDeckId || row.deckId || rendered.deckId;
            const deckName = normalizeDeckName(decks[String(deckId)]?.name);

            deckNames.add(deckName);
            notes.push({
                sourceNoteId,
                deckName,
                title: buildNoteTitle(rendered.front, sourceNoteId, false),
                front: rendered.front,
                content: rendered.back,
                tags: parseTags(row.tags),
                sourceCardCount: 1,
                schedule: buildAnkiSchedule(row, collection.crt)
            });
        }
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
            modernCompressed = await readContent(MAX_ARCHIVED_COLLECTION_SIZE);
        } else if (fileName === "collection.anki21") {
            modernLegacy = await readContent(MAX_COLLECTION_SIZE);
        } else if (fileName === "collection.anki2") {
            legacy = await readContent(MAX_COLLECTION_SIZE);
        }
    }, undefined, (entry) => {
        const isCollection = [
            "collection.anki21b",
            "collection.anki21",
            "collection.anki2"
        ].includes(entry.fileName.replace(/^\/+/, ""));
        const maximumSize = entry.fileName.replace(/^\/+/, "") === "collection.anki21b"
            ? MAX_ARCHIVED_COLLECTION_SIZE
            : MAX_COLLECTION_SIZE;
        if (isCollection && (entry.uncompressedSize ?? 0) > maximumSize) {
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
            bytes = await decompressZstd(
                modernCompressed,
                MAX_COLLECTION_SIZE,
                "The Anki collection database is too large to import."
            );
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

export async function extractAnkiMedia(
    source: ZipSource,
    requestedNames: Set<string>,
    zipProvider: ZipProvider = getZipProvider()
): Promise<Map<string, Uint8Array>> {
    if (requestedNames.size === 0) {
        return new Map();
    }

    let currentFormat = false;
    let mediaList: Uint8Array | undefined;
    let oversizedMap = false;
    await zipProvider.readZipFile(source, async (entry, readContent) => {
        const fileName = entry.fileName.replace(/^\/+/, "");
        if (fileName === "collection.anki21b") {
            currentFormat = true;
        } else if (fileName === "media") {
            mediaList = await readContent(MAX_ARCHIVED_MEDIA_MAP_SIZE);
        }
    }, undefined, (entry) => {
        const fileName = entry.fileName.replace(/^\/+/, "");
        if (fileName === "media"
            && (entry.uncompressedSize ?? 0) > MAX_ARCHIVED_MEDIA_MAP_SIZE) {
            oversizedMap = true;
            return false;
        }
        return fileName === "media" || fileName === "collection.anki21b";
    });

    if (oversizedMap) {
        throw new ValidationError("The Anki media map is too large to import.");
    }
    if (!mediaList) {
        return new Map();
    }
    if (!currentFormat && mediaList.byteLength > MAX_MEDIA_MAP_SIZE) {
        throw new ValidationError("The Anki media map is too large to import.");
    }

    const decodedMediaList = currentFormat
        ? await decompressZstd(
            mediaList,
            MAX_MEDIA_MAP_SIZE,
            "The Anki media map is too large to import."
        )
        : mediaList;
    const entries = currentFormat
        ? decodeCurrentMediaEntries(decodedMediaList)
        : decodeLegacyMediaEntries(decodedMediaList);
    const requestedEntries = entries.filter((entry) => requestedNames.has(entry.name));
    if (requestedEntries.length === 0) {
        return new Map();
    }
    if (requestedEntries.some((entry) => (entry.size ?? 0) > MAX_MEDIA_FILE_SIZE)) {
        throw new ValidationError("An Anki media file is too large to import.");
    }
    const declaredTotal = requestedEntries.reduce((total, entry) => total + (entry.size ?? 0), 0);
    if (declaredTotal > MAX_MEDIA_TOTAL_SIZE) {
        throw new ValidationError("Referenced Anki media is too large to import.");
    }

    const byIndex = new Map(requestedEntries.map((entry) => [String(entry.index), entry]));
    const result = new Map<string, Uint8Array>();
    let totalSize = 0;
    let oversizedFile = false;
    await zipProvider.readZipFile(source, async (entry, readContent) => {
        const mediaEntry = byIndex.get(entry.fileName.replace(/^\/+/, ""));
        if (!mediaEntry) {
            return;
        }

        const archived = await readContent(
            currentFormat ? MAX_ARCHIVED_MEDIA_FILE_SIZE : MAX_MEDIA_FILE_SIZE
        );
        const bytes = currentFormat
            ? await decompressZstd(
                archived,
                MAX_MEDIA_FILE_SIZE,
                `Anki media file '${mediaEntry.name}' is too large to import.`
            )
            : archived;
        validateCurrentMediaFile(mediaEntry, bytes, currentFormat);
        totalSize += bytes.byteLength;
        if (totalSize > MAX_MEDIA_TOTAL_SIZE) {
            throw new ValidationError("Referenced Anki media is too large to import.");
        }
        result.set(mediaEntry.name, bytes);
    }, undefined, (entry) => {
        const mediaEntry = byIndex.get(entry.fileName.replace(/^\/+/, ""));
        if (!mediaEntry) {
            return false;
        }
        const maximumSize = currentFormat
            ? MAX_ARCHIVED_MEDIA_FILE_SIZE
            : MAX_MEDIA_FILE_SIZE;
        if ((entry.uncompressedSize ?? 0) > maximumSize) {
            oversizedFile = true;
            return false;
        }
        return true;
    });

    if (oversizedFile) {
        throw new ValidationError("An Anki media file is too large to import.");
    }
    const missingEntry = requestedEntries.find((entry) => !result.has(entry.name));
    if (missingEntry) {
        throw new ValidationError(`Anki media file '${missingEntry.name}' is missing.`);
    }
    return result;
}

function validateCurrentMediaFile(
    entry: AnkiMediaEntry,
    bytes: Uint8Array,
    currentFormat: boolean
) {
    if (!currentFormat) {
        return;
    }
    if (entry.size !== bytes.byteLength || entry.sha1?.byteLength !== 20) {
        throw new ValidationError(`Anki media file '${entry.name}' is corrupt.`);
    }
    const hash = getCrypto().createHash("sha1", bytes);
    if (!getCrypto().constantTimeCompare(hash, entry.sha1)) {
        throw new ValidationError(`Anki media file '${entry.name}' is corrupt.`);
    }
}

export function decodeCurrentMediaEntries(data: Uint8Array): AnkiMediaEntry[] {
    const entries: AnkiMediaEntry[] = [];
    const cursor = { offset: 0 };
    while (cursor.offset < data.byteLength) {
        const key = readVarint(data, cursor);
        const fieldNumber = Math.floor(key / 8);
        const wireType = key % 8;
        if (fieldNumber === 1 && wireType === 2) {
            if (entries.length >= MAX_MEDIA_ENTRY_COUNT) {
                throw new ValidationError(
                    `The Anki package contains more than ${MAX_MEDIA_ENTRY_COUNT} media entries.`
                );
            }
            const message = readLengthDelimited(data, cursor);
            entries.push(decodeCurrentMediaEntry(message, entries.length));
        } else {
            skipProtobufField(data, cursor, wireType);
        }
    }
    return entries;
}

function decodeLegacyMediaEntries(data: Uint8Array): AnkiMediaEntry[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(decodeUtf8(data));
    } catch (error) {
        throw new ValidationError(`Invalid Anki media map: ${describeError(error)}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ValidationError("Invalid Anki media map: expected an object.");
    }

    const rawEntries = Object.entries(parsed);
    if (rawEntries.length > MAX_MEDIA_ENTRY_COUNT) {
        throw new ValidationError(
            `The Anki package contains more than ${MAX_MEDIA_ENTRY_COUNT} media entries.`
        );
    }

    const entries: AnkiMediaEntry[] = [];
    for (const [rawIndex, rawName] of rawEntries) {
        const index = Number(rawIndex);
        if (Number.isSafeInteger(index) && index >= 0 && typeof rawName === "string") {
            entries.push({ index, name: rawName });
        }
    }
    return entries;
}

function decodeModernNotetypeConfig(data: Uint8Array): AnkiModel {
    const cursor = { offset: 0 };
    const model: AnkiModel = { flds: [], tmpls: [] };
    while (cursor.offset < data.byteLength) {
        const key = readVarint(data, cursor);
        const fieldNumber = Math.floor(key / 8);
        const wireType = key % 8;
        if (fieldNumber === 1 && wireType === 0) {
            model.type = readVarint(data, cursor);
        } else if (fieldNumber === 3 && wireType === 2) {
            model.css = decodeUtf8(readLengthDelimited(data, cursor));
        } else {
            skipProtobufField(data, cursor, wireType);
        }
    }
    return model;
}

function decodeModernTemplateConfig(template: AnkiTemplateRow): AnkiTemplate {
    const cursor = { offset: 0 };
    const result: AnkiTemplate = { name: template.name, ord: template.ordinal };
    while (cursor.offset < template.config.byteLength) {
        const key = readVarint(template.config, cursor);
        const fieldNumber = Math.floor(key / 8);
        const wireType = key % 8;
        if (fieldNumber === 1 && wireType === 2) {
            result.qfmt = decodeUtf8(readLengthDelimited(template.config, cursor));
        } else if (fieldNumber === 2 && wireType === 2) {
            result.afmt = decodeUtf8(readLengthDelimited(template.config, cursor));
        } else if (fieldNumber === 5 && wireType === 0) {
            result.did = readVarint(template.config, cursor);
        } else {
            skipProtobufField(template.config, cursor, wireType);
        }
    }
    return result;
}

function decodeCurrentMediaEntry(data: Uint8Array, defaultIndex: number): AnkiMediaEntry {
    const cursor = { offset: 0 };
    let name = "";
    let size: number | undefined;
    let sha1: Uint8Array | undefined;
    while (cursor.offset < data.byteLength) {
        const key = readVarint(data, cursor);
        const fieldNumber = Math.floor(key / 8);
        const wireType = key % 8;
        if (fieldNumber === 1 && wireType === 2) {
            name = decodeUtf8(readLengthDelimited(data, cursor));
        } else if (fieldNumber === 2 && wireType === 0) {
            size = readVarint(data, cursor);
        } else if (fieldNumber === 3 && wireType === 2) {
            sha1 = readLengthDelimited(data, cursor);
        } else {
            skipProtobufField(data, cursor, wireType);
        }
    }
    if (!name) {
        throw new ValidationError("Invalid Anki media map: media filename is missing.");
    }
    return {
        index: defaultIndex,
        name,
        ...(size === undefined ? {} : { size }),
        ...(sha1 === undefined ? {} : { sha1 })
    };
}

function readVarint(data: Uint8Array, cursor: { offset: number }): number {
    let value = 0;
    let shift = 0;
    while (cursor.offset < data.byteLength && shift <= 49) {
        const byte = data[cursor.offset++];
        value += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) {
            if (!Number.isSafeInteger(value)) {
                break;
            }
            return value;
        }
        shift += 7;
    }
    throw new ValidationError("Invalid Anki media map: malformed protobuf varint.");
}

function readLengthDelimited(data: Uint8Array, cursor: { offset: number }): Uint8Array {
    const length = readVarint(data, cursor);
    const end = cursor.offset + length;
    if (end > data.byteLength) {
        throw new ValidationError("Invalid Anki media map: truncated protobuf field.");
    }
    const value = data.subarray(cursor.offset, end);
    cursor.offset = end;
    return value;
}

function skipProtobufField(data: Uint8Array, cursor: { offset: number }, wireType: number) {
    if (wireType === 0) {
        readVarint(data, cursor);
    } else if (wireType === 1) {
        cursor.offset += 8;
    } else if (wireType === 2) {
        cursor.offset += readVarint(data, cursor);
    } else if (wireType === 5) {
        cursor.offset += 4;
    } else {
        throw new ValidationError(`Invalid Anki media map: unsupported wire type ${wireType}.`);
    }
    if (cursor.offset > data.byteLength) {
        throw new ValidationError("Invalid Anki media map: truncated protobuf field.");
    }
}

async function decompressZstd(
    compressed: Uint8Array,
    maximumSize: number,
    tooLargeMessage: string
): Promise<Uint8Array> {
    const { Decompress } = await import("fzstd");
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    const decompressor = new Decompress((chunk) => {
        totalSize += chunk.byteLength;
        if (totalSize > maximumSize) {
            throw new ValidationError(tooLargeMessage);
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

        const cards = readAnkiCards(database);
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

function readAnkiCards(database: ReadOnlyDatabase): AnkiCardRow[] {
    try {
        return database.getRows<AnkiCardRow>(/*sql*/`
            SELECT c.id AS cardId, n.id AS noteId, n.mid AS modelId, n.flds AS fields,
                   n.tags AS tags, c.did AS deckId, c.odid AS originalDeckId,
                   c.ord AS ordinal, c.type AS type, c.queue AS queue, c.due AS due,
                   c.ivl AS interval, c.factor AS factor, c.reps AS reps,
                   c.lapses AS lapses,
                   COUNT(*) OVER (PARTITION BY n.id) AS sourceCardCount
            FROM notes n
            JOIN cards c ON c.nid = n.id
            ORDER BY n.id, c.ord
        `);
    } catch {
        return database.getRows<AnkiCardRow>(/*sql*/`
            SELECT n.id AS noteId, n.mid AS modelId, n.flds AS fields, n.tags AS tags,
                   c.did AS deckId, c.odid AS originalDeckId, c.ord AS ordinal,
                   COUNT(*) OVER (PARTITION BY n.id) AS sourceCardCount
            FROM notes n
            JOIN cards c ON c.nid = n.id
            ORDER BY n.id, c.ord
        `);
    }
}

export function readAnkiCollectionMetadata(database: ReadOnlyDatabase): AnkiCollectionRow {
    const schema = database.getRows<AnkiSchemaRow>(
        "SELECT ver, decks, models FROM col LIMIT 1"
    )[0];
    if (!schema) {
        throw new ValidationError("The Anki collection metadata is missing.");
    }
    const crt = readCollectionCreatedAt(database);
    if (schema.ver < 15) {
        return { ...schema, crt };
    }

    const decks = Object.fromEntries(database.getRows<AnkiDeckRow>(
        "SELECT id, name FROM decks"
    ).map((deck) => [String(deck.id), { id: deck.id, name: deck.name }]));
    const models: Record<string, AnkiModel> = {};
    for (const notetype of database.getRows<AnkiNotetypeRow>("SELECT id, config FROM notetypes")) {
        models[String(notetype.id)] = decodeModernNotetypeConfig(notetype.config);
    }
    for (const field of database.getRows<AnkiFieldRow>(/*sql*/`
        SELECT ntid AS modelId, ord AS ordinal, name
        FROM fields
        ORDER BY ntid, ord
    `)) {
        const model = models[String(field.modelId)] ?? { flds: [] };
        model.flds = model.flds ?? [];
        model.flds.push({ name: field.name, ord: field.ordinal });
        models[String(field.modelId)] = model;
    }
    for (const template of database.getRows<AnkiTemplateRow>(/*sql*/`
        SELECT ntid AS modelId, ord AS ordinal, name, config
        FROM templates
        ORDER BY ntid, ord
    `)) {
        const model = models[String(template.modelId)] ?? { flds: [], tmpls: [] };
        model.tmpls = model.tmpls ?? [];
        model.tmpls.push(decodeModernTemplateConfig(template));
        models[String(template.modelId)] = model;
    }

    return {
        crt,
        decks: JSON.stringify(decks),
        models: JSON.stringify(models)
    };
}

function readCollectionCreatedAt(database: ReadOnlyDatabase): number | undefined {
    try {
        const row = database.getRows<{ crt?: number }>("SELECT crt FROM col LIMIT 1")[0];
        return row?.crt;
    } catch {
        return undefined;
    }
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

export function collectReferencedMedia(notes: AnkiImportNote[]): Set<string> {
    const references = new Set<string>();
    for (const note of notes) {
        const root = parse(`${note.front}${note.content}`);
        for (const image of root.querySelectorAll("img[src]")) {
            const reference = normalizeMediaReference(image.getAttribute("src"));
            if (reference) {
                references.add(reference);
            }
        }
        for (const anchor of root.querySelectorAll("a[href]")) {
            const reference = normalizeMediaReference(anchor.getAttribute("href"));
            if (reference) {
                references.add(reference);
            }
        }
        const fullContent = `${note.front}${note.content}`;
        for (const match of fullContent.matchAll(new RegExp(SOUND_PATTERN.source, "gi"))) {
            const reference = normalizeMediaReference(match[1]);
            if (reference) {
                references.add(reference);
            }
        }
    }
    return references;
}

export function applyAnkiMedia(
    note: BNote,
    content: string,
    mediaIndex: AttachmentIndex,
    shrinkImages: boolean
): string {
    if (mediaIndex.byPath.size === 0) {
        return content;
    }

    const withSoundLinks = content.replace(
        new RegExp(SOUND_PATTERN.source, "gi"),
        (match, rawName: string) => {
            const name = normalizeMediaReference(rawName);
            if (!name || !resolveAttachment(mediaIndex, name)) {
                return match;
            }
            const href = name.split("/").map(encodeURIComponent).join("/");
            return `<a href="${href}">${escapeHtml(name)}</a>`;
        }
    );
    return applyAttachments(note, withSoundLinks, mediaIndex, shrinkImages);
}

function applyImportedSchedule(cardId: string, schedule: AnkiSchedule | undefined) {
    if (!schedule) {
        return;
    }

    const row = getSql().getRow<FlashcardRow>(/*sql*/`
        SELECT * FROM flashcards WHERE cardId = ? AND isDeleted = 0`, [cardId]);
    if (!row) {
        return;
    }

    new BFlashcard({
        ...row,
        ...schedule,
        schedulingRevision: Math.max(row.schedulingRevision ?? 0, schedule.reps)
    }).save();
}

function buildAnkiSchedule(
    row: AnkiCardRow,
    collectionCreatedAt: number | undefined
): AnkiSchedule {
    const queue = row.queue ?? row.type ?? 0;
    const type = row.type ?? queue;
    const reps = Math.max(0, Math.round(Number(row.reps ?? 0)));
    const lapses = Math.max(0, Math.round(Number(row.lapses ?? 0)));
    const interval = Math.max(0, Math.round(Number(row.interval ?? 0)));
    const factor = Math.max(1300, Math.round(Number(row.factor ?? 2500)));
    const lastReview = reps > 0 ? unixSecondsToUtcDateTime(row.modifiedAt) : null;
    const state = getAnkiScheduleState(type, queue, reps);

    return {
        state,
        due: getAnkiDueDate(row, collectionCreatedAt, state),
        stability: state === 0 ? 0 : Math.max(0.1, interval || 0.1),
        difficulty: ankiFactorToDifficulty(factor),
        elapsedDays: lastReview ? daysBetween(lastReview, new Date()) : 0,
        scheduledDays: interval,
        learningSteps: state === 1 || state === 3 ? 1 : 0,
        reps,
        lapses,
        lastReview,
        suspended: queue < 0
    };
}

function getAnkiScheduleState(type: number, queue: number, reps: number): 0 | 1 | 2 | 3 {
    if (type === 3) {
        return 3;
    }
    if (type === 1 || queue === 1 || queue === 3) {
        return 1;
    }
    if (type === 2 || queue === 2 || reps > 0) {
        return 2;
    }
    return 0;
}

function getAnkiDueDate(
    row: AnkiCardRow,
    collectionCreatedAt: number | undefined,
    state: 0 | 1 | 2 | 3
): string {
    const due = Number(row.due ?? 0);
    if (!Number.isFinite(due)) {
        return dateUtils.utcNowDateTime();
    }

    if (state === 2 && collectionCreatedAt !== undefined) {
        return unixSecondsToUtcDateTime(collectionCreatedAt + Math.max(0, due) * 86400);
    }

    if ((state === 1 || state === 3) && due > 1_000_000_000) {
        return unixSecondsToUtcDateTime(due);
    }

    return dateUtils.utcNowDateTime();
}

function ankiFactorToDifficulty(factor: number) {
    return Math.max(1, Math.min(10, 5 + ((2500 - factor) / 300)));
}

function unixSecondsToUtcDateTime(value: number | undefined) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return dateUtils.utcNowDateTime();
    }
    return dateUtils.utcDateTimeStr(new Date(seconds * 1000));
}

function daysBetween(value: string, now: Date) {
    const date = new Date(value.replace(" ", "T"));
    if (!Number.isFinite(date.getTime())) {
        return 0;
    }
    return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
}

function normalizeMediaReference(value: string | undefined): string | null {
    if (!value || /^(?:https?:|data:|mailto:|tel:|#|api\/)/i.test(value)) {
        return null;
    }
    try {
        return decodeURIComponent(unescapeHtml(value).replace(/^\/+/, "")).trim() || null;
    } catch {
        return unescapeHtml(value).replace(/^\/+/, "").trim() || null;
    }
}

interface RenderedAnkiCard {
    front: string;
    back: string;
    deckId?: number;
}

function renderAnkiCard(
    model: AnkiModel | undefined,
    fields: string[],
    ordinal: number,
    isCloze: boolean,
    sourceNoteId: string
): RenderedAnkiCard {
    const template = model?.tmpls?.find((candidate) => candidate.ord === ordinal)
        ?? model?.tmpls?.[ordinal]
        ?? model?.tmpls?.[0];
    const fieldValues = buildFieldMap(model, fields);

    if (template?.qfmt || template?.afmt) {
        const front = sanitizeHtml(renderAnkiTemplate(
            template.qfmt || "{{Front}}",
            fieldValues,
            ordinal,
            isCloze,
            false
        ));
        const backTemplate = (template.afmt || "{{FrontSide}}<hr id=answer>{{Back}}")
            .replace(/\{\{FrontSide}}/g, front);
        const back = sanitizeHtml(renderAnkiTemplate(
            backTemplate,
            fieldValues,
            ordinal,
            isCloze,
            true
        ));
        return {
            front,
            back: wrapAnkiCardBack(back, model?.css),
            deckId: template.did
        };
    }

    const frontIndex = findFrontFieldIndex(model, fields.length);
    const front = fields[frontIndex] ?? "";
    const contentFields = isCloze
        ? fields
        : fields.filter((_field, index) => index !== frontIndex);
    const content = contentFields.filter(Boolean).join("<hr>");

    return {
        front: sanitizeHtml(isCloze ? renderClozeFront(front, ordinal) : front),
        back: wrapAnkiCardBack(
            sanitizeHtml(isCloze ? renderClozeBack(content, ordinal) : content),
            model?.css
        ),
        deckId: undefined
    };
}

function buildFieldMap(model: AnkiModel | undefined, fields: string[]): Map<string, string> {
    const values = new Map<string, string>();
    for (let index = 0; index < fields.length; index++) {
        values.set(String(index), fields[index] ?? "");
    }
    for (const field of model?.flds ?? []) {
        const ordinal = field.ord ?? 0;
        if (field.name && ordinal >= 0 && ordinal < fields.length) {
            values.set(field.name, fields[ordinal] ?? "");
        }
    }
    return values;
}

function renderAnkiTemplate(
    template: string,
    fields: Map<string, string>,
    ordinal: number,
    isCloze: boolean,
    revealCloze: boolean
): string {
    let rendered = template
        .replace(/\{\{#([^}]+)}}([\s\S]*?)\{\{\/\1}}/g, (_match, name: string, body: string) =>
            getAnkiFieldValue(fields, name).trim() ? body : "")
        .replace(/\{\{\^([^}]+)}}([\s\S]*?)\{\{\/\1}}/g, (_match, name: string, body: string) =>
            getAnkiFieldValue(fields, name).trim() ? "" : body);

    rendered = rendered.replace(/\{\{([^}]+)}}/g, (match, rawName: string) => {
        const name = rawName.trim();
        if (name.startsWith("type:")) {
            return "";
        }
        if (name.startsWith("cloze:")) {
            const value = getAnkiFieldValue(fields, name.slice("cloze:".length));
            if (!isCloze) {
                return value;
            }
            return revealCloze ? renderClozeBack(value, ordinal) : renderClozeFront(value, ordinal);
        }
        return getAnkiFieldValue(fields, name) || match;
    });

    return rendered;
}

function getAnkiFieldValue(fields: Map<string, string>, name: string): string {
    return fields.get(name.trim()) ?? "";
}

function wrapAnkiCardBack(back: string, css: string | undefined): string {
    const trimmedCss = css?.trim();
    if (!trimmedCss) {
        return back;
    }

    return [
        back,
        "<hr /><details><summary>Anki card CSS</summary><pre>",
        escapeHtml(trimmedCss),
        "</pre></details>"
    ].join("");
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
