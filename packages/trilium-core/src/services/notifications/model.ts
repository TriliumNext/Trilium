/**
 * @module
 *
 * The rules of notifications as pure functions: the keys of the rows, the rules of a raise, the
 * view, the history, and the checks that every row passes, written locally or brought by sync.
 */
import {
    BUILT_IN_NOTIFICATION_PREFIX,
    getNotificationState,
    NOTIFICATION_ATTENTION_LEVELS,
    NOTIFICATION_CATEGORIES,
    NOTIFICATION_CHANNEL_RECORD_KINDS,
    NOTIFICATION_DELIVERY_ERROR_CODES,
    NOTIFICATION_GRACE_TIME_MAX_SECONDS,
    NOTIFICATION_MARK_KINDS,
    NOTIFICATION_MAX_REFS,
    NOTIFICATION_PROTECTED_NOTES_SETTINGS,
    NOTIFICATION_TYPES,
    TRANSIENT_NOTIFICATION_MAX_BYTES,
    type NotificationAction,
    type NotificationAttentionLevel,
    type NotificationCategory,
    type NotificationChannelConfig,
    type NotificationChannelRecordKind,
    type NotificationChannelSettings,
    type NotificationChannelStatus,
    type NotificationContent,
    type NotificationErrorCode,
    type NotificationMarkKind,
    type NotificationPatch,
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
/** The limit of a private text written out as plain JSON, before it is sealed. */
export const PLAIN_PRIVATE_TEXT_MAX_BYTES = 8 * 1024;
export const PRIVATE_CONTENT_MAX_BYTES = 11 * 1024;
export const CHANNEL_RECORD_MAX_BYTES = 32 * 1024;
export const MAX_ACTIONS = 5;
const CHANNEL_TITLE_MAX_LENGTH = 200;
/** The settings records that one change of the settings can name as read. */
const SETTINGS_MAX_READS = 100;
const MAX_SNAPSHOT_ATTRIBUTES = 200;
const STATUS_DATE_FIELDS = [
    "lastInvokedAt", "lastCompletedAt", "runningSince", "addressChangedAt"
] as const;

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
    noteId: string | null;
    isSensitive: boolean;
    content: string;
}

export interface ViewContext {
    nowMs: number;
    getMarkKinds(notificationId: string): Iterable<NotificationMarkKind>;
    /** Whether a newer generation of the ID is erased, by an erasure that is not dated ahead. */
    isCovered(notificationId: string): boolean;
    /** Whether the note is protected, or not held by this instance. */
    isNoteSensitive(noteId: string): boolean;
}

export interface ViewEntry<T extends ViewRow> {
    row: T;
    state: NotificationState;
    /** Whether this instance takes the notification as sensitive. */
    isSensitive: boolean;
    /** What a reader can have of the content: no text of a version that meets the fact. */
    content: NotificationContent;
}

/**
 * The notifications that an instance shows: of each ID the newest generation that is neither dated
 * ahead nor covered by an erasure, newest first, each as `describeRow()` gives it.
 */
export function resolveView<T extends ViewRow>(rows: T[], context: ViewContext): ViewEntry<T>[] {
    return selectCurrentRows(rows, context).map((row) => describeRow(row, context));
}

/** Of each ID the newest generation that is neither dated ahead nor covered, newest first. */
export function selectCurrentRows<T extends Pick<ViewRow, "notificationId" | "id">>(
    rows: T[],
    context: Pick<ViewContext, "nowMs" | "isCovered">
): T[] {
    const newestById = new Map<string, { row: T; timeMs: number }>();
    for (const row of rows) {
        if (!isShownRow(row, context)) {
            continue;
        }

        const timeMs = getTimeOfNotificationId(row.notificationId);
        const newest = newestById.get(row.id);
        if (!newest || timeMs > newest.timeMs) {
            newestById.set(row.id, { row, timeMs });
        }
    }

    return [ ...newestById.values() ]
        .sort((a, b) => b.timeMs - a.timeMs
            || compareText(b.row.notificationId, a.row.notificationId))
        .map(({ row }) => row);
}

/** Whether a generation counts for the view: it is neither dated ahead nor covered. */
export function isShownRow(
    row: Pick<ViewRow, "notificationId">,
    context: Pick<ViewContext, "nowMs" | "isCovered">
) {
    const timeMs = getTimeOfNotificationId(row.notificationId);
    return !isDatedAhead(timeMs, context.nowMs) && !context.isCovered(row.notificationId);
}

/**
 * The state of a generation, whether the instance takes it as sensitive, and its content. The text
 * of a version without the flag is left out once the notification is sensitive.
 */
export function describeRow<T extends ViewRow>(row: T, context: ViewContext): ViewEntry<T> {
    const markKinds = [ ...context.getMarkKinds(row.notificationId) ];
    const isSensitive = row.isSensitive || markKinds.includes("sensitive")
        || isAboutSensitiveNote(row, context.isNoteSensitive);
    const content = parseContent(row.content) ?? { v: 1 };
    return {
        row,
        state: getNotificationState(markKinds),
        isSensitive,
        content: isSensitive && !row.isSensitive ? makeTextPrivate(content).content : content
    };
}

/** Whether `isNoteSensitive()` takes the note that the notification refers to as sensitive. */
function isAboutSensitiveNote(
    row: Pick<ViewRow, "noteId" | "content">,
    isNoteSensitive: (noteId: string) => boolean
) {
    const noteId = getReferencedNoteId(row.noteId, row.content);
    return noteId !== null && isNoteSensitive(noteId);
}

/** The title and the description that a write moves to the private text, or `""` to clear one. */
export interface PrivateText {
    title?: string;
    description?: string;
}

/**
 * Takes the text out of a content: the title and the description, which a write can move to the
 * private text, the progress label and the captions of the actions. A link keeps its note path,
 * since its parameters can hold text that the user wrote.
 */
export function makeTextPrivate(
    content: NotificationContent
): { content: NotificationContent; text: PrivateText } {
    const { link, actions } = content;
    const publicContent = compactContent({
        v: 1,
        icon: content.icon,
        progress: content.progress,
        handler: content.handler,
        link: link === undefined ? undefined : getLinkPath(link),
        actions: actions?.map(({ id, icon }) =>
            (icon === undefined ? { id, caption: "" } : { id, caption: "", icon }))
    });
    const text = toPrivateText(content.title, content.description) ?? {};
    return { content: publicContent, text };
}

/** A link hash without its parameters: `#` and the note path. */
export function getLinkPath(link: string) {
    return splitOnce(link, "?")[0];
}

/** Whether a name is one of those that only built-in producers use. */
export function isReservedName(name: string | undefined | null) {
    return typeof name === "string" && name.startsWith(BUILT_IN_NOTIFICATION_PREFIX);
}

/** A raise as `checkInput()` returns it, with the defaults filled in. */
export interface CheckedInput {
    /** `undefined` when the caller passed none, and the service generates one. */
    id: string | undefined;
    raisedAtMs: number | undefined;
    tag: string | null;
    noteId: string | null;
    category: NotificationCategory;
    type: NotificationType;
    attentionLevel: NotificationAttentionLevel;
    /** The content as the caller gave it, its root text included. */
    content: NotificationContent;
    /** The private text that the caller passed, or `null`. */
    privateText: PrivateText | null;
    /** Whether the caller names it sensitive, by `sensitive: true` or by passing private text. */
    isNamedSensitive: boolean;
}

/**
 * Checks what a caller passes to `create()`. An empty text counts as absent.
 *
 * @param isBuiltIn whether the producer is built in: only such a producer uses reserved names.
 * @throws NotificationError with the code of the first check that fails.
 */
export function checkInput(input: unknown, isBuiltIn: boolean, nowMs: number): CheckedInput {
    if (!isPlainObject(input)) {
        throw new NotificationError("invalid-input");
    }

    const { id, title, description, protectedTitle, protectedDescription, icon, noteId, link } =
        input;
    const { tag, progress, progressLabel, actions, handler, raisedAt, sensitive } = input;
    const { category = "general", type = "standard", attentionLevel = "medium" } = input;
    if (!isOptional(id, isToken) || !isOptional(title, isLineText)
        || !isOptional(description, isText) || !isOptional(protectedTitle, isLineText)
        || !isOptional(protectedDescription, isText) || !isOptional(icon, isIcon)
        || !isOptional(noteId, isNoteId) || !isOptional(link, isLink) || !isOptional(tag, isToken)
        || !isOneOf(NOTIFICATION_CATEGORIES, category) || !isOneOf(NOTIFICATION_TYPES, type)
        || !isOneOf(NOTIFICATION_ATTENTION_LEVELS, attentionLevel)
        || !isOptional(progress, isProgress) || !isOptional(progressLabel, isLineText)
        || !isOptional(actions, isActionList) || !isOptional(handler, isToken)
        || !isOptional(raisedAt, isString) || !isOptional(sensitive, isBoolean)) {
        throw new NotificationError("invalid-input");
    }
    if (!isBuiltIn && [ id, tag, handler ].some(isReservedName)) {
        throw new NotificationError("reserved-name");
    }

    const raisedAtMs = raisedAt === undefined ? undefined : parseUtcDateTime(raisedAt);
    if (raisedAtMs === null) {
        throw new NotificationError("invalid-input");
    }
    if (raisedAtMs !== undefined && isDatedAhead(raisedAtMs, nowMs)) {
        throw new NotificationError("raised-ahead");
    }
    // A link and a note ID that are given together refer to the same note.
    if (noteId !== undefined && link !== undefined && getLinkNoteId(link) !== noteId) {
        throw new NotificationError("invalid-input");
    }

    const privateText = toPrivateText(protectedTitle, protectedDescription);
    const isNamedSensitive = sensitive === true || privateText !== null;
    if (!title && noteId === undefined && link === undefined && !isNamedSensitive) {
        throw new NotificationError("invalid-input");
    }

    const content = compactContent({
        v: 1, title, description, icon, link, progress, progressLabel, handler,
        actions: actions?.map(copyAction)
    });
    checkContentSize(content);
    if (privateText) {
        checkPlainPrivateTextSize(privateText);
    }

    return {
        id,
        raisedAtMs,
        tag: tag ?? null,
        noteId: noteId ?? null,
        category,
        type,
        attentionLevel,
        content,
        privateText,
        isNamedSensitive
    };
}

/**
 * Checks what a caller passes to `update()`. An empty text clears its field.
 *
 * @throws NotificationError with the code of the first check that fails.
 */
export function checkPatch(patch: unknown): NotificationPatch {
    if (!isPlainObject(patch)) {
        throw new NotificationError("invalid-input");
    }

    const { title, description, protectedTitle, protectedDescription, icon, progress } = patch;
    const { progressLabel, actions, sensitive } = patch;
    if (!isOptional(title, isLineText) || !isOptional(description, isText)
        || !isOptional(protectedTitle, isLineText) || !isOptional(protectedDescription, isText)
        || !isOptional(icon, isIcon) || !isOptional(progress, isProgress)
        || !isOptional(progressLabel, isLineText) || !isOptional(actions, isActionList)
        || !isOptional(sensitive, isBoolean)) {
        throw new NotificationError("invalid-input");
    }

    const checked: NotificationPatch = {
        title, description, protectedTitle, protectedDescription, icon, progress, progressLabel,
        sensitive, actions: actions?.map(copyAction)
    };
    for (const key of Object.keys(checked) as (keyof NotificationPatch)[]) {
        if (checked[key] === undefined) {
            delete checked[key];
        }
    }
    return checked;
}

/** A transient notification as `checkTransientInput()` returns it. */
export interface CheckedTransientInput {
    noteId: string | null;
    /** The public fields as the caller gave them, the root text included. */
    content: NotificationContent;
    /** The private text that the caller passed, or `null`. */
    privateText: PrivateText | null;
    /** Whether the caller names it sensitive, by `sensitive: true` or by passing private text. */
    isNamedSensitive: boolean;
}

/**
 * Checks what a caller passes for a transient notification: the fields of a raise that it takes,
 * at most 2 KiB as JSON. An empty text counts as absent.
 *
 * @throws NotificationError with the code of the first check that fails.
 */
export function checkTransientInput(input: unknown, isBuiltIn: boolean): CheckedTransientInput {
    if (!isPlainObject(input)) {
        throw new NotificationError("invalid-input");
    }

    const { title, description, protectedTitle, protectedDescription, icon, noteId } = input;
    const { progress, progressLabel, actions, handler, sensitive } = input;
    if (!isOptional(title, isLineText) || !isOptional(description, isText)
        || !isOptional(protectedTitle, isLineText) || !isOptional(protectedDescription, isText)
        || !isOptional(icon, isIcon) || !isOptional(noteId, isNoteId)
        || !isOptional(progress, isProgress) || !isOptional(progressLabel, isLineText)
        || !isOptional(actions, isActionList) || !isOptional(handler, isToken)
        || !isOptional(sensitive, isBoolean)) {
        throw new NotificationError("invalid-input");
    }
    if (!isBuiltIn && isReservedName(handler)) {
        throw new NotificationError("reserved-name");
    }

    const privateText = toPrivateText(protectedTitle, protectedDescription);
    const isNamedSensitive = sensitive === true || privateText !== null;
    if (!title && noteId === undefined && !isNamedSensitive) {
        throw new NotificationError("invalid-input");
    }

    const content = compactContent({
        v: 1, title, description, icon, progress, progressLabel, handler,
        actions: actions?.map(copyAction)
    });
    const written = JSON.stringify({ content, noteId, privateText });
    if (encodeUtf8(written).byteLength > TRANSIENT_NOTIFICATION_MAX_BYTES) {
        throw new NotificationError("too-large");
    }
    return { noteId: noteId ?? null, content, privateText, isNamedSensitive };
}

/** A generation that a request names, with its time. */
export interface CheckedRef {
    id: string;
    raisedAtMs: number;
}

/**
 * Checks the refs of a request: at most 500, each an ID and a time.
 *
 * @throws NotificationError `invalid-input` for anything else.
 */
export function checkRefs(refs: unknown): CheckedRef[] {
    if (!Array.isArray(refs) || refs.length > NOTIFICATION_MAX_REFS) {
        throw new NotificationError("invalid-input");
    }

    return refs.map((ref: unknown) => {
        const raisedAtMs = isPlainObject(ref) ? parseUtcDateTime(ref.raisedAt) : null;
        if (!isPlainObject(ref) || !isToken(ref.id) || raisedAtMs === null) {
            throw new NotificationError("invalid-input");
        }
        return { id: ref.id, raisedAtMs };
    });
}

/** Drops the fields of a content that are absent or empty text. */
export function compactContent(content: NotificationContent): NotificationContent {
    const compact: Record<string, unknown> = {};
    for (const [ key, value ] of Object.entries(content)) {
        if (value !== undefined && value !== "") {
            compact[key] = value;
        }
    }
    return compact as unknown as NotificationContent;
}

/** @throws NotificationError `too-large` for a content over 8 KiB as stored. */
export function checkContentSize(content: NotificationContent) {
    if (encodeUtf8(JSON.stringify(content)).byteLength > CONTENT_MAX_BYTES) {
        throw new NotificationError("too-large");
    }
}

/** @throws NotificationError `too-large` for a private text over 8 KiB as plain JSON. */
export function checkPlainPrivateTextSize(text: PrivateText) {
    const plain = JSON.stringify({ v: 1, title: text.title, description: text.description });
    if (encodeUtf8(plain).byteLength > PLAIN_PRIVATE_TEXT_MAX_BYTES) {
        throw new NotificationError("too-large");
    }
}

/** The non-empty text of the two fields, or `null` when both are empty. */
function toPrivateText(title: string | undefined, description: string | undefined) {
    if (!title && !description) {
        return null;
    }

    const text: PrivateText = {};
    if (title) {
        text.title = title;
    }
    if (description) {
        text.description = description;
    }
    return text;
}

function copyAction({ id, caption, icon }: NotificationAction): NotificationAction {
    return icon === undefined ? { id, caption } : { id, caption, icon };
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

/**
 * Checks a row of `notification_channel_records`: its content by its kind, and a key that the
 * kind derives from its channel or its activation.
 */
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

    const parsed = parseChannelRecord(kind, content);
    if (!parsed) {
        return "invalid-content";
    }
    const expectedId = getExpectedRecordId(kind, channelId, parsed);
    return expectedId === null || expectedId === recordId ? null : "invalid-key";
}

/** The definition of a built-in channel, in its `channel` record. */
export interface ChannelDefinition {
    v: 1;
    type: string;
    title: string;
    config: NotificationChannelConfig;
    /** The configuration ID of a webhook's address, which the forwarding instance writes. */
    configurationId?: string;
    isDeleted?: boolean;
}

/** An owned attribute of a channel note, as an enabling reviewed it. */
export interface AttributeSnapshot {
    type: "label" | "relation";
    name: string;
    value: string;
    isInheritable: boolean;
}

/** The `activation` record of a channel: the enabled activation, or none after a disabling. */
export interface ActivationRecord {
    v: 1;
    activationId: string | null;
    /** One above the highest that the writing instance knew, a whole number below 2^53. */
    sequence: number;
    revision: string | null;
    /** For a script: the revision of the record without the channel note's own attributes. */
    restRevision?: string;
    /** For a script: the label that makes its note a channel. */
    label?: { attributeId: string; utcDateModified: string };
    /** For a script: the owned attributes of the channel note. */
    ownedAttributes?: AttributeSnapshot[];
    /** The settings that the enabling confirmed. */
    settings: NotificationChannelSettings;
}

/** A disabling, which no write replaces. */
export interface RevocationRecord {
    v: 1;
    activationId: string;
    revokedAt: string;
}

/** A change of the settings of an activation, which names the settings records that it read. */
export interface SettingsRecord {
    v: 1;
    activationId: string;
    settings: NotificationChannelSettings;
    reads: string[];
}

export interface StatusRecord {
    v: 1;
    status: NotificationChannelStatus;
}

export type ChannelRecordContent =
    ChannelDefinition | ActivationRecord | RevocationRecord | SettingsRecord | StatusRecord;

/** The content of each kind of record. */
export interface ChannelRecordContents {
    channel: ChannelDefinition;
    activation: ActivationRecord;
    revocation: RevocationRecord;
    settings: SettingsRecord;
    status: StatusRecord;
}

/** The key of the `activation` record of a channel, the same on every instance. */
export function getActivationRecordId(channelId: string) {
    return hashedBlobId(`activation|${channelId}`);
}

export function getStatusRecordId(channelId: string) {
    return hashedBlobId(`status|${channelId}`);
}

export function getRevocationRecordId(activationId: string) {
    return hashedBlobId(`revocation|${activationId}`);
}

function getExpectedRecordId(
    kind: NotificationChannelRecordKind,
    channelId: string,
    content: ChannelRecordContent
) {
    switch (kind) {
        case "channel":
            return channelId;
        case "activation":
            return getActivationRecordId(channelId);
        case "status":
            return getStatusRecordId(channelId);
        case "revocation":
            return getRevocationRecordId((content as RevocationRecord).activationId);
        case "settings":
            return null;
    }
}

/** Reads the content of a channel record of a kind, or `null` where it fails a check. */
export function parseChannelRecord<K extends NotificationChannelRecordKind>(
    kind: K,
    content: string
): ChannelRecordContents[K] | null {
    const value = parseJsonObject(content, CHANNEL_RECORD_MAX_BYTES);
    if (!value || value.v !== 1) {
        return null;
    }

    switch (kind) {
        case "channel":
            return parseDefinition(value) as ChannelRecordContents[K] | null;
        case "activation":
            return parseActivation(value) as ChannelRecordContents[K] | null;
        case "revocation":
            return (isToken(value.activationId) && parseUtcDateTime(value.revokedAt) !== null
                ? { v: 1, activationId: value.activationId, revokedAt: value.revokedAt }
                : null) as ChannelRecordContents[K] | null;
        case "settings":
            return parseSettingsRecord(value) as ChannelRecordContents[K] | null;
        case "status":
            return { v: 1, status: parseStatus(value.status) } as ChannelRecordContents[K];
    }
    return null;
}

function parseDefinition(value: Record<string, unknown>): ChannelDefinition | null {
    const { type, title, config, configurationId, isDeleted } = value;
    if (!isToken(type) || !isLineText(title) || title.length > CHANNEL_TITLE_MAX_LENGTH
        || !isPlainObject(config) || !isOptional(config.template, isString)
        || !isOptional(configurationId, isToken) || !isOptional(isDeleted, isBoolean)) {
        return null;
    }

    const definition: ChannelDefinition = { v: 1, type, title, config: {} };
    if (config.template !== undefined) {
        definition.config.template = config.template;
    }
    if (configurationId !== undefined) {
        definition.configurationId = configurationId;
    }
    if (isDeleted) {
        definition.isDeleted = true;
    }
    return definition;
}

function parseActivation(value: Record<string, unknown>): ActivationRecord | null {
    const { activationId, sequence, revision, restRevision, label, ownedAttributes } = value;
    const settings = parseSettings(value.settings);
    if (!isNullOr(activationId, isToken) || !isSequence(sequence) || !isNullOr(revision, isToken)
        || !isOptional(restRevision, isToken) || !settings
        || !isOptional(label, isLabelReference)
        || !isOptional(ownedAttributes, isAttributeList)) {
        return null;
    }

    const activation: ActivationRecord = { v: 1, activationId, sequence, revision, settings };
    if (restRevision !== undefined) {
        activation.restRevision = restRevision;
    }
    if (label !== undefined) {
        const { attributeId, utcDateModified } = label;
        activation.label = { attributeId, utcDateModified };
    }
    if (ownedAttributes !== undefined) {
        activation.ownedAttributes = ownedAttributes.map(
            ({ type, name, value: attributeValue, isInheritable }) =>
                ({ type, name, value: attributeValue, isInheritable }));
    }
    return activation;
}

function parseSettingsRecord(value: Record<string, unknown>): SettingsRecord | null {
    const { activationId, reads } = value;
    const settings = parseSettings(value.settings);
    if (!isToken(activationId) || !settings || !Array.isArray(reads)
        || reads.length > SETTINGS_MAX_READS || !reads.every(isNoteId)) {
        return null;
    }
    return { v: 1, activationId, settings, reads: [ ...reads ] };
}

/** Reads the settings of a channel, or `null` where they fail a check. */
export function parseSettings(value: unknown): NotificationChannelSettings | null {
    if (!isPlainObject(value)) {
        return null;
    }

    const { graceTime, protectedNotes } = value;
    if (!isGraceTime(graceTime)
        || !isOneOf(NOTIFICATION_PROTECTED_NOTES_SETTINGS, protectedNotes)) {
        return null;
    }
    return { graceTime, protectedNotes };
}

/** Whether a value is a grace time: whole seconds from zero to 12 hours. */
export function isGraceTime(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 0
        && (value as number) <= NOTIFICATION_GRACE_TIME_MAX_SECONDS;
}

/**
 * Reads a status that a peer can have written: a field that fails a check is left out, and a
 * count that fails one is zero.
 */
function parseStatus(value: unknown): NotificationChannelStatus {
    const status = isPlainObject(value) ? value : {};
    const counts = isPlainObject(status.counts) ? status.counts : {};
    const parsed: NotificationChannelStatus = {
        counts: {
            sent: toCount(counts.sent),
            sentPublic: toCount(counts.sentPublic),
            skipped: toCount(counts.skipped),
            failed: toCount(counts.failed),
            expired: toCount(counts.expired),
            waitingForBudget: toCount(counts.waitingForBudget)
        },
        runsBackendScripts: status.runsBackendScripts === true,
        recordHoldsActivation: status.recordHoldsActivation === true,
        recordSequence: isSequence(status.recordSequence) ? status.recordSequence : 0
    };
    for (const field of STATUS_DATE_FIELDS) {
        const date = status[field];
        if (parseUtcDateTime(date) !== null) {
            parsed[field] = date as string;
        }
    }
    if (toCount(status.durationMs) > 0) {
        parsed.durationMs = toCount(status.durationMs);
    }
    if (isOneOf(NOTIFICATION_DELIVERY_ERROR_CODES, status.lastErrorCode)) {
        parsed.lastErrorCode = status.lastErrorCode;
    }
    if (Number.isInteger(status.lastHttpStatus)) {
        parsed.lastHttpStatus = status.lastHttpStatus as number;
    }
    return parsed;
}

/** Whether a value is a sequence of a channel switching: a whole number from zero below 2^53. */
export function isSequence(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * The settings that hold for an activation: those of the settings records that no other record
 * of the activation read, and of two or more the stricter value of each, the longer grace time
 * and `none` before `public`. Without such a record, those that the enabling confirmed.
 */
export function resolveSettings(
    activation: Pick<ActivationRecord, "activationId" | "settings">,
    records: { recordId: string; content: SettingsRecord }[]
): { settings: NotificationChannelSettings; currentRecordIds: string[] } {
    const ofActivation = records.filter(({ content }) =>
        content.activationId === activation.activationId);
    const read = new Set(ofActivation.flatMap(({ content }) => content.reads));
    const current = ofActivation.filter(({ recordId }) => !read.has(recordId));
    if (current.length === 0) {
        return { settings: activation.settings, currentRecordIds: [] };
    }

    return {
        settings: {
            graceTime: Math.max(...current.map(({ content }) => content.settings.graceTime)),
            protectedNotes: current.some(({ content }) =>
                content.settings.protectedNotes === "none") ? "none" : "public"
        },
        currentRecordIds: current.map(({ recordId }) => recordId).sort()
    };
}

function isLabelReference(
    value: unknown
): value is { attributeId: string; utcDateModified: string } {
    return isPlainObject(value) && isNoteId(value.attributeId)
        && parseUtcDateTime(value.utcDateModified) !== null;
}

function isAttributeList(value: unknown): value is AttributeSnapshot[] {
    return Array.isArray(value) && value.length <= MAX_SNAPSHOT_ATTRIBUTES
        && value.every((attribute) => isPlainObject(attribute)
            && (attribute.type === "label" || attribute.type === "relation")
            && isString(attribute.name) && isString(attribute.value)
            && isBoolean(attribute.isInheritable));
}

function toCount(value: unknown) {
    return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
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

/** Whether a value has the charset and length of an ID, a tag, a handler or a producer. */
export function isToken(value: unknown): value is string {
    return typeof value === "string" && TOKEN.test(value);
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
    return typeof value === "boolean";
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
