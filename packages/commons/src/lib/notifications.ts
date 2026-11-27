/**
 * @module
 *
 * The categories, types, levels, states and stored shapes of notifications, shared by the backend
 * and the client.
 */

/** The categories of a notification. The settings page turns each one on or off. */
export const NOTIFICATION_CATEGORIES = [ "general", "reminder", "softwareUpdate" ] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];

/** A persistent notification is dismissed only by its handler, or by "Dismiss anyway". */
export const NOTIFICATION_TYPES = [ "standard", "persistent" ] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];

export const NOTIFICATION_ATTENTION_LEVELS = [ "low", "medium", "high" ] as const;
export type NotificationAttentionLevel = typeof NOTIFICATION_ATTENTION_LEVELS[number];

export type NotificationState = "pending" | "seen" | "read";

/** The states that a client can write. `pending` is the state without a mark. */
export type NotificationMarkState = Exclude<NotificationState, "pending">;

/** The kinds of mark, each a fact about a generation. A mark is written once, never changed. */
export const NOTIFICATION_MARK_KINDS = [ "seen", "read", "sensitive" ] as const;
export type NotificationMarkKind = typeof NOTIFICATION_MARK_KINDS[number];

/** The kinds of the records that describe a channel. */
export const NOTIFICATION_CHANNEL_RECORD_KINDS = [
    "channel", "activation", "revocation", "settings", "status"
] as const;
export type NotificationChannelRecordKind = typeof NOTIFICATION_CHANNEL_RECORD_KINDS[number];

export interface NotificationAction {
    id: string;
    caption: string;
    icon?: string;
}

/** The `content` column of a notification. Each field is optional, and a reader ignores others. */
export interface NotificationContent {
    v: 1;
    title?: string;
    description?: string;
    icon?: string;
    /** A link hash: `#`, a note path and the parameters that `calculateHash()` writes. */
    link?: string;
    /** From 0 to 1. A negative value shows an indeterminate bar. */
    progress?: number;
    progressLabel?: string;
    actions?: NotificationAction[];
    handler?: string;
}

/** The `content` column of a private text. Each field is sealed and written in base64. */
export interface NotificationPrivateContent {
    v: 1;
    title?: string;
    description?: string;
}

/** What a caller passes to `create()`. */
export interface NotificationInput {
    /** Identifies the notification. Stored in plain text: never note content. */
    id?: string;
    /** The public text. `title` is required unless `noteId`, `link` or private text is set. */
    title?: string;
    description?: string;
    /**
     * The private text of a sensitive notification. It is stored encrypted, in a row of its own,
     * where a protected session is open, and read back only while one is open.
     */
    protectedTitle?: string;
    protectedDescription?: string;
    icon?: string;
    noteId?: string;
    /** A link hash: `#`, a note path and the parameters that `calculateHash()` writes. */
    link?: string;
    /** Groups notifications for `getByTag()`. Stored in plain text, like the ID. */
    tag?: string;
    category?: NotificationCategory;
    type?: NotificationType;
    attentionLevel?: NotificationAttentionLevel;
    /** From 0 to 1. A negative value shows an indeterminate bar. */
    progress?: number;
    progressLabel?: string;
    actions?: NotificationAction[];
    handler?: string;
    /** When the event happened, in UTC. Instances that raise the same event pass the same value. */
    raisedAt?: string;
    /** Names the notification as sensitive. Only `true` means something: no write takes it back. */
    sensitive?: boolean;
}

/** A notification as the backend's view gives it to a reader. */
export interface TriliumNotification extends NotificationInput {
    /** The key of the generation, which entity changes and alerts name. */
    notificationId: string;
    id: string;
    raisedAt: string;
    updatedAt: string;
    /** Opaque. Changes whenever the stored row or its private text changes, never with a mark. */
    revision: string;
    category: NotificationCategory;
    type: NotificationType;
    attentionLevel: NotificationAttentionLevel;
    state: NotificationState;
    /** The name of a built-in producer, `script:<noteId>` or `client`. */
    producer: string;
}

/** Names one generation: what a user or a handler was looking at. */
export interface NotificationRef {
    id: string;
    raisedAt: string;
}

/**
 * What `update()` changes. `sensitive: true` names the notification as sensitive, and so does
 * private text. An empty string clears a text field.
 */
export type NotificationPatch = Partial<Pick<NotificationInput,
    "title" | "description" | "protectedTitle" | "protectedDescription" | "icon" | "progress"
    | "progressLabel" | "actions" | "sensitive">>;

/** Implemented by the client service and by the core service. */
export interface NotificationApi {
    /** Raises a notification. Resolves to `null` when none is stored. */
    create(input: NotificationInput): Promise<TriliumNotification | null>;
    /**
     * With an ID, changes the current generation. With a notification, changes it only if its
     * `revision` is still the stored one, and resolves to `null` otherwise.
     */
    update(
        target: string | TriliumNotification, patch: NotificationPatch
    ): Promise<TriliumNotification | null>;
    /** With an ID, dismisses the current generation; with a ref, that generation only. */
    dismiss(target: string | NotificationRef): Promise<void>;
    getById(id: string): Promise<TriliumNotification | null>;
    /** Every notification with the tag, newest first. */
    getByTag(tag: string): Promise<TriliumNotification[]>;
}

/** The prefix of the IDs, handlers, tags and producers that only built-in producers use. */
export const BUILT_IN_NOTIFICATION_PREFIX = "trilium:";
/** The number of notifications in a page of `GET /api/notifications`. */
export const NOTIFICATION_PAGE_SIZE = 200;
/** The most refs that one request of the state or dismiss route takes. */
export const NOTIFICATION_MAX_REFS = 500;
/** An instance admits no new notification while it stores this many. */
export const NOTIFICATION_LIVE_LIMIT = 1000;
/** A script or a client raises nothing new while the instance stores this many. */
export const NOTIFICATION_LIVE_LIMIT_FOR_OTHERS = 800;

/** Why a generation is dismissed. A persistent notification is refused for `user`. */
export const NOTIFICATION_DISMISS_REASONS = [ "user", "handler", "force" ] as const;
export type NotificationDismissReason = typeof NOTIFICATION_DISMISS_REASONS[number];

/**
 * The errors of notification code. A message is never built from input or from a row: the code
 * is the whole message, and the client makes the sentence from it.
 */
export const NOTIFICATION_ERROR_CODES = [
    /** A field of a request has the wrong type, value, length or charset. */
    "invalid-input",
    /** An ID, handler or tag starts with `trilium:`, and the producer is not built in. */
    "reserved-name",
    /** `raisedAt` lies more than an hour ahead. */
    "raised-ahead",
    /** The content, or the private text written out as plain JSON, is over 8 KiB. */
    "too-large",
    /** The producer raised 30 in a minute, or the producers that are not built in 120. */
    "budget",
    /** A producer that is not built in raised 500 in a day. */
    "daily-budget",
    /** The instance stores its limit of live notifications. */
    "full",
    /** The category of the notification is turned off, so nothing is stored. */
    "category-off",
    /** The stored revision is not the expected one. */
    "stale-revision",
    /** The ID has no current generation. */
    "not-found",
    /** The database has not opened yet. */
    "not-initialized",
    /** A stored or synced row has the wrong type, value, length or charset, or other columns. */
    "invalid-row",
    /** The key of a row is not the one computed from its columns or named by its change. */
    "invalid-key",
    "invalid-content",
    /** A synced change of a row arrived without the row. */
    "missing-row",
    /** An erasure of a mark or a private text, which are deleted with their notification. */
    "erasure-refused",
    /** An error that is not one of the above, such as a failed write. */
    "internal"
] as const;
export type NotificationErrorCode = typeof NOTIFICATION_ERROR_CODES[number];

/** The body of every refusal of a notification route. */
export interface NotificationErrorBody {
    code: NotificationErrorCode;
}

/** The counts of the whole view, on the first page of `GET /api/notifications`. */
export interface NotificationCounts {
    total: number;
    pending: number;
    /** Pending and seen. */
    unread: number;
    /** The stored generations, which the limits of admission count. */
    live: number;
    /** The producers that have raised 500 in the last day, by their `producer` value. */
    dailyBudgetReached: string[];
}

/** `GET /api/notifications`: one page of the view, newest first. */
export interface NotificationListResponse {
    notifications: TriliumNotification[];
    /** The cursor of the next page, `?after=`; absent on the last page. */
    next?: string;
    /** The newest entity change that the page reflects. */
    changeId: number;
    /** On the first page only. */
    counts?: NotificationCounts;
}

/** `POST /api/notifications`. `null` when none is stored, for the reasons of a raise. */
export interface NotificationCreateResponse {
    notification: TriliumNotification | null;
}

/** `PATCH /api/notifications/:id`. */
export interface NotificationUpdateRequest {
    patch: NotificationPatch;
    /** The revision that the caller read. Another stored revision is refused with 409. */
    expected?: string;
}

/** `POST /api/notifications/state`. */
export interface NotificationStateRequest {
    refs: NotificationRef[];
    state: NotificationMarkState;
}

/** `POST /api/notifications/dismiss`. */
export interface NotificationDismissRequest {
    refs: NotificationRef[];
    reason: NotificationDismissReason;
}

export interface NotificationDismissResponse {
    /** The persistent notifications among the refs, which a dismissal by the user leaves. */
    refused: number;
}

/** Whether a `producer` value names a built-in producer. */
export function isBuiltInNotificationProducer(producer: string) {
    return producer.startsWith(BUILT_IN_NOTIFICATION_PREFIX);
}

/** The state of a generation from its marks: the higher of seen and read. */
export function getNotificationState(markKinds: Iterable<NotificationMarkKind>): NotificationState {
    let state: NotificationState = "pending";
    for (const kind of markKinds) {
        if (kind === "read") {
            return "read";
        }
        if (kind === "seen") {
            state = "seen";
        }
    }
    return state;
}
