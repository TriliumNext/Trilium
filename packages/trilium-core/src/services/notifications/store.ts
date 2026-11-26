/**
 * @module
 *
 * Notifications on Becca and SQL: generations, marks and private texts, the lookups of erased
 * generations, the erasure of a notification with what belongs to it, and housekeeping. Every row
 * that it writes passes the checks that a receiver applies to the row when sync brings it.
 */
import {
    NOTIFICATION_MARK_KINDS,
    type NotificationMarkKind,
    type NotificationPrivateTextRow,
    type NotificationRow
} from "@triliumnext/commons";

import becca from "../../becca/becca.js";
import BNotification from "../../becca/entities/bnotification.js";
import BNotificationMark from "../../becca/entities/bnotification_mark.js";
import BNotificationPrivateText from "../../becca/entities/bnotification_private_text.js";
import entityChangesService from "../entity_changes.js";
import { getSql } from "../sql/index.js";
import {
    checkNotificationRow,
    checkPrivateTextRow,
    classifyRaise,
    formatUtcDateTime,
    getDefaultRaisedAtMs,
    getKeyRange,
    getLastCountedKey,
    getMarkId,
    getMarkIds,
    getNotificationId,
    getReferencedNoteId,
    getRewriteDateMs,
    getTimeOfNotificationId,
    isDatedAhead,
    NotificationError,
    type NotificationErrorCode,
    parseUtcDateTime,
    pickTrimmed,
    type RaiseOutcome,
    resolveView,
    type ViewEntry
} from "./model.js";

/** The row of a new generation without its key and dates, which the store computes. */
export type GenerationInput =
    Omit<NotificationRow, "notificationId" | "utcDateCreated" | "utcDateModified">;

export interface RaiseResult {
    outcome: RaiseOutcome;
    /** The new generation, the stored one for `stored`, and `null` for the other outcomes. */
    notification: BNotification | null;
}

export interface RaiseOptions {
    isCategoryOff?: boolean;
    nowMs?: number;
}

/**
 * Raises a generation by the rules of a raise. A new generation is stored with both dates at
 * `raisedAt`, the older generations of its ID are erased, and the history is trimmed.
 *
 * @throws NotificationError for a row that fails its checks, or a time more than an hour ahead.
 */
export function raise(input: GenerationInput, options: RaiseOptions = {}): RaiseResult {
    const { isCategoryOff = false, nowMs = Date.now() } = options;
    const raisedAtMs = parseUtcDateTime(input.raisedAt);
    if (raisedAtMs === null) {
        throw new NotificationError("invalid-row");
    }
    if (isDatedAhead(raisedAtMs, nowMs)) {
        throw new NotificationError("raised-ahead");
    }

    const row: NotificationRow = {
        notificationId: getNotificationId(input.id, raisedAtMs),
        ...input,
        utcDateCreated: input.raisedAt,
        utcDateModified: input.raisedAt
    };
    throwIfInvalid(checkNotificationRow(toStoredRow(row)));

    return getSql().transactional(() => {
        const generations = getGenerations(input.id);
        const outcome = classifyRaise({
            isCategoryOff,
            raisedAtMs,
            nowMs,
            storedTimes: generations.map(getTime),
            erasedTimes: getErasedTimes(input.id)
        });
        if (outcome !== "new") {
            const stored = outcome === "stored" ? becca.getNotification(row.notificationId) : null;
            return { outcome, notification: stored };
        }

        const notification = new BNotification(row).save();
        const older = generations.filter((generation) => getTime(generation) < raisedAtMs);
        eraseNotifications(older.map(({ notificationId }) => notificationId), nowMs);
        trimHistory(nowMs);
        return { outcome, notification };
    });
}

/** The `raisedAt` of a raise of `id` that has none: see `getDefaultRaisedAtMs()`. */
export function getDefaultRaisedAt(id: string, nowMs = Date.now()) {
    const knownTimes = [ ...getGenerations(id).map(getTime), ...getErasedTimes(id) ];
    return formatUtcDateTime(getDefaultRaisedAtMs(nowMs, knownTimes));
}

/** Rewrites the row of a generation, dated now or one millisecond after its stored date. */
export function rewrite(
    notification: BNotification,
    changes: Partial<Pick<NotificationRow, "content" | "isSensitive">>,
    nowMs = Date.now()
) {
    const storedMs = toTimeMs(notification.utcDateModified);
    const row: NotificationRow = {
        ...notification.getPojo(),
        ...changes,
        utcDateModified: formatUtcDateTime(getRewriteDateMs(nowMs, storedMs))
    };
    throwIfInvalid(checkNotificationRow(toStoredRow(row)));

    notification.updateFromRow(row);
    return notification.save();
}

/**
 * Writes a mark unless the generation has it.
 *
 * @returns whether it wrote one: a mark is written only for a stored generation.
 */
export function writeMark(notificationId: string, kind: NotificationMarkKind, nowMs = Date.now()) {
    const markId = getMarkId(notificationId, kind);
    if (!becca.getNotification(notificationId) || becca.getNotificationMark(markId)) {
        return false;
    }

    new BNotificationMark({
        markId,
        notificationId,
        kind,
        utcDateCreated: formatUtcDateTime(nowMs)
    }).save();
    return true;
}

export function getMarkKinds(notificationId: string): NotificationMarkKind[] {
    return NOTIFICATION_MARK_KINDS.filter((kind) =>
        becca.getNotificationMark(getMarkId(notificationId, kind)));
}

/**
 * Writes the sealed private text of a stored generation, which replaces the stored one.
 *
 * @returns the private text, or `null` when the generation is not stored.
 * @throws NotificationError for content that fails its checks.
 */
export function writePrivateText(notificationId: string, content: string, nowMs = Date.now()) {
    if (!becca.getNotification(notificationId)) {
        return null;
    }

    const now = formatUtcDateTime(nowMs);
    const stored = becca.getNotificationPrivateText(notificationId);
    const row: NotificationPrivateTextRow = stored
        ? {
            notificationId,
            content,
            utcDateCreated: stored.utcDateCreated,
            utcDateModified: formatUtcDateTime(
                getRewriteDateMs(nowMs, toTimeMs(stored.utcDateModified)))
        }
        : { notificationId, content, utcDateCreated: now, utcDateModified: now };
    throwIfInvalid(checkPrivateTextRow(row));

    if (!stored) {
        return new BNotificationPrivateText(row).save();
    }
    stored.updateFromRow(row);
    return stored.save();
}

/**
 * Erases stored generations: deletes each row, marks its entity change as erased, and deletes
 * its marks and its private text together with their entity changes.
 */
export function eraseNotifications(notificationIds: string[], nowMs = Date.now()) {
    const notifications = notificationIds
        .map((notificationId) => becca.getNotification(notificationId))
        .filter((notification) => notification !== null);

    const sql = getSql();
    sql.transactional(() => {
        const utcDateChanged = formatUtcDateTime(nowMs);
        for (const notification of notifications) {
            sql.execute("DELETE FROM notifications WHERE notificationId = ?",
                [ notification.notificationId ]);
            entityChangesService.putEntityChangeWithForcedChange({
                entityName: "notifications",
                entityId: notification.notificationId,
                hash: notification.generateHash(),
                isErased: true,
                isSynced: true,
                utcDateChanged
            });
        }

        const erasedIds = notifications.map(({ notificationId }) => notificationId);
        deleteParts(erasedIds);
        for (const notificationId of erasedIds) {
            becca.removeNotification(notificationId);
        }
    });
}

/**
 * Deletes the marks and the private texts of notifications, with their entity changes, from the
 * database only. `eraseEntity()` of sync calls it; becca drops them on `ENTITY_DELETE_SYNCED`.
 */
export function deleteParts(notificationIds: string[]) {
    const sql = getSql();
    const markIds = notificationIds.flatMap(getMarkIds);
    sql.executeMany(/*sql*/`DELETE FROM notification_marks WHERE markId IN (???)`, markIds);
    sql.executeMany(/*sql*/`DELETE FROM entity_changes
        WHERE entityName = 'notification_marks' AND entityId IN (???)`, markIds);
    sql.executeMany(/*sql*/`DELETE FROM notification_private_texts
        WHERE notificationId IN (???)`, notificationIds);
    sql.executeMany(/*sql*/`DELETE FROM entity_changes
        WHERE entityName = 'notification_private_texts' AND entityId IN (???)`, notificationIds);
}

/** Whether the generation is erased in this database. */
export function isErased(notificationId: string) {
    return !!getSql().getValue(/*sql*/`SELECT 1 FROM entity_changes
        WHERE entityName = 'notifications' AND entityId = ? AND isErased = 1`, [ notificationId ]);
}

/**
 * Whether a newer generation of the same ID is erased, by an erasure that is not dated ahead.
 * The keys of the generations of an ID share their first 12 characters and sort by time.
 */
export function isCovered(notificationId: string, nowMs = Date.now()) {
    return !!getSql().getValue(/*sql*/`SELECT 1 FROM entity_changes
        WHERE entityName = 'notifications' AND isErased = 1 AND entityId > ? AND entityId <= ?
        LIMIT 1`, [ notificationId, getLastCountedKey(notificationId, nowMs) ]);
}

/** The times of the erased generations of an ID. */
export function getErasedTimes(id: string) {
    return getSql().getColumn<string>(/*sql*/`SELECT entityId FROM entity_changes
        WHERE entityName = 'notifications' AND isErased = 1 AND entityId >= ? AND entityId <= ?`,
    getKeyRange(id)).map(getTimeOfNotificationId);
}

/** The stored generations of an ID. */
export function getGenerations(id: string) {
    return Object.values(becca.notifications).filter((notification) => notification.id === id);
}

/** The notifications that this instance shows, newest first: see `resolveView()`. */
export function getView(nowMs = Date.now()): ViewEntry<BNotification>[] {
    return resolveView(Object.values(becca.notifications), {
        nowMs,
        getMarkKinds,
        isCovered: (notificationId) => isCovered(notificationId, nowMs)
    });
}

/**
 * Erases the generations that a newer or an erased generation covers and those whose note is
 * deleted, trims the history, and deletes what is left of erased notifications. A generation
 * dated ahead is left out.
 */
export function runHousekeeping(nowMs = Date.now()) {
    getSql().transactional(() => {
        const view = getView(nowMs);
        const shownIds = new Set(view.map(({ row }) => row.notificationId));
        const covered = Object.values(becca.notifications)
            .filter((notification) => !shownIds.has(notification.notificationId)
                && !isDatedAhead(getTime(notification), nowMs));
        const aboutDeletedNotes = view
            .map(({ row }) => row)
            .filter((notification) =>
                isNoteDeleted(getReferencedNoteId(notification.noteId, notification.content)));
        eraseNotifications([ ...covered, ...aboutDeletedNotes ]
            .map(({ notificationId }) => notificationId), nowMs);

        trimHistory(nowMs);
        deletePartsOfErased();
    });
}

/** Erases the surplus of the history: see `pickTrimmed()`. */
function trimHistory(nowMs: number) {
    const entries = getView(nowMs).map(({ row, state }) => ({
        notificationId: row.notificationId,
        type: row.type,
        attentionLevel: row.attentionLevel,
        raisedAtMs: getTime(row),
        state
    }));
    eraseNotifications(pickTrimmed(entries, nowMs), nowMs);
}

function deletePartsOfErased() {
    const notificationIds = getSql().getColumn<string>(/*sql*/`
        SELECT notificationId FROM notification_marks
        UNION
        SELECT notificationId FROM notification_private_texts`)
        .filter(isErased);

    deleteParts(notificationIds);
    for (const notificationId of notificationIds) {
        becca.removeNotification(notificationId);
    }
}

/** Whether the note is marked as deleted or erased. A note that this database lacks is not. */
function isNoteDeleted(noteId: string | null) {
    return !!getSql().getValue(/*sql*/`SELECT
        EXISTS(SELECT 1 FROM notes WHERE noteId = ? AND isDeleted = 1)
        OR EXISTS(SELECT 1 FROM entity_changes
            WHERE entityName = 'notes' AND entityId = ? AND isErased = 1)`, [ noteId, noteId ]);
}

function getTime(notification: { notificationId: string }) {
    return getTimeOfNotificationId(notification.notificationId);
}

/** Parses a date of a stored row, which is always in the stored form. */
function toTimeMs(utcDateTime: string) {
    return Date.parse(utcDateTime.replace(" ", "T"));
}

/** The row as the database stores it, for the checks that a receiver applies to it. */
function toStoredRow(row: NotificationRow) {
    return { ...row, isSensitive: row.isSensitive ? 1 : 0 };
}

function throwIfInvalid(code: NotificationErrorCode | null) {
    if (code) {
        throw new NotificationError(code);
    }
}
