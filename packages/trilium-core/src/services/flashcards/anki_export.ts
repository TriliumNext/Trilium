import type { FlashcardCardType, FlashcardReviewRow, FlashcardRow } from "@triliumnext/commons";
import type { Response } from "express";

import becca from "../../becca/becca.js";
import type BAttachment from "../../becca/entities/battachment.js";
import { getSql } from "../sql/index.js";
import type { IsolatedDatabase } from "../sql/types.js";
import { escapeHtml, getContentDisposition } from "../utils/index.js";
import { getZipProvider } from "../zip_provider.js";

const ANKI_FIELD_SEPARATOR = "\u001f";
const BASIC_MODEL_ID = 1700000000001;
const CLOZE_MODEL_ID = 1700000000002;
const DEFAULT_DECK_ID = 1;
const TRILIUM_TAG = "trilium";

interface ExportedCard {
    card: FlashcardRow;
    noteId: number;
    cardId: number;
    deckId: number;
    modelId: number;
    ordinal: number;
    fields: string;
    sortField: string;
    tags: string;
    modifiedSeconds: number;
    due: number;
    interval: number;
    factor: number;
    cardType: number;
    queue: number;
}

interface MediaFile {
    fileName: string;
    content: Uint8Array;
}

export async function exportFlashcardsToAnki(res: Response): Promise<void> {
    const { collection, media } = buildAnkiCollection();
    const fileName = `trilium-flashcards-${new Date().toISOString().slice(0, 10)}.apkg`;
    const zip = getZipProvider().createZipArchive();

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", getContentDisposition(fileName));
    (res as Response & { triliumResponseHandled?: boolean }).triliumResponseHandled = true;

    zip.pipe(res);
    zip.append(collection, { name: "collection.anki2", store: true });
    const mediaMap = Object.fromEntries(media.map((file, index) => [
        index.toString(),
        file.fileName
    ]));
    zip.append(JSON.stringify(mediaMap), { name: "media" });

    for (const [index, file] of media.entries()) {
        zip.append(file.content, { name: index.toString(), store: true });
        await zip.waitForCapacity?.();
    }

    await zip.finalize();
}

function buildAnkiCollection(): { collection: Uint8Array; media: MediaFile[] } {
    const cards = getSql().getRows<FlashcardRow>(/*sql*/`
        SELECT * FROM flashcards WHERE isDeleted = 0
        ORDER BY deckNoteId, noteId, ordinal, cardId`);
    const reviews = getSql().getRows<FlashcardReviewRow>(/*sql*/`
        SELECT flashcard_reviews.*
        FROM flashcard_reviews
        JOIN flashcards USING (cardId)
        WHERE flashcards.isDeleted = 0
        ORDER BY reviewedAt, reviewId`);
    const media: MediaFile[] = [];
    const mediaNames = new Set<string>();
    const exported = buildExportedCards(cards, media, mediaNames);
    const decks = buildDecks(exported);
    const db = getSql().createIsolatedDatabase();

    try {
        createAnkiSchema(db);
        insertCollection(db, decks);
        insertNotesAndCards(db, exported);
        insertReviews(db, reviews, exported);
        return { collection: db.serialize(), media };
    } finally {
        db.close();
    }
}

function buildExportedCards(
    cards: FlashcardRow[],
    media: MediaFile[],
    mediaNames: Set<string>
): ExportedCard[] {
    const baseId = Date.now() * 1000;
    const deckIds = new Map<string, number>();
    const exported: ExportedCard[] = [];

    for (const [index, card] of cards.entries()) {
        const note = becca.getNote(card.noteId);
        if (!note || note.isDeleted || !note.isContentAvailable()) {
            continue;
        }

        const deckId = deckIds.get(card.deckNoteId)
            ?? stableAnkiId(card.deckNoteId, DEFAULT_DECK_ID + 1);
        deckIds.set(card.deckNoteId, deckId);

        const cardType = card.cardType ?? "basic";
        const ordinal = Math.max(0, card.ordinal ?? 0);
        const modifiedSeconds = Math.floor(
            Date.parse(card.utcDateModified ?? new Date().toISOString()) / 1000
        );
        const frontHtml = readOwnedLabel(note, "flashcardFrontHtml");
        const frontSource = frontHtml ?? escapeHtml(note.getTitleOrProtected());
        const front = rewriteTriliumMedia(frontSource, media, mediaNames);
        const content = note.getContent();
        const backSource = typeof content === "string" ? content : "";
        const back = rewriteTriliumMedia(backSource, media, mediaNames);
        const modelId = cardType === "cloze" ? CLOZE_MODEL_ID : BASIC_MODEL_ID;
        const fields = cardType === "cloze"
            ? [back, front].join(ANKI_FIELD_SEPARATOR)
            : [front, back].join(ANKI_FIELD_SEPARATOR);
        const ankiNoteId = baseId + index + 1;

        exported.push({
            card,
            noteId: ankiNoteId,
            cardId: baseId + cards.length + index + 1,
            deckId,
            modelId,
            ordinal,
            fields,
            sortField: stripHtml(front || note.title).slice(0, 512),
            tags: buildTags(cardType),
            modifiedSeconds,
            due: toAnkiDue(card),
            interval: Math.trunc(card.scheduledDays ?? 0),
            factor: Math.max(
                1300,
                Math.round((card.difficulty ? 11 - card.difficulty : 2.5) * 1000)
            ),
            cardType: toAnkiCardType(card),
            queue: toAnkiQueue(card)
        });
    }

    return exported;
}

function createAnkiSchema(db: IsolatedDatabase) {
    db.exec(/*sql*/`
        CREATE TABLE col (
            id integer primary key,
            crt integer not null,
            mod integer not null,
            scm integer not null,
            ver integer not null,
            dty integer not null,
            usn integer not null,
            ls integer not null,
            conf text not null,
            models text not null,
            decks text not null,
            dconf text not null,
            tags text not null
        );
        CREATE TABLE notes (
            id integer primary key,
            guid text not null,
            mid integer not null,
            mod integer not null,
            usn integer not null,
            tags text not null,
            flds text not null,
            sfld integer not null,
            csum integer not null,
            flags integer not null,
            data text not null
        );
        CREATE TABLE cards (
            id integer primary key,
            nid integer not null,
            did integer not null,
            ord integer not null,
            mod integer not null,
            usn integer not null,
            type integer not null,
            queue integer not null,
            due integer not null,
            ivl integer not null,
            factor integer not null,
            reps integer not null,
            lapses integer not null,
            left integer not null,
            odue integer not null,
            odid integer not null,
            flags integer not null,
            data text not null
        );
        CREATE TABLE revlog (
            id integer primary key,
            cid integer not null,
            usn integer not null,
            ease integer not null,
            ivl integer not null,
            lastIvl integer not null,
            factor integer not null,
            time integer not null,
            type integer not null
        );
        CREATE INDEX ix_notes_usn on notes (usn);
        CREATE INDEX ix_cards_usn on cards (usn);
        CREATE INDEX ix_cards_nid on cards (nid);
        CREATE INDEX ix_cards_sched on cards (did, queue, due);
        CREATE INDEX ix_revlog_usn on revlog (usn);
        CREATE INDEX ix_revlog_cid on revlog (cid);
    `);
}

function insertCollection(db: IsolatedDatabase, decks: Record<string, unknown>) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(/*sql*/`
        INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        1,
        now,
        now,
        Date.now(),
        11,
        0,
        -1,
        0,
        JSON.stringify({
            nextPos: 1,
            estTimes: true,
            activeDecks: [DEFAULT_DECK_ID],
            curDeck: DEFAULT_DECK_ID
        }),
        JSON.stringify(buildModels()),
        JSON.stringify(decks),
        JSON.stringify({
            1: { id: 1, name: "Default", replayq: true, lapse: {}, rev: {}, new: {} }
        }),
        JSON.stringify({})
    );
}

function insertNotesAndCards(db: IsolatedDatabase, cards: ExportedCard[]) {
    const insertNote = db.prepare(/*sql*/`
        INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertCard = db.prepare(/*sql*/`
        INSERT INTO cards (
            id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps,
            lapses, left, odue, odid, flags, data
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const exported of cards) {
        insertNote.run(
            exported.noteId,
            exported.card.cardId ?? exported.noteId.toString(),
            exported.modelId,
            exported.modifiedSeconds,
            -1,
            exported.tags,
            exported.fields,
            exported.sortField,
            checksum(exported.sortField),
            0,
            ""
        );
        insertCard.run(
            exported.cardId,
            exported.noteId,
            exported.deckId,
            exported.ordinal,
            exported.modifiedSeconds,
            -1,
            exported.cardType,
            exported.queue,
            exported.due,
            exported.interval,
            exported.factor,
            exported.card.reps ?? 0,
            exported.card.lapses ?? 0,
            0,
            0,
            0,
            0,
            ""
        );
    }
}

function insertReviews(
    db: IsolatedDatabase,
    reviews: FlashcardReviewRow[],
    exportedCards: ExportedCard[]
) {
    const byCardId = new Map(exportedCards.map((card) => [card.card.cardId, card]));
    const insertReview = db.prepare(/*sql*/`
        INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [index, review] of reviews.entries()) {
        const exported = byCardId.get(review.cardId);
        if (!exported) {
            continue;
        }
        insertReview.run(
            Date.parse(review.reviewedAt) + index,
            exported.cardId,
            -1,
            review.rating,
            Math.trunc(review.scheduledDays),
            Math.trunc(review.scheduledDaysBefore),
            exported.factor,
            Math.max(0, Math.trunc((review.durationMs ?? 0) / 1000)),
            toAnkiRevlogType(review.state)
        );
    }
}

function buildDecks(cards: ExportedCard[]): Record<string, unknown> {
    const decks: Record<string, unknown> = {
        [DEFAULT_DECK_ID]: buildDeck(DEFAULT_DECK_ID, "Trilium Flashcards")
    };

    for (const card of cards) {
        const deck = becca.getNote(card.card.deckNoteId);
        const title = deck?.getTitleOrProtected() || "Trilium Flashcards";
        decks[card.deckId] = buildDeck(card.deckId, title);
    }

    return decks;
}

function buildDeck(id: number, name: string) {
    return {
        id,
        name: sanitizeDeckName(name),
        mtime_secs: Math.floor(Date.now() / 1000),
        usn: -1,
        collapsed: false,
        browserCollapsed: false,
        desc: "",
        dyn: 0,
        conf: 1,
        extendNew: 0,
        extendRev: 0,
        reviewLimit: null,
        newLimit: null
    };
}

function buildModels() {
    return {
        [BASIC_MODEL_ID]: {
            id: BASIC_MODEL_ID,
            name: "Trilium Basic",
            type: 0,
            mod: Date.now(),
            usn: -1,
            sortf: 0,
            did: null,
            tmpls: [
                {
                    name: "Card 1",
                    ord: 0,
                    qfmt: "{{Front}}",
                    afmt: "{{FrontSide}}<hr id=answer>{{Back}}"
                }
            ],
            flds: [
                { name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20 },
                { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20 }
            ],
            css: [
                ".card { font-family: arial; font-size: 20px; text-align: center;",
                "color: black; background-color: white; }"
            ].join(" "),
            latexPre: "",
            latexPost: ""
        },
        [CLOZE_MODEL_ID]: {
            id: CLOZE_MODEL_ID,
            name: "Trilium Cloze",
            type: 1,
            mod: Date.now(),
            usn: -1,
            sortf: 0,
            did: null,
            tmpls: [
                {
                    name: "Cloze",
                    ord: 0,
                    qfmt: "{{cloze:Text}}",
                    afmt: "{{cloze:Text}}<br>{{Extra}}"
                }
            ],
            flds: [
                { name: "Text", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20 },
                { name: "Extra", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20 }
            ],
            css: [
                ".card { font-family: arial; font-size: 20px; text-align: center;",
                "color: black; background-color: white; }",
                ".cloze { font-weight: bold; color: blue; }"
            ].join(" "),
            latexPre: "",
            latexPost: ""
        }
    };
}

function rewriteTriliumMedia(html: string, media: MediaFile[], mediaNames: Set<string>): string {
    return html.replace(/(?:src|href)=["']([^"']+)["']/gi, (match, rawUrl: string) => {
        const attachment = findAttachment(rawUrl);
        if (!attachment || !attachment.isContentAvailable()) {
            return match;
        }

        const rawTitle = attachment.title || `${attachment.attachmentId}.bin`;
        const fileName = uniqueMediaName(rawTitle, mediaNames);
        media.push({ fileName, content: attachment.getContent() });
        return match.replace(rawUrl, fileName);
    });
}

function findAttachment(rawUrl: string): BAttachment | null {
    const decoded = safeDecode(rawUrl);
    const patterns = [
        /api\/attachments\/([^/?#]+)\//,
        /[?&]attachmentId=([^&#]+)/
    ];

    for (const pattern of patterns) {
        const match = pattern.exec(decoded);
        if (match?.[1]) {
            return becca.getAttachment(match[1]) ?? null;
        }
    }

    return null;
}

function uniqueMediaName(rawTitle: string, usedNames: Set<string>): string {
    const clean = rawTitle.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "media.bin";
    const dot = clean.lastIndexOf(".");
    const base = dot > 0 ? clean.slice(0, dot) : clean;
    const extension = dot > 0 ? clean.slice(dot) : "";
    let candidate = clean;
    let suffix = 2;

    while (usedNames.has(candidate)) {
        candidate = `${base}-${suffix}${extension}`;
        suffix++;
    }

    usedNames.add(candidate);
    return candidate;
}

function toAnkiCardType(card: FlashcardRow): number {
    if ((card.reps ?? 0) === 0) {
        return 0;
    }
    return card.state === 3 ? 3 : 2;
}

function toAnkiQueue(card: FlashcardRow): number {
    if (card.suspended) {
        return -1;
    }
    if (card.state === 0) {
        return 0;
    }
    if (card.state === 1 || card.state === 3) {
        return 1;
    }
    return 2;
}

function toAnkiDue(card: FlashcardRow): number {
    if (card.state === 0) {
        return 0;
    }
    if (card.state === 1 || card.state === 3) {
        return Math.floor(Date.parse(card.due) / 1000);
    }
    return Math.max(0, Math.ceil((Date.parse(card.due) - Date.now()) / 86_400_000));
}

function toAnkiRevlogType(state: number): number {
    if (state === 0) return 0;
    if (state === 2) return 1;
    if (state === 3) return 3;
    return 0;
}

function readOwnedLabel(
    note: { getOwnedLabelValue?: (name: string) => string | null | undefined },
    name: string
): string | null {
    return note.getOwnedLabelValue?.(name) ?? null;
}

function buildTags(cardType: FlashcardCardType): string {
    return cardType === "cloze" ? ` ${TRILIUM_TAG} trilium-cloze ` : ` ${TRILIUM_TAG} `;
}

function stableAnkiId(value: string, floor: number): number {
    return floor + (checksum(value) % 2_000_000_000);
}

function checksum(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function sanitizeDeckName(name: string): string {
    return name.replace(/::/g, " - ").trim() || "Trilium Flashcards";
}

function stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
