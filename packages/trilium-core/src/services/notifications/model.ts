/**
 * @module
 *
 * The rules of notifications as pure functions: the keys of the rows, the rules of a raise, the
 * view, the history, and the checks that every row passes, written locally or brought by sync.
 */
import {
    getNotificationState,
    NOTIFICATION_ATTENTION_LEVELS,
    NOTIFICATION_CATEGORIES,
    NOTIFICATION_CHANNEL_RECORD_KINDS,
    NOTIFICATION_MARK_KINDS,
    NOTIFICATION_TYPES,
    type NotificationAction,
    type NotificationAttentionLevel,
    type NotificationContent,
    type NotificationMarkKind,
    type NotificationPrivateContent,
    type NotificationState,
    type NotificationType
} from "@triliumnext/commons";

import { encodeUtf8 } from "../utils/binary.js";
import dateUtils from "../utils/date.js";
import { hashedBlobId, isValidEntityId } from "../utils/index.js";

/** A generation dated more than this ahead of the local clock is left out of the rules. */
export const AHEAD_TOLERANCE_MS = 60 * 60 * 1000;
/** The number of standard notifications kept in the history. */
export const HISTORY_LIMIT = 200;
export const CONTENT_MAX_BYTES = 8 * 1024;
export const PRIVATE_CONTENT_MAX_BYTES = 11 * 1024;
export const CHANNEL_RECORD_MAX_BYTES = 32 * 1024;
export const MAX_ACTIONS = 5;

const ID_HASH_LENGTH = 12;
const TIME_KEY_LENGTH = 9;
const MAX_TIME_MS = 36 ** TIME_KEY_LENGTH;
/** A `high` notification younger than this is not trimmed: a channel can still have to send it. */
const YOUNG_HIGH_MS = 24 * 60 * 60 * 1000;

const MARK_LETTERS: Record<NotificationMarkKind, string> = { seen: "s", read: "r", sensitive: "x" };
const TRIM_ORDER: Record<NotificationState, number> = { read: 0, seen: 1, pending: 2 };

const NOTIFICATION_ID = /^[A-Za-z0-9]{12}[0-9a-z]{9}$/;
/** IDs, tags, producers, handlers and action IDs. */
const TOKEN = /^[A-Za-z0-9_.:-]{1,100}$/;
/** The charset of class names. */
const ICON = /^[A-Za-z0-9 _-]{1,100}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LINE_TEXT = /^[^\u{0}-\u{1F}\u{7F}-\u{9F}]*$/u;
/** Text with line feeds, and no other control character. */
const TEXT = /^[^\u{0}-\u{9}\u{B}-\u{1F}\u{7F}-\u{9F}]*$/u;
/** What `encodeURIComponent()` writes, and the `:` of a block range. */
const LINK_VALUE = /^[A-Za-z0-9\-_.!~*'()%:]*$/;
/** The parameters that `calculateHash()` of the client writes. */
const LINK_PARAMETERS = new Set([
    "ntxId", "hoistedNoteId", "viewMode", "attachmentId", "block", "column", "columnTitle",
    "columnIcon", "columnColor", "card", "page", "annotation", "heading", "searchTerms", "splits",
    "activeSplit"
]);

const NOTIFICATION_COLUMNS = [
    "notificationId", "id", "raisedAt", "tag", "noteId", "category", "type", "attentionLevel",
    "isSensitive", "producer", "content", "utcDateCreated", "utcDateModified"
];
const MARK_COLUMNS = [ "markId", "notificationId", "kind", "utcDateCreated" ];
const PRIVATE_TEXT_COLUMNS = [ "notificationId", "content", "utcDateCreated", "utcDateModified" ];
const CHANNEL_RECORD_COLUMNS = [
    "recordId", "channelId", "kind", "content", "utcDateCreated", "utcDateModified"
];

export type NotificationErrorCode =
    /** A column has the wrong type, value, length or charset, or the row has other columns. */
    | "invalid-row"
    /** The key of the row is not the one computed from its columns or named by its change. */
    | "invalid-key"
    | "invalid-content"
    /** A synced change of a row arrived without the row. */
    | "missing-row"
    /** An erasure of a mark or a private text, which are deleted with their notification. */
    | "erasure-refused"
    | "raised-ahead";

/** An error of notification code. Its message is the code alone, never input or row text. */
export class NotificationError extends Error {

    constructor(readonly code: NotificationErrorCode) {
        super(code);
        this.name = "NotificationError";
    }

}

/** The first 12 characters of a `notificationId`, shared by every generation of the ID. */
export function getIdHash(id: string) {
    return hashedBlobId(id).substring(0, ID_HASH_LENGTH);
}

/** The key of a generation: the hash of its ID, then its time in nine digits of base 36. */
export function getNotificationId(id: string, raisedAtMs: number) {
    return getIdHash(id) + formatTimeKey(raisedAtMs);
}

export function formatTimeKey(timeMs: number) {
    return timeMs.toString(36).padStart(TIME_KEY_LENGTH, "0");
}

export function getTimeOfNotificationId(notificationId: string) {
    return parseInt(notificationId.substring(ID_HASH_LENGTH), 36);
}

/** The first and the last key that a generation of the ID can have. */
export function getKeyRange(id: string): [ string, string ] {
    const idHash = getIdHash(id);
    return [ idHash + "0".repeat(TIME_KEY_LENGTH), idHash + "z".repeat(TIME_KEY_LENGTH) ];
}

/** The last key of a generation of the same ID that is not dated ahead at `nowMs`. */
export function getLastCountedKey(notificationId: string, nowMs: number) {
    return notificationId.substring(0, ID_HASH_LENGTH) + formatTimeKey(nowMs + AHEAD_TOLERANCE_MS);
}

/** The `notificationId` that the key of a mark or of a private text starts with. */
export function getOwnerNotificationId(partId: string) {
    return partId.substring(0, ID_HASH_LENGTH + TIME_KEY_LENGTH);
}

export function isNotificationId(value: unknown): value is string {
    return typeof value === "string" && NOTIFICATION_ID.test(value);
}

export function getMarkId(notificationId: string, kind: NotificationMarkKind) {
    return notificationId + MARK_LETTERS[kind];
}

export function getMarkIds(notificationId: string) {
    return NOTIFICATION_MARK_KINDS.map((kind) => getMarkId(notificationId, kind));
}

/**
 * Reads a date in the form that Trilium stores, `YYYY-MM-DD HH:mm:ss.SSSZ`.
 *
 * @returns the time in milliseconds, or `null` for other text and a time outside the keys' range.
 */
export function parseUtcDateTime(value: unknown): number | null {
    if (typeof value !== "string" || !UTC_DATE_TIME.test(value)) {
        return null;
    }

    const timeMs = Date.parse(value.replace(" ", "T"));
    // Refuses a date that does not exist, such as the 30th of February.
    if (Number.isNaN(timeMs) || formatUtcDateTime(timeMs) !== value) {
        return null;
    }
    return timeMs >= 0 && timeMs < MAX_TIME_MS ? timeMs : null;
}

export function formatUtcDateTime(timeMs: number) {
    return dateUtils.utcDateTimeStr(new Date(timeMs));
}

export function isDatedAhead(timeMs: number, nowMs: number) {
    return timeMs > nowMs + AHEAD_TOLERANCE_MS;
}

/** The date of a rewrite: now, or one millisecond after the stored date, whichever is later. */
export function getRewriteDateMs(nowMs: number, storedMs: number) {
    return Math.max(nowMs, storedMs + 1);
}

/**
 * The time of a raise without `raisedAt`: now, or one millisecond after the newest stored or
 * erased generation of the ID. A generation dated ahead is left out.
 */
export function getDefaultRaisedAtMs(nowMs: number, knownTimes: number[]) {
    let raisedAtMs = nowMs;
    for (const timeMs of knownTimes) {
        if (!isDatedAhead(timeMs, nowMs)) {
            raisedAtMs = Math.max(raisedAtMs, timeMs + 1);
        }
    }
    return raisedAtMs;
}

/** The outcomes of a raise. On `new`, the generation is written and the older ones erased. */
export type RaiseOutcome = "categoryOff" | "stored" | "erased" | "late" | "new";

export interface RaiseFacts {
    isCategoryOff: boolean;
    raisedAtMs: number;
    nowMs: number;
    /** The times of the stored generations of the ID. */
    storedTimes: number[];
    /** The times of the erased generations of the ID. */
    erasedTimes: number[];
}

/** Decides the outcome of a raise. A generation dated ahead is left out of the rules. */
export function classifyRaise(facts: RaiseFacts): RaiseOutcome {
    const { isCategoryOff, raisedAtMs, nowMs, storedTimes, erasedTimes } = facts;
    if (isCategoryOff) {
        return "categoryOff";
    }
    if (storedTimes.includes(raisedAtMs)) {
        return "stored";
    }

    const isCounted = (timeMs: number) => !isDatedAhead(timeMs, nowMs);
    if (erasedTimes.some((timeMs) => timeMs >= raisedAtMs && isCounted(timeMs))) {
        return "erased";
    }
    if (storedTimes.some((timeMs) => timeMs > raisedAtMs && isCounted(timeMs))) {
        return "late";
    }
    return "new";
}

export interface ViewRow {
    notificationId: string;
    id: string;
}

export interface ViewContext {
    nowMs: number;
    getMarkKinds(notificationId: string): Iterable<NotificationMarkKind>;
    /** Whether a newer generation of the ID is erased, by an erasure that is not dated ahead. */
    isCovered(notificationId: string): boolean;
}

export interface ViewEntry<T extends ViewRow> {
    row: T;
    state: NotificationState;
}

/**
 * The notifications that an instance shows: of each ID the newest generation that is neither dated
 * ahead nor covered by an erasure, with its state, newest first.
 */
export function resolveView<T extends ViewRow>(rows: T[], context: ViewContext): ViewEntry<T>[] {
    const newestById = new Map<string, { row: T; timeMs: number }>();
    for (const row of rows) {
        const timeMs = getTimeOfNotificationId(row.notificationId);
        if (isDatedAhead(timeMs, context.nowMs) || context.isCovered(row.notificationId)) {
            continue;
        }

        const newest = newestById.get(row.id);
        if (!newest || timeMs > newest.timeMs) {
            newestById.set(row.id, { row, timeMs });
        }
    }

    return [ ...newestById.values() ]
        .sort((a, b) => b.timeMs - a.timeMs
            || compareText(b.row.notificationId, a.row.notificationId))
        .map(({ row }) => ({
            row,
            state: getNotificationState(context.getMarkKinds(row.notificationId))
        }));
}

export interface HistoryEntry {
    notificationId: string;
    type: NotificationType;
    attentionLevel: NotificationAttentionLevel;
    raisedAtMs: number;
    state: NotificationState;
}

/**
 * The notifications to erase so that at most `limit` standard ones remain: read ones first, then
 * seen, then pending, each oldest first. Persistent ones and young `high` ones are never trimmed.
 */
export function pickTrimmed(entries: HistoryEntry[], nowMs: number, limit = HISTORY_LIMIT) {
    const standard = entries.filter((entry) => entry.type === "standard");
    const surplus = standard.length - limit;
    if (surplus <= 0) {
        return [];
    }

    return standard
        .filter((entry) => entry.attentionLevel !== "high"
            || nowMs - entry.raisedAtMs >= YOUNG_HIGH_MS)
        .sort((a, b) => TRIM_ORDER[a.state] - TRIM_ORDER[b.state]
            || a.raisedAtMs - b.raisedAtMs
            || compareText(a.notificationId, b.notificationId))
        .slice(0, surplus)
        .map((entry) => entry.notificationId);
}

/** The note that a notification refers to: its `noteId`, or the note of its link. */
export function getReferencedNoteId(noteId: string | null, content: string) {
    if (noteId !== null) {
        return noteId;
    }
    const link = parseContent(content)?.link;
    return link === undefined ? null : getLinkNoteId(link);
}

/**
 * The note that a link hash points to: the last note of its path.
 *
 * @returns `null` for anything but `#`, a note path and the parameters of `calculateHash()`.
 */
export function getLinkNoteId(link: string) {
    if (!link.startsWith("#")) {
        return null;
    }

    const [ path, query ] = splitOnce(link.substring(1), "?");
    const noteIds = path.split("/");
    if (!noteIds.every((noteId) => isValidEntityId(noteId))) {
        return null;
    }

    for (const parameter of query === null ? [] : query.split("&")) {
        const [ name, value ] = splitOnce(parameter, "=");
        if (!LINK_PARAMETERS.has(name) || value === null || !LINK_VALUE.test(value)) {
            return null;
        }
    }
    return noteIds[noteIds.length - 1];
}

/** Reads the `content` of a notification, or `null` where it fails a check. */
export function parseContent(content: string): NotificationContent | null {
    const value = parseJsonObject(content, CONTENT_MAX_BYTES);
    if (!value || value.v !== 1) {
        return null;
    }

    const { title, description, icon, link, progress, progressLabel, actions, handler } = value;
    if (!isOptional(title, isLineText) || !isOptional(description, isText)
        || !isOptional(icon, isIcon) || !isOptional(link, isLink)
        || !isOptional(progress, isProgress) || !isOptional(progressLabel, isLineText)
        || !isOptional(actions, isActionList) || !isOptional(handler, isToken)) {
        return null;
    }

    return {
        v: 1,
        title,
        description,
        icon,
        link,
        progress,
        progressLabel,
        actions: actions?.map((action) => ({
            id: action.id, caption: action.caption, icon: action.icon
        })),
        handler
    };
}

/** Reads the `content` of a private text, or `null` where it fails a check. */
export function parsePrivateContent(content: string): NotificationPrivateContent | null {
    const value = parseJsonObject(content, PRIVATE_CONTENT_MAX_BYTES);
    if (!value || value.v !== 1) {
        return null;
    }

    const { title, description } = value;
    if (!isOptional(title, isBase64) || !isOptional(description, isBase64)) {
        return null;
    }
    return { v: 1, title, description };
}

/** Checks a row of `notifications` as it is stored: `isSensitive` is `0` or `1`. */
export function checkNotificationRow(row: unknown): NotificationErrorCode | null {
    if (!isRowOf(row, NOTIFICATION_COLUMNS)) {
        return "invalid-row";
    }

    const { notificationId, id, raisedAt, tag, noteId, category, type, attentionLevel } = row;
    const { isSensitive, producer, content, utcDateCreated, utcDateModified } = row;
    const raisedAtMs = parseUtcDateTime(raisedAt);
    if (!isToken(id) || raisedAtMs === null || !isNullOr(tag, isToken)
        || !isNullOr(noteId, isNoteId) || !isOneOf(NOTIFICATION_CATEGORIES, category)
        || !isOneOf(NOTIFICATION_TYPES, type)
        || !isOneOf(NOTIFICATION_ATTENTION_LEVELS, attentionLevel)
        || (isSensitive !== 0 && isSensitive !== 1) || !isToken(producer)
        || typeof content !== "string" || !isDates(utcDateCreated, utcDateModified)) {
        return "invalid-row";
    }

    if (notificationId !== getNotificationId(id, raisedAtMs)) {
        return "invalid-key";
    }

    const parsed = parseContent(content);
    // A link and a note ID that are given together refer to the same note.
    if (!parsed || (noteId !== null && parsed.link !== undefined
        && getLinkNoteId(parsed.link) !== noteId)) {
        return "invalid-content";
    }
    return null;
}

export function checkMarkRow(row: unknown): NotificationErrorCode | null {
    if (!isRowOf(row, MARK_COLUMNS)) {
        return "invalid-row";
    }

    const { markId, notificationId, kind, utcDateCreated } = row;
    if (!isNotificationId(notificationId) || !isOneOf(NOTIFICATION_MARK_KINDS, kind)
        || parseUtcDateTime(utcDateCreated) === null) {
        return "invalid-row";
    }
    return markId === getMarkId(notificationId, kind) ? null : "invalid-key";
}

export function checkPrivateTextRow(row: unknown): NotificationErrorCode | null {
    if (!isRowOf(row, PRIVATE_TEXT_COLUMNS)) {
        return "invalid-row";
    }

    const { notificationId, content, utcDateCreated, utcDateModified } = row;
    if (!isNotificationId(notificationId) || typeof content !== "string"
        || !isDates(utcDateCreated, utcDateModified)) {
        return "invalid-row";
    }
    return parsePrivateContent(content) ? null : "invalid-content";
}

export function checkChannelRecordRow(row: unknown): NotificationErrorCode | null {
    if (!isRowOf(row, CHANNEL_RECORD_COLUMNS)) {
        return "invalid-row";
    }

    const { recordId, channelId, kind, content, utcDateCreated, utcDateModified } = row;
    if (!isNoteId(recordId) || !isNoteId(channelId)
        || !isOneOf(NOTIFICATION_CHANNEL_RECORD_KINDS, kind) || typeof content !== "string"
        || !isDates(utcDateCreated, utcDateModified)) {
        return "invalid-row";
    }
    return parseJsonObject(content, CHANNEL_RECORD_MAX_BYTES) ? null : "invalid-content";
}

const SYNCED_ROW_CHECKS = new Map([
    [ "notifications", { check: checkNotificationRow, keyColumn: "notificationId" } ],
    [ "notification_marks", { check: checkMarkRow, keyColumn: "markId" } ],
    [ "notification_private_texts", { check: checkPrivateTextRow, keyColumn: "notificationId" } ],
    [ "notification_channel_records", { check: checkChannelRecordRow, keyColumn: "recordId" } ]
]);

/** Whether the entity is one of the four tables of notifications that sync. */
export function isNotificationEntityName(entityName: string) {
    return SYNCED_ROW_CHECKS.has(entityName);
}

/**
 * Checks a change of one of the four tables that sync brings, before it is stored: the row with
 * the checks of a local write, and its key against the ID of the change.
 */
export function checkSyncedChange(
    entityName: string,
    entityId: string,
    isErased: boolean,
    row: unknown
): NotificationErrorCode | null {
    const checks = SYNCED_ROW_CHECKS.get(entityName);
    if (!checks) {
        return "invalid-row";
    }

    if (isErased) {
        if (entityName !== "notifications") {
            return "erasure-refused";
        }
        return isNotificationId(entityId) ? null : "invalid-key";
    }

    if (row === undefined) {
        return "missing-row";
    }
    const code = checks.check(row);
    if (code) {
        return code;
    }
    return (row as Record<string, unknown>)[checks.keyColumn] === entityId ? null : "invalid-key";
}

function parseJsonObject(text: string, maxBytes: number): Record<string, unknown> | null {
    if (encodeUtf8(text).byteLength > maxBytes) {
        return null;
    }

    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    return isPlainObject(value) ? value : null;
}

function isRowOf(row: unknown, columns: string[]): row is Record<string, unknown> {
    return isPlainObject(row)
        && Object.keys(row).length === columns.length
        && columns.every((column) => Object.hasOwn(row, column));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDates(utcDateCreated: unknown, utcDateModified: unknown) {
    return parseUtcDateTime(utcDateCreated) !== null && parseUtcDateTime(utcDateModified) !== null;
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
    return (values as readonly unknown[]).includes(value);
}

function isOptional<T>(
    value: unknown,
    check: (value: unknown) => value is T
): value is T | undefined {
    return value === undefined || check(value);
}

function isNullOr<T>(value: unknown, check: (value: unknown) => value is T): value is T | null {
    return value === null || check(value);
}

function isToken(value: unknown): value is string {
    return typeof value === "string" && TOKEN.test(value);
}

function isNoteId(value: unknown): value is string {
    return typeof value === "string" && isValidEntityId(value);
}

function isIcon(value: unknown): value is string {
    return typeof value === "string" && ICON.test(value);
}

function isLineText(value: unknown): value is string {
    return typeof value === "string" && LINE_TEXT.test(value);
}

function isText(value: unknown): value is string {
    return typeof value === "string" && TEXT.test(value);
}

function isBase64(value: unknown): value is string {
    return typeof value === "string" && BASE64.test(value);
}

function isLink(value: unknown): value is string {
    return typeof value === "string" && getLinkNoteId(value) !== null;
}

function isProgress(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value <= 1;
}

function isActionList(value: unknown): value is NotificationAction[] {
    return Array.isArray(value) && value.length <= MAX_ACTIONS && value.every(isAction);
}

function isAction(value: unknown): value is NotificationAction {
    return isPlainObject(value) && isToken(value.id) && isLineText(value.caption)
        && isOptional(value.icon, isIcon);
}

/** Splits at the first separator. The second part is `null` when the text has none. */
function splitOnce(text: string, separator: string): [ string, string | null ] {
    const index = text.indexOf(separator);
    return index === -1
        ? [ text, null ]
        : [ text.substring(0, index), text.substring(index + separator.length) ];
}

function compareText(a: string, b: string) {
    return Number(a > b) - Number(a < b);
}
