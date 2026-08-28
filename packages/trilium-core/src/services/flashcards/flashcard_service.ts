import { dayjs, FLASHCARD_EXPORT_FORMAT, FLASHCARD_EXPORT_FORMAT_VERSION } from "@triliumnext/commons";
import type {
    FlashcardActionResponse,
    FlashcardBuryRequest,
    FlashcardCardSummary,
    FlashcardCreateRequest,
    FlashcardDeckMoveRequest,
    FlashcardDeckSummary,
    FlashcardDecksResponse,
    FlashcardDueResponse,
    FlashcardExportPayload,
    FlashcardImportRequest,
    FlashcardImportResponse,
    FlashcardLeechesResponse,
    FlashcardLeechSummary,
    FlashcardRating,
    FlashcardResetRequest,
    FlashcardReviewCard,
    FlashcardPreviewResponse,
    FlashcardRemoveResponse,
    FlashcardReviewRequest,
    FlashcardReviewResponse,
    FlashcardReviewRow,
    FlashcardRow,
    FlashcardSettingsResponse,
    FlashcardSettingsUpdateRequest,
    FlashcardStatsResponse,
    FlashcardSuspensionRequest,
    FlashcardUndoRequest,
    FlashcardSetDueDateRequest
} from "@triliumnext/commons";

import becca from "../../becca/becca.js";
import BAttribute from "../../becca/entities/battribute.js";
import BFlashcard from "../../becca/entities/bflashcard.js";
import BFlashcardReview from "../../becca/entities/bflashcard_review.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors.js";
import optionService from "../options.js";
import { getSql } from "../sql/index.js";
import dateUtils from "../utils/date";
import { randomString } from "../utils/index.js";
import {
    createEmptyFlashcardSchedule,
    DEFAULT_FLASHCARD_SCHEDULER_CONFIG_JSON,
    getFlashcardRetrievability,
    normalizeFlashcardSchedulerConfig,
    parseFlashcardSchedulerConfig,
    previewFlashcard,
    scheduleFlashcard,
    serializeFlashcardSchedulerConfig
} from "./fsrs_scheduler.js";
import { extractClozeIndices, renderClozeBack, renderClozeFront } from "./cloze.js";
import { isFilteredDeckId, resolveFilteredDeckNoteIds, FLASHCARD_FILTERED_DECK_LABEL } from "./filtered_decks.js";

const DEFAULT_DUE_LIMIT = 20;
const MAX_DUE_LIMIT = 100;
const BURY_DURATION_MS = 24 * 60 * 60 * 1000;
const FLASHCARD_LABEL = "flashcard";
const FLASHCARD_FRONT_HTML_LABEL = "flashcardFrontHtml";
const FLASHCARD_LEECH_LABEL = "flashcardLeech";
const FLASHCARD_LEECH_THRESHOLD = 8;
const FLASHCARD_SCHEDULER_CONFIG_OPTION = "flashcardSchedulerConfig";
const FLASHCARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_REVIEW_DURATION_MS = 24 * 60 * 60 * 1000;

function createCard(request: FlashcardCreateRequest) {
    assertValidId(request?.noteId, "noteId");
    const note = becca.getNoteOrThrow(request.noteId);

    if (!note.isContentAvailable()) {
        throw new ForbiddenError(
            "Cannot create flashcard for protected note while protected session is locked."
        );
    }

    if (request.deckNoteId) {
        assertValidId(request.deckNoteId, "deckNoteId");
    }

    const deckNoteId = request.deckNoteId || getDefaultDeckNoteId(request.noteId);
    becca.getNoteOrThrow(deckNoteId);

    if (isFilteredDeckId(deckNoteId)) {
        throw new ValidationError("Cannot assign cards to a filtered deck.");
    }

    const content = note.getContent();
    const clozeIndices = typeof content === "string" ? extractClozeIndices(content) : [];

    if (clozeIndices.length > 0) {
        return createClozeCards(note.noteId, deckNoteId, clozeIndices);
    }

    const existing = getSql().getRow<FlashcardRow | null>(/*sql*/`
        SELECT * FROM flashcards
        WHERE noteId = ? AND ordinal = 0 AND isDeleted = 0`, [request.noteId]);

    if (existing?.cardId) {
        return buildReviewCard(existing, { includeBack: true });
    }

    if (!note.hasLabel(FLASHCARD_LABEL)) {
        new BAttribute({
            noteId: note.noteId,
            type: "label",
            name: FLASHCARD_LABEL,
            value: "",
            isInheritable: false
        }).save();
    }

    const now = new Date();
    const card = new BFlashcard({
        ...createEmptyFlashcardSchedule(now, getCurrentSchedulerConfig()),
        noteId: note.noteId,
        deckNoteId,
        ordinal: 0,
        cardType: "basic"
    }).save();

    return buildReviewCard(card.getPojo() as FlashcardRow, { includeBack: true });
}

/**
 * Creates one card per unique cloze index (index N → ordinal N-1). Existing
 * rows keep their schedule; only missing ordinals are created. Returns the
 * first card so callers can jump straight into a review session.
 */
function createClozeCards(
    noteId: string,
    deckNoteId: string,
    clozeIndices: number[]
): FlashcardReviewCard {
    ensureFlashcardLabel(noteId);
    syncClozeRows(noteId, deckNoteId, clozeIndices);

    const first = getSql().getRow<FlashcardRow>(/*sql*/`
        SELECT * FROM flashcards
        WHERE noteId = ? AND isDeleted = 0
        ORDER BY ordinal ASC LIMIT 1`, [noteId]);

    return buildReviewCard(first, { includeBack: true });
}

/** Creates missing cloze rows for the given indices; leaves existing ones untouched. */
function syncClozeRows(noteId: string, deckNoteId: string, clozeIndices: number[]) {
    let created = 0;
    const now = new Date();

    // Index N maps to ordinal N - 1 so that removing a middle deletion never
    // shifts another card's schedule onto a different deletion.
    for (const index of clozeIndices) {
        const ordinal = index - 1;
        const existing = getSql().getRow<{ cardId: string } | undefined>(/*sql*/`
            SELECT cardId FROM flashcards
            WHERE noteId = ? AND ordinal = ? AND isDeleted = 0`, [noteId, ordinal]);

        if (!existing) {
            new BFlashcard({
                ...createEmptyFlashcardSchedule(now, getCurrentSchedulerConfig()),
                noteId,
                deckNoteId,
                ordinal,
                cardType: "cloze"
            }).save();
            created++;
        }
    }

    return created;
}

/**
 * Reconciles the cards of a cloze note with its current content: adds cards
 * for newly added deletion indices and removes cards whose index vanished.
 * Notes without cloze markers are left alone — basic cards are managed
 * explicitly via create/remove endpoints.
 */
function syncNoteCards(noteId: string) {
    assertValidId(noteId, "noteId");
    const note = becca.getNoteOrThrow(noteId);

    if (!note.isContentAvailable()) {
        throw new ForbiddenError(
            "Cannot sync flashcards of protected note while protected session is locked."
        );
    }

    const content = note.getContent();
    if (typeof content !== "string") {
        throw new ValidationError("Flashcard source note content must be text.");
    }

    const clozeIndices = extractClozeIndices(content);
    if (clozeIndices.length === 0) {
        return { createdCount: 0, removedCount: 0 };
    }

    const deckNoteId = getExistingDeckForNote(noteId);
    ensureFlashcardLabel(noteId);
    const createdCount = syncClozeRows(noteId, deckNoteId, clozeIndices);

    // Soft-delete rows whose ordinal no longer maps to an existing cloze index.
    const liveIndices = new Set(clozeIndices);
    const stale = getSql().getRows<FlashcardRow>(/*sql*/`
        SELECT * FROM flashcards
        WHERE noteId = ? AND isDeleted = 0`, [noteId])
        .filter((row) => !liveIndices.has((row.ordinal ?? 0) + 1));

    const deleteId = randomString(10);
    for (const row of stale) {
        const flashcard = becca.flashcards[row.cardId || ""] ?? new BFlashcard(row);
        flashcard.markAsDeleted(deleteId);
        if (row.cardId) {
            delete becca.flashcards[row.cardId];
        }
    }

    return { createdCount, removedCount: stale.length };
}

function getExistingDeckForNote(noteId: string) {
    const row = getSql().getRow<{ deckNoteId: string } | undefined>(/*sql*/`
        SELECT deckNoteId FROM flashcards
        WHERE noteId = ? AND isDeleted = 0 LIMIT 1`, [noteId]);

    return row?.deckNoteId || getDefaultDeckNoteId(noteId);
}

function ensureFlashcardLabel(noteId: string) {
    const note = becca.getNoteOrThrow(noteId);

    if (!note.hasLabel(FLASHCARD_LABEL)) {
        new BAttribute({
            noteId,
            type: "label",
            name: FLASHCARD_LABEL,
            value: "",
            isInheritable: false
        }).save();
    }
}

function getDecks(): FlashcardDecksResponse {
    const now = dateUtils.utcNowDateTime();
    const rows = getSql().getRows<Omit<FlashcardDeckSummary, "deckTitle">>(/*sql*/`
        SELECT
            deckNoteId,
            COUNT(1) AS totalCount,
            SUM(CASE WHEN suspended = 0 AND due <= ? THEN 1 ELSE 0 END) AS dueCount,
            SUM(CASE WHEN suspended = 0 AND state = 0 THEN 1 ELSE 0 END) AS newCount,
            SUM(CASE WHEN suspended = 0 AND state IN (1, 3) THEN 1 ELSE 0 END) AS learningCount,
            SUM(CASE WHEN suspended = 0 AND state = 2 THEN 1 ELSE 0 END) AS reviewCount,
            SUM(CASE WHEN suspended = 1 THEN 1 ELSE 0 END) AS suspendedCount
        FROM flashcards
        JOIN notes source_notes
          ON source_notes.noteId = flashcards.noteId
         AND source_notes.isDeleted = 0
        WHERE flashcards.isDeleted = 0
        GROUP BY deckNoteId`, [now]);

    const decksByNoteId = new Map<string, FlashcardDeckSummary>();

    for (const row of rows) {
        decksByNoteId.set(row.deckNoteId, {
            ...row,
            deckTitle: becca.getNote(row.deckNoteId)?.getTitleOrProtected() || "[missing]",
            isFiltered: false
        });
    }

    for (const filteredDeck of getFilteredDeckNotes()) {
        const noteIds = resolveFilteredDeckNoteIds(filteredDeck);
        const filteredCounts = getFilteredDeckCounts(noteIds, now);
        const existing = decksByNoteId.get(filteredDeck.noteId);

        decksByNoteId.set(filteredDeck.noteId, {
            deckNoteId: filteredDeck.noteId,
            deckTitle: filteredDeck.getTitleOrProtected(),
            totalCount: (existing?.totalCount ?? 0) + filteredCounts.totalCount,
            dueCount: (existing?.dueCount ?? 0) + filteredCounts.dueCount,
            newCount: (existing?.newCount ?? 0) + filteredCounts.newCount,
            learningCount: (existing?.learningCount ?? 0) + filteredCounts.learningCount,
            reviewCount: (existing?.reviewCount ?? 0) + filteredCounts.reviewCount,
            suspendedCount: (existing?.suspendedCount ?? 0) + filteredCounts.suspendedCount,
            isFiltered: true
        });
    }

    const decks = [ ...decksByNoteId.values() ];
    decks.sort((a, b) => a.deckTitle.localeCompare(b.deckTitle)
        || a.deckNoteId.localeCompare(b.deckNoteId));

    return { decks };
}

function getFilteredDeckNotes() {
    return becca
        .findAttributes("label", FLASHCARD_FILTERED_DECK_LABEL)
        .map((attribute) => attribute.getNote())
        .filter((note): note is NonNullable<typeof note> => !!note);
}

function getFilteredDeckCounts(noteIds: string[], now: string): FlashcardDeckSummary {
    if (noteIds.length === 0) {
        return {
            deckNoteId: "",
            deckTitle: "",
            totalCount: 0,
            dueCount: 0,
            newCount: 0,
            learningCount: 0,
            reviewCount: 0,
            suspendedCount: 0
        };
    }

    const placeholders = noteIds.map(() => "?").join(", ");
    const row = getSql().getRow<Omit<FlashcardDeckSummary, "deckNoteId" | "deckTitle">>(/*sql*/`
        SELECT
            COUNT(1) AS totalCount,
            SUM(CASE WHEN suspended = 0 AND due <= ? THEN 1 ELSE 0 END) AS dueCount,
            SUM(CASE WHEN suspended = 0 AND state = 0 THEN 1 ELSE 0 END) AS newCount,
            SUM(CASE WHEN suspended = 0 AND state IN (1, 3) THEN 1 ELSE 0 END) AS learningCount,
            SUM(CASE WHEN suspended = 0 AND state = 2 THEN 1 ELSE 0 END) AS reviewCount,
            SUM(CASE WHEN suspended = 1 THEN 1 ELSE 0 END) AS suspendedCount
        FROM flashcards
        JOIN notes source_notes
          ON source_notes.noteId = flashcards.noteId
         AND source_notes.isDeleted = 0
        WHERE flashcards.isDeleted = 0
          AND flashcards.noteId IN (${placeholders})`, [now, ...noteIds])
        ?? {
            totalCount: 0,
            dueCount: 0,
            newCount: 0,
            learningCount: 0,
            reviewCount: 0,
            suspendedCount: 0
        };

    return {
        deckNoteId: "",
        deckTitle: "",
        ...row
    };
}

function getDueCards({
    deckNoteId,
    limit = DEFAULT_DUE_LIMIT
}: { deckNoteId?: string; limit?: number } = {}): FlashcardDueResponse {
    limit = normalizeLimit(limit);

    if (deckNoteId) {
        assertValidId(deckNoteId, "deckNoteId");
    }

    const due = getLimitedDueRows({
        deckNoteId,
        limit,
        config: getCurrentSchedulerConfig()
    });

    return {
        cards: due.rows.map((row) => buildReviewCard(row, { includeBack: false })),
        totalDueCount: due.totalDueCount
    };
}

function getLimitedDueRows({
    deckNoteId,
    limit,
    config
}: {
    deckNoteId?: string;
    limit: number;
    config: ReturnType<typeof getCurrentSchedulerConfig>;
}) {
    const now = dateUtils.utcNowDateTime();
    const dayRange = getStudyDayRange(config.dayRolloverHour);
    const dailyNewUsed = countReviewsInStudyDay({ stateCondition: "state = 0", dayRange });
    const dailyReviewUsed = countReviewsInStudyDay({ stateCondition: "state = 2", dayRange });
    const dailyNewRemaining = Math.max(0, config.dailyNewCardLimit - dailyNewUsed);
    const dailyReviewRemaining = Math.max(0, config.dailyReviewLimit - dailyReviewUsed);
    const rows: FlashcardRow[] = [];
    const reviewDueCount = countDueRows({ deckNoteId, now, stateCondition: "flashcards.state = 2" });
    const learningDueCount = countDueRows({
        deckNoteId,
        now,
        stateCondition: "flashcards.state IN (1, 3)"
    });
    const newDueCount = countDueRows({ deckNoteId, now, stateCondition: "flashcards.state = 0" });
    const addRows = (stateCondition: string, rowLimit: number) => {
        if (rowLimit <= 0 || rows.length >= limit) {
            return;
        }

        rows.push(...getDueRows({
            deckNoteId,
            now,
            stateCondition,
            limit: Math.min(rowLimit, limit - rows.length)
        }));
    };

    addRows("flashcards.state = 2", dailyReviewRemaining);
    addRows("flashcards.state IN (1, 3)", limit);
    addRows("flashcards.state = 0", dailyNewRemaining);

    return {
        rows,
        totalDueCount: Math.min(reviewDueCount, dailyReviewRemaining)
            + learningDueCount
            + Math.min(newDueCount, dailyNewRemaining)
    };
}

function countReviewsInStudyDay({
    stateCondition,
    dayRange
}: {
    stateCondition: string;
    dayRange: { start: string; end: string };
}) {
    return getSql().getValue<number>(/*sql*/`
        SELECT COUNT(1) FROM flashcard_reviews
        WHERE ${stateCondition}
          AND reviewedAt >= ?
          AND reviewedAt < ?`, [dayRange.start, dayRange.end]) ?? 0;
}

function countDueRows({
    deckNoteId,
    now,
    stateCondition
}: {
    deckNoteId?: string;
    now: string;
    stateCondition: string;
}) {
    const params: string[] = [now];
    const deckCondition = getDeckCondition(deckNoteId, params);

    return getSql().getValue<number>(/*sql*/`
        SELECT COUNT(1) FROM flashcards
        JOIN notes source_notes
          ON source_notes.noteId = flashcards.noteId
         AND source_notes.isDeleted = 0
        WHERE flashcards.isDeleted = 0
          AND flashcards.suspended = 0
          AND flashcards.due <= ?
          AND ${stateCondition}
          ${deckCondition}`, params) ?? 0;
}

function getDueRows({
    deckNoteId,
    now,
    stateCondition,
    limit
}: {
    deckNoteId?: string;
    now: string;
    stateCondition: string;
    limit: number;
}) {
    const params: (string | number)[] = [now];
    const deckCondition = getDeckCondition(deckNoteId, params);

    return getSql().getRows<FlashcardRow>(/*sql*/`
        SELECT flashcards.* FROM flashcards
        JOIN notes source_notes
          ON source_notes.noteId = flashcards.noteId
         AND source_notes.isDeleted = 0
        WHERE flashcards.isDeleted = 0
          AND flashcards.suspended = 0
          AND flashcards.due <= ?
          AND ${stateCondition}
          ${deckCondition}
        ORDER BY flashcards.due, flashcards.cardId
        LIMIT ?`, [ ...params, limit ]);
}

function getDeckCondition(deckNoteId: string | undefined, params: (string | number)[]) {
    if (!deckNoteId) {
        return "";
    }

    if (isFilteredDeckId(deckNoteId)) {
        const noteIds = resolveFilteredDeckNoteIds(becca.getNoteOrThrow(deckNoteId));

        if (noteIds.length === 0) {
            return "AND 1 = 0";
        }

        params.push(...noteIds);
        return `AND flashcards.noteId IN (${noteIds.map(() => "?").join(", ")})`;
    }

    params.push(deckNoteId);
    return "AND flashcards.deckNoteId = ?";
}

function getStudyDayRange(dayRolloverHour: number) {
    const localNow = dayjs(dateUtils.localNowDateTime(), dateUtils.LOCAL_DATETIME_FORMAT);
    let start = localNow
        .hour(dayRolloverHour)
        .minute(0)
        .second(0)
        .millisecond(0);

    if (localNow.isBefore(start)) {
        start = start.subtract(1, "day");
    }

    return {
        start: dateUtils.utcDateTimeStr(start.toDate()),
        end: dateUtils.utcDateTimeStr(start.add(1, "day").toDate())
    };
}

function getCard(
    cardId: string,
    { includeBack = true }: { includeBack?: boolean } = {}
): FlashcardReviewCard {
    return buildReviewCard(getCardRow(cardId), { includeBack });
}

function getCardForNote(noteId: string): FlashcardCardSummary | null {
    assertValidId(noteId, "noteId");

    const row = getSql().getRow<FlashcardRow>(/*sql*/`
        SELECT * FROM flashcards
        WHERE noteId = ? AND isDeleted = 0
        ORDER BY ordinal ASC, utcDateCreated ASC
        LIMIT 1`, [noteId]);

    return row ? buildCardSummary(row) : null;
}

function getLeeches(): FlashcardLeechesResponse {
    const rows = getSql().getRows<FlashcardRow & { title: string }>(/*sql*/`
        SELECT f.cardId, f.noteId, f.lapses, f.suspended, n.title
        FROM flashcards f
        JOIN notes n ON n.noteId = f.noteId AND n.isDeleted = 0
        WHERE f.isDeleted = 0 AND f.lapses >= ?
        ORDER BY f.lapses DESC, n.title ASC
        LIMIT 50`, [FLASHCARD_LEECH_THRESHOLD]);

    return {
        leeches: rows.map((row): FlashcardLeechSummary => {
            const note = becca.getNote(row.noteId);
            return {
                cardId: row.cardId || "",
                noteId: row.noteId,
                noteTitle: note?.getTitleOrProtected() || row.title || "[missing]",
                lapses: row.lapses,
                suspended: !!row.suspended
            };
        })
    };
}

function getPreview(cardId: string): FlashcardPreviewResponse {
    const card = getCardRow(cardId);

    return {
        cardId: card.cardId || "",
        schedulingRevision: card.schedulingRevision ?? 0,
        previews: previewFlashcard(card, new Date(), getCurrentSchedulerConfig())
    };
}

function getSettings(): FlashcardSettingsResponse {
    return {
        schedulerConfig: getCurrentSchedulerConfig()
    };
}

function setSettings(request: FlashcardSettingsUpdateRequest): FlashcardSettingsResponse {
    if (!request?.schedulerConfig) {
        throw new ValidationError("Flashcard settings request requires schedulerConfig.");
    }

    const schedulerConfig = normalizeFlashcardSchedulerConfig(request.schedulerConfig);
    optionService.setOption(
        FLASHCARD_SCHEDULER_CONFIG_OPTION,
        serializeFlashcardSchedulerConfig(schedulerConfig)
    );

    return { schedulerConfig };
}

function setSuspended(
    cardId: string,
    request: FlashcardSuspensionRequest
): FlashcardActionResponse {
    if (!request || typeof request.suspended !== "boolean") {
        throw new ValidationError("Flashcard suspension request requires a boolean value.");
    }

    const card = getCardRow(cardId);
    assertExpectedRevision(card, request.expectedSchedulingRevision);

    const updated = new BFlashcard({
        ...card,
        suspended: request.suspended,
        schedulingRevision: (card.schedulingRevision ?? 0) + 1
    }).save();

    return {
        card: buildReviewCard(updated.getPojo() as FlashcardRow, { includeBack: false })
    };
}

function setCardDueDate(
    cardId: string,
    request: FlashcardSetDueDateRequest
): FlashcardActionResponse {
    const parsed = new Date(request?.due);
    if (!request || !request.due || Number.isNaN(parsed.getTime())) {
        throw new ValidationError("Flashcard due date request requires a parseable due value.");
    }

    const card = getCardRow(cardId);
    assertExpectedRevision(card, request.expectedSchedulingRevision);

    const updated = new BFlashcard({
        ...card,
        due: dateUtils.utcDateTimeStr(parsed),
        schedulingRevision: (card.schedulingRevision ?? 0) + 1
    }).save();

    return {
        card: buildReviewCard(updated.getPojo() as FlashcardRow, { includeBack: false })
    };
}

function resetCard(cardId: string, request: FlashcardResetRequest = {}): FlashcardActionResponse {
    const card = getCardRow(cardId);
    assertExpectedRevision(card, request.expectedSchedulingRevision);

    const resetSchedule = createEmptyFlashcardSchedule(new Date(), getCurrentSchedulerConfig());
    const updated = new BFlashcard({
        ...card,
        ...resetSchedule,
        suspended: false,
        schedulingRevision: (card.schedulingRevision ?? 0) + 1
    }).save();
    removeLeechLabel(card.noteId);

    return {
        card: buildReviewCard(updated.getPojo() as FlashcardRow, { includeBack: false })
    };
}

function buryCard(cardId: string, request: FlashcardBuryRequest = {}): FlashcardActionResponse {
    const card = getCardRow(cardId);
    assertExpectedRevision(card, request.expectedSchedulingRevision);

    const buriedUntil = new Date(Date.now() + BURY_DURATION_MS);
    const updated = new BFlashcard({
        ...card,
        due: dateUtils.utcDateTimeStr(buriedUntil),
        schedulingRevision: (card.schedulingRevision ?? 0) + 1
    }).save();

    return {
        card: buildReviewCard(updated.getPojo() as FlashcardRow, { includeBack: false })
    };
}

function moveCardToDeck(
    cardId: string,
    request: FlashcardDeckMoveRequest
): FlashcardActionResponse {
    if (!request?.deckNoteId) {
        throw new ValidationError("Flashcard deck move request requires a deck note ID.");
    }

    assertValidId(request.deckNoteId, "deckNoteId");
    const card = getCardRow(cardId);
    assertExpectedRevision(card, request.expectedSchedulingRevision);
    becca.getNoteOrThrow(request.deckNoteId);

    if (isFilteredDeckId(request.deckNoteId)) {
        throw new ValidationError("Cannot move a card into a filtered deck.");
    }

    const updated = new BFlashcard({
        ...card,
        deckNoteId: request.deckNoteId,
        schedulingRevision: (card.schedulingRevision ?? 0) + 1
    }).save();

    return {
        card: buildReviewCard(updated.getPojo() as FlashcardRow, { includeBack: false })
    };
}

function removeCardsForNote(noteId: string): FlashcardRemoveResponse {
    assertValidId(noteId, "noteId");
    const note = becca.getNoteOrThrow(noteId);
    const deleteId = randomString(10);
    const rows = getSql().getRows<FlashcardRow>(/*sql*/`
        SELECT * FROM flashcards
        WHERE noteId = ? AND isDeleted = 0`, [noteId]);

    for (const row of rows) {
        const flashcard = becca.flashcards[row.cardId || ""] ?? new BFlashcard(row);
        flashcard.markAsDeleted(deleteId);

        if (row.cardId) {
            delete becca.flashcards[row.cardId];
        }
    }

    const flashcardLabel = note.getOwnedLabel(FLASHCARD_LABEL);
    if (flashcardLabel) {
        flashcardLabel.markAsDeleted(deleteId);
    }

    const leechLabel = note.getOwnedLabel(FLASHCARD_LEECH_LABEL);
    if (leechLabel) {
        leechLabel.markAsDeleted(deleteId);
    }

    return { removedCount: rows.length };
}

function reviewCard(cardId: string, request: FlashcardReviewRequest): FlashcardReviewResponse {
    validateRating(request.rating);
    assertValidId(request?.clientRequestId, "clientRequestId");

    const duplicate = getSql().getRow<FlashcardReviewRow | null>(/*sql*/`
        SELECT * FROM flashcard_reviews
        WHERE clientRequestId = ?`, [request.clientRequestId]);

    if (duplicate) {
        if (duplicate.cardId !== cardId) {
            throw new ConflictError(
                `Review request '${request.clientRequestId}' belongs to another flashcard.`
            );
        }

        const card = getCardRow(cardId);
        return {
            card: buildCardSummary(card),
            reviewId: duplicate.reviewId || "",
            previews: previewFlashcard(card, new Date(), getCurrentSchedulerConfig())
        };
    }

    const card = getCardRow(cardId);

    assertExpectedRevision(card, request.expectedSchedulingRevision);

    if (card.suspended) {
        throw new ConflictError(`Flashcard '${cardId}' is suspended and cannot be reviewed.`);
    }

    const note = becca.getNote(card.noteId);
    if (!note || note.isDeleted) {
        throw new NotFoundError("Flashcard source note was not found.");
    }

    if (!note.isContentAvailable()) {
        throw new ForbiddenError(
            "Cannot review protected flashcard while protected session is locked."
        );
    }

    const now = new Date();
    const scheduled = scheduleFlashcard(
        card,
        request.rating,
        now,
        getCurrentSchedulerConfig()
    );
    let savedReviewId = "";

    getSql().transactional(() => {
        const leech = isLeech(scheduled.card);
        const becameLeech = !isLeech(card) && leech;
        const updatedCard = new BFlashcard({
            ...card,
            ...scheduled.card,
            suspended: scheduled.card.suspended || becameLeech
        }).save();

        if (leech) {
            addLeechLabel(card.noteId);
        }

        const review = new BFlashcardReview({
            cardId,
            rating: scheduled.log.rating,
            state: scheduled.log.state,
            dueBefore: scheduled.log.dueBefore,
            dueAfter: scheduled.log.dueAfter,
            stabilityBefore: scheduled.log.stabilityBefore,
            stabilityAfter: scheduled.log.stabilityAfter,
            difficultyBefore: scheduled.log.difficultyBefore,
            difficultyAfter: scheduled.log.difficultyAfter,
            elapsedDays: scheduled.log.elapsedDays,
            elapsedDaysBefore: scheduled.log.elapsedDaysBefore,
            scheduledDays: scheduled.log.scheduledDays,
            scheduledDaysBefore: scheduled.log.scheduledDaysBefore,
            learningSteps: scheduled.log.learningSteps,
            learningStepsBefore: scheduled.log.learningStepsBefore,
            repsBefore: scheduled.log.repsBefore,
            lapsesBefore: scheduled.log.lapsesBefore,
            lastReviewBefore: scheduled.log.lastReviewBefore,
            schedulingRevisionBefore: scheduled.log.schedulingRevisionBefore,
            schedulingRevisionAfter: scheduled.log.schedulingRevisionAfter,
            reviewedAt: scheduled.log.reviewedAt,
            durationMs: normalizeDuration(request.durationMs),
            algorithm: updatedCard.algorithm,
            algorithmVersion: updatedCard.algorithmVersion,
            schedulerConfig: scheduled.log.schedulerConfig,
            clientRequestId: request.clientRequestId
        }).save();

        savedReviewId = review.reviewId || "";
    });

    const updated = getCardRow(cardId);

    return {
        card: buildCardSummary(updated),
        reviewId: savedReviewId,
        previews: previewFlashcard(updated, new Date(), getCurrentSchedulerConfig())
    };
}

function undoReview(request: FlashcardUndoRequest): FlashcardActionResponse {
    assertValidId(request?.reviewId, "reviewId");
    const review = getSql().getRow<FlashcardReviewRow | null>(/*sql*/`
        SELECT * FROM flashcard_reviews
        WHERE reviewId = ?`, [request.reviewId]);

    if (!review) {
        throw new NotFoundError(`Flashcard review '${request.reviewId}' was not found.`);
    }

    const card = getCardRow(review.cardId);
    assertExpectedRevision(card, request.expectedSchedulingRevision);

    if ((card.schedulingRevision ?? 0) !== review.schedulingRevisionAfter) {
        throw new ConflictError("Only the latest flashcard review can be undone.");
    }

    const leechBeforeReview = review.lapsesBefore >= FLASHCARD_LEECH_THRESHOLD;
    const updated = new BFlashcard({
        ...card,
        state: review.state,
        due: review.dueBefore,
        stability: review.stabilityBefore,
        difficulty: review.difficultyBefore,
        elapsedDays: review.elapsedDaysBefore,
        scheduledDays: review.scheduledDaysBefore,
        learningSteps: review.learningStepsBefore,
        reps: review.repsBefore,
        lapses: review.lapsesBefore,
        lastReview: review.lastReviewBefore ?? null,
        suspended: leechBeforeReview ? card.suspended : false,
        schedulingRevision: (card.schedulingRevision ?? 0) + 1
    }).save();

    if (!leechBeforeReview) {
        removeLeechLabel(card.noteId);
    }

    return {
        card: buildReviewCard(updated.getPojo() as FlashcardRow, { includeBack: false })
    };
}

function exportAll(): FlashcardExportPayload {
    return {
        format: FLASHCARD_EXPORT_FORMAT,
        formatVersion: FLASHCARD_EXPORT_FORMAT_VERSION,
        exportedUtc: new Date().toISOString(),
        cards: getSql().getRows<FlashcardRow>(/*sql*/`
            SELECT * FROM flashcards WHERE isDeleted = 0`),
        reviews: getSql().getRows<FlashcardReviewRow>(/*sql*/`
            SELECT * FROM flashcard_reviews`)
    };
}

function importData(request: FlashcardImportRequest): FlashcardImportResponse {
    const payload = request?.payload;

    if (!payload
        || payload.format !== FLASHCARD_EXPORT_FORMAT
        || payload.formatVersion !== FLASHCARD_EXPORT_FORMAT_VERSION
        || !Array.isArray(payload.cards)
        || !Array.isArray(payload.reviews)) {
        throw new ValidationError("Unrecognized flashcard export payload.");
    }

    let createdCards = 0;
    let updatedCards = 0;
    let skippedCards = 0;

    for (const rawCard of payload.cards) {
        const cardId = String(rawCard?.cardId || "");
        const noteId = String(rawCard?.noteId || "");

        if (!FLASHCARD_ID_PATTERN.test(cardId) || !FLASHCARD_ID_PATTERN.test(noteId)) {
            skippedCards++;
            continue;
        }

        const note = becca.getNote(noteId);
        if (!note || note.isDeleted) {
            skippedCards++;
            continue;
        }

        let deckNoteId = String(rawCard.deckNoteId || "");
        const deck = becca.getNote(deckNoteId);
        if (!deck || deck.isDeleted) {
            deckNoteId = getDefaultDeckNoteId(noteId);
        }

        if (!deckNoteId || !becca.getNote(deckNoteId)) {
            skippedCards++;
            continue;
        }

        const incoming = sanitizeImportedCard(rawCard, cardId, noteId, deckNoteId);
        if (!incoming) {
            skippedCards++;
            continue;
        }

        // Becca's flashcard map is populated by the loader, so freshly created rows are
        // looked up in the database rather than the cache.
        const existing = getSql().getRow<FlashcardRow>(/*sql*/`
            SELECT * FROM flashcards WHERE cardId = ? AND isDeleted = 0`, [cardId]);
        if (existing) {
            if ((incoming.schedulingRevision ?? 0) > (existing.schedulingRevision ?? 0)) {
                new BFlashcard(incoming).save();
                updatedCards++;
            } else {
                skippedCards++;
            }
        } else {
            new BFlashcard(incoming).save();
            createdCards++;

            // Restore the opt-in label so consistency checks don't drop the imported card.
            if (!note.hasOwnedLabel(FLASHCARD_LABEL)) {
                new BAttribute({
                    noteId,
                    type: "label",
                    name: FLASHCARD_LABEL,
                    value: "",
                    isInheritable: false
                }).save();
            }
        }
    }

    let importedReviews = 0;
    for (const rawReview of payload.reviews) {
        const reviewId = String(rawReview?.reviewId || "");
        if (!FLASHCARD_ID_PATTERN.test(reviewId)) {
            continue;
        }

        const existing = getSql().getRow<{ reviewId: string }>(/*sql*/`
            SELECT reviewId FROM flashcard_reviews WHERE reviewId = ?`, [reviewId]);
        if (existing) {
            continue;
        }

        new BFlashcardReview(sanitizeImportedReview(rawReview, reviewId)).save();
        importedReviews++;
    }

    return { createdCards, updatedCards, skippedCards, importedReviews };
}

/** Coerces imported scheduling fields to finite numbers; returns null when the row is unusable. */
function sanitizeImportedCard(
    raw: Partial<FlashcardRow>,
    cardId: string,
    noteId: string,
    deckNoteId: string
): FlashcardRow | null {
    const state = Number(raw.state);
    if (!Number.isInteger(state) || state < 0 || state > 3) {
        return null;
    }

    // Review/relearning cards need review history for ts-fsrs; otherwise the
    // scheduler throws when the card is next previewed.
    if (state === 2 || state === 3) {
        const lastReview = raw.lastReview ? String(raw.lastReview) : "";
        if (!lastReview || dateUtils.validateUtcDateTime(lastReview)
            || !(toFiniteNumber(raw.stability, 0) > 0)) {
            return null;
        }
    }

    return {
        cardId,
        noteId,
        deckNoteId,
        ordinal: Number.isFinite(Number(raw.ordinal)) ? Number(raw.ordinal) : 0,
        cardType: raw.cardType === "cloze" ? "cloze" : "basic",
        state: state as FlashcardRow["state"],
        due: String(raw.due || dateUtils.utcNowDateTime()),
        stability: toFiniteNumber(raw.stability, 0),
        difficulty: toFiniteNumber(raw.difficulty, 0),
        elapsedDays: Math.max(0, Math.round(toFiniteNumber(raw.elapsedDays, 0))),
        scheduledDays: Math.max(0, Math.round(toFiniteNumber(raw.scheduledDays, 0))),
        learningSteps: Math.max(0, Math.round(toFiniteNumber(raw.learningSteps, 0))),
        reps: Math.max(0, Math.round(toFiniteNumber(raw.reps, 0))),
        lapses: Math.max(0, Math.round(toFiniteNumber(raw.lapses, 0))),
        lastReview: raw.lastReview ?? null,
        suspended: !!raw.suspended,
        algorithm: String(raw.algorithm || "fsrs-6"),
        algorithmVersion: String(raw.algorithmVersion || "ts-fsrs@5.4.1"),
        schedulerConfig: String(raw.schedulerConfig || DEFAULT_FLASHCARD_SCHEDULER_CONFIG_JSON),
        schedulingRevision: Math.max(0, Math.round(toFiniteNumber(raw.schedulingRevision, 0))),
        utcDateCreated: raw.utcDateCreated || dateUtils.utcNowDateTime()
    } as FlashcardRow;
}

function sanitizeImportedReview(raw: Partial<FlashcardReviewRow>, reviewId: string): FlashcardReviewRow {
    return {
        reviewId,
        cardId: String(raw.cardId || ""),
        rating: (toFiniteNumber(raw.rating, 0) as FlashcardRating),
        state: (Math.max(0, Math.min(3, Math.round(toFiniteNumber(raw.state, 0)))) as FlashcardReviewRow["state"]),
        dueBefore: String(raw.dueBefore || ""),
        dueAfter: String(raw.dueAfter || ""),
        stabilityBefore: toFiniteNumber(raw.stabilityBefore, 0),
        stabilityAfter: toFiniteNumber(raw.stabilityAfter, 0),
        difficultyBefore: toFiniteNumber(raw.difficultyBefore, 0),
        difficultyAfter: toFiniteNumber(raw.difficultyAfter, 0),
        elapsedDays: Math.max(0, Math.round(toFiniteNumber(raw.elapsedDays, 0))),
        elapsedDaysBefore: Math.max(0, Math.round(toFiniteNumber(raw.elapsedDaysBefore, 0))),
        scheduledDays: Math.max(0, Math.round(toFiniteNumber(raw.scheduledDays, 0))),
        scheduledDaysBefore: Math.max(0, Math.round(toFiniteNumber(raw.scheduledDaysBefore, 0))),
        learningSteps: Math.max(0, Math.round(toFiniteNumber(raw.learningSteps, 0))),
        learningStepsBefore: Math.max(0, Math.round(toFiniteNumber(raw.learningStepsBefore, 0))),
        repsBefore: Math.max(0, Math.round(toFiniteNumber(raw.repsBefore, 0))),
        lapsesBefore: Math.max(0, Math.round(toFiniteNumber(raw.lapsesBefore, 0))),
        lastReviewBefore: raw.lastReviewBefore ?? null,
        schedulingRevisionBefore: Math.round(toFiniteNumber(raw.schedulingRevisionBefore, 0)),
        schedulingRevisionAfter: Math.round(toFiniteNumber(raw.schedulingRevisionAfter, 0)),
        reviewedAt: String(raw.reviewedAt || dateUtils.utcNowDateTime()),
        durationMs: raw.durationMs ?? null,
        algorithm: String(raw.algorithm || "fsrs-6"),
        algorithmVersion: String(raw.algorithmVersion || "ts-fsrs@5.4.1"),
        schedulerConfig: raw.schedulerConfig ?? undefined,
        clientRequestId: raw.clientRequestId ?? null,
        utcDateCreated: raw.utcDateCreated,
        utcDateModified: raw.utcDateModified
    };
}

function toFiniteNumber(value: unknown, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getStats(): FlashcardStatsResponse {
    const today = new Date();
    const todayStart = `${dateUtils.utcDateStr(today)} 00:00:00.000Z`;
    const sql = getSql();
    const ratingCounts = getRatingCounts();
    const totalReviews = ratingCounts[1] + ratingCounts[2] + ratingCounts[3] + ratingCounts[4];
    const dueCount = getLimitedDueRows({
        limit: 1,
        config: getCurrentSchedulerConfig()
    }).totalDueCount;

    return {
        dueCount,
        newCount: sql.getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE isDeleted = 0 AND suspended = 0 AND state = 0`) ?? 0,
        learningCount: sql.getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE isDeleted = 0 AND suspended = 0 AND state IN (1, 3)`) ?? 0,
        reviewCount: sql.getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE isDeleted = 0 AND suspended = 0 AND state = 2`) ?? 0,
        suspendedCount: sql.getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE isDeleted = 0 AND suspended = 1`) ?? 0,
        leechCount: sql.getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE isDeleted = 0 AND lapses >= ?`, [FLASHCARD_LEECH_THRESHOLD]) ?? 0,
        reviewedTodayCount: sql.getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE reviewedAt >= ?`, [todayStart]) ?? 0,
        retentionRate: totalReviews === 0 ? null : (totalReviews - ratingCounts[1]) / totalReviews,
        lapseCount: sql.getValue<number>(/*sql*/`
            SELECT COALESCE(SUM(lapses), 0) FROM flashcards
            WHERE isDeleted = 0`) ?? 0,
        dueForecast: getDueForecast(today),
        ratingCounts
    };
}

function getDueForecast(startDate: Date) {
    const dates = Array.from({ length: 7 }, (_item, index) => {
        const date = new Date(startDate);
        date.setUTCDate(date.getUTCDate() + index);
        return dateUtils.utcDateStr(date);
    });
    const rows = getSql().getRows<{ date: string; count: number }>(/*sql*/`
        SELECT substr(due, 1, 10) AS date, COUNT(1) AS count
        FROM flashcards
        WHERE isDeleted = 0
          AND suspended = 0
          AND due >= ?
          AND due < ?
        GROUP BY substr(due, 1, 10)`, [
        `${dates[0]} 00:00:00.000Z`,
        `${dateAfter(daysFromDate(startDate, 7))} 00:00:00.000Z`
    ]);
    const counts = new Map(rows.map((row) => [row.date, row.count]));

    return dates.map((date) => ({
        date,
        count: counts.get(date) ?? 0
    }));
}

function dateAfter(date: Date) {
    return dateUtils.utcDateStr(date);
}

function daysFromDate(date: Date, days: number) {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

function getRatingCounts(): Record<FlashcardRating, number> {
    const rows = getSql().getRows<{ rating: FlashcardRating; count: number }>(/*sql*/`
        SELECT rating, COUNT(1) AS count
        FROM flashcard_reviews
        GROUP BY rating`);
    const ratingCounts: Record<FlashcardRating, number> = {
        1: 0,
        2: 0,
        3: 0,
        4: 0
    };

    for (const row of rows) {
        ratingCounts[row.rating] = row.count;
    }

    return ratingCounts;
}

function getDefaultDeckNoteId(noteId: string) {
    const note = becca.getNoteOrThrow(noteId);
    const parent = note.getStrongParentBranches()[0]?.parentNoteId;
    return parent && parent !== "none" ? parent : "root";
}

function getCardRow(cardId: string): FlashcardRow {
    assertValidId(cardId, "cardId");
    const card = getSql().getRow<FlashcardRow | null>(/*sql*/`
        SELECT * FROM flashcards
        WHERE cardId = ? AND isDeleted = 0`, [cardId]);

    if (!card) {
        throw new NotFoundError(`Flashcard '${cardId}' was not found.`);
    }

    return card;
}

function buildReviewCard(
    card: FlashcardRow,
    { includeBack }: { includeBack: boolean }
): FlashcardReviewCard {
    const note = becca.getNote(card.noteId);

    if (!note || note.isDeleted) {
        throw new NotFoundError("Flashcard source note was not found.");
    }

    if (!note.isContentAvailable()) {
        return {
            ...buildCardSummary(card),
            front: note.getTitleOrProtected(),
            previews: previewFlashcard(card, new Date(), getCurrentSchedulerConfig())
        };
    }

    const content = note.getContent();
    const importedFrontHtml = note.getOwnedLabelValue(FLASHCARD_FRONT_HTML_LABEL);
    const isCloze = card.cardType === "cloze";
    const reviewCard: FlashcardReviewCard = {
        ...buildCardSummary(card),
        front: importedFrontHtml ?? (isCloze && typeof content === "string"
            ? renderClozeFront(content, card.ordinal ?? 0)
            : note.title),
        frontIsHtml: importedFrontHtml !== null,
        previews: previewFlashcard(card, new Date(), getCurrentSchedulerConfig())
    };

    if (includeBack) {
        reviewCard.back = typeof content === "string"
            ? (isCloze ? renderClozeBack(content, card.ordinal ?? 0) : content)
            : "";
    }

    return reviewCard;
}

function buildCardSummary(card: FlashcardRow): FlashcardCardSummary {
    const note = becca.getNote(card.noteId);
    const deck = becca.getNote(card.deckNoteId);

    return {
        cardId: card.cardId || "",
        noteId: card.noteId,
        deckNoteId: card.deckNoteId,
        noteTitle: note?.getTitleOrProtected() || "[missing]",
        deckTitle: deck?.getTitleOrProtected() || "[missing]",
        cardType: card.cardType === "cloze" ? "cloze" : "basic",
        ordinal: card.ordinal ?? 0,
        state: card.state,
        due: card.due,
        suspended: !!card.suspended,
        leech: isLeech(card),
        schedulingRevision: card.schedulingRevision ?? 0,
        retrievability: getFlashcardRetrievability(card)
    };
}

function isLeech(card: Pick<FlashcardRow, "lapses">) {
    return card.lapses >= FLASHCARD_LEECH_THRESHOLD;
}

function addLeechLabel(noteId: string) {
    const note = becca.getNoteOrThrow(noteId);

    if (note.hasOwnedLabel(FLASHCARD_LEECH_LABEL)) {
        return;
    }

    new BAttribute({
        noteId,
        type: "label",
        name: FLASHCARD_LEECH_LABEL,
        value: FLASHCARD_LEECH_THRESHOLD.toString(),
        isInheritable: false
    }).save();
}

function removeLeechLabel(noteId: string, deleteId = randomString(10)) {
    const leechLabel = becca.getNoteOrThrow(noteId).getOwnedLabel(FLASHCARD_LEECH_LABEL);

    if (leechLabel) {
        leechLabel.markAsDeleted(deleteId);
    }
}

function getCurrentSchedulerConfig() {
    const optionValue = optionService.getOptionOrNull(FLASHCARD_SCHEDULER_CONFIG_OPTION)
        ?? DEFAULT_FLASHCARD_SCHEDULER_CONFIG_JSON;
    return parseFlashcardSchedulerConfig(optionValue);
}

function assertValidId(id: string | undefined, fieldName: string) {
    if (!id || !FLASHCARD_ID_PATTERN.test(id)) {
        throw new ValidationError(`Invalid flashcard ${fieldName}.`);
    }
}

function assertExpectedRevision(card: FlashcardRow, expectedSchedulingRevision?: number) {
    if (expectedSchedulingRevision !== undefined
        && expectedSchedulingRevision !== card.schedulingRevision) {
        throw new ConflictError(
            `Flashcard '${card.cardId}' has changed. Refresh before reviewing.`
        );
    }
}

function normalizeLimit(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new ValidationError(`Invalid flashcard limit '${limit}'.`);
    }

    return Math.min(limit, MAX_DUE_LIMIT);
}

function normalizeDuration(durationMs: number | undefined) {
    if (durationMs === undefined || durationMs === null) {
        return null;
    }

    if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > MAX_REVIEW_DURATION_MS) {
        throw new ValidationError(`Invalid review duration '${durationMs}'.`);
    }

    return durationMs;
}

function validateRating(rating: FlashcardRating) {
    if (![1, 2, 3, 4].includes(rating)) {
        throw new ValidationError(`Invalid flashcard rating '${rating}'.`);
    }
}

export default {
    createCard,
    getDecks,
    getDueCards,
    getCard,
    getCardForNote,
    getPreview,
    getSettings,
    setSettings,
    getStats,
    setSuspended,
    resetCard,
    buryCard,
    moveCardToDeck,
    setCardDueDate,
    undoReview,
    removeCardsForNote,
    syncNoteCards,
    reviewCard,
    exportAll,
    getLeeches,
    importData
};
