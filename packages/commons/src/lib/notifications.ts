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
