/**
 * @module
 *
 * The channels that forward notifications: what a channel receives, the settings and states of a
 * channel, the codes of a delivery, and the bodies of the channel routes, shared by the backend
 * and the client.
 */
import type { NotificationAttentionLevel, NotificationCategory } from "./notifications.js";

/** The label that makes a note a script channel, as an owned label of the note. */
export const NOTIFICATION_CHANNEL_LABEL = "notificationChannel";
/** The owned relation of a channel note to the note of its settings widget. */
export const NOTIFICATION_CHANNEL_WIDGET_RELATION = "configWidget";

/** Where a channel runs: in the backend of the forwarding instance, or in a tab of every device. */
export type NotificationChannelRunsOn = "backend" | "frontend";

/** What a channel does with a notification about a protected note. `none` is the stricter. */
export const NOTIFICATION_PROTECTED_NOTES_SETTINGS = [ "none", "public" ] as const;
export type NotificationProtectedNotesSetting =
    typeof NOTIFICATION_PROTECTED_NOTES_SETTINGS[number];

/** The longest grace time of a channel, in seconds. */
export const NOTIFICATION_GRACE_TIME_MAX_SECONDS = 12 * 60 * 60;

/** The settings of a channel, which its enabling confirms and its settings records change. */
export interface NotificationChannelSettings {
    /** In seconds. Zero forwards at once, also what was seen or read. */
    graceTime: number;
    protectedNotes: NotificationProtectedNotesSetting;
}

/** The settings that the enable dialog offers first: five minutes, nothing of protected notes. */
export const DEFAULT_NOTIFICATION_CHANNEL_SETTINGS: NotificationChannelSettings = {
    graceTime: 5 * 60,
    protectedNotes: "none"
};

/** What a channel receives: an allowlist, built before each attempt. */
export interface NotificationChannelPayload {
    /** The delivery key, the same for every attempt of one delivery. */
    key: string;
    /** The note's title for a notification without one. For a sensitive one, its public title. */
    title: string;
    /** For a sensitive notification, its public description. */
    description?: string;
    category: NotificationCategory;
    attentionLevel: NotificationAttentionLevel;
    raisedAt: string;
    /** Absent for a sensitive notification. */
    noteId?: string;
}

/** One attempt to hand a notification to a channel, as `api.delivery` gives it to a script. */
export interface NotificationChannelDelivery {
    /** The same for every attempt of one delivery. */
    key: string;
    /** 1 for the first attempt. */
    attempt: number;
    /**
     * Aborts when the attempt times out. A script passes it to what it waits for: its channel
     * takes no other attempt until its promise settles.
     */
    signal: AbortSignal;
}

/** The placeholders of a webhook's body template, each `{{name}}` inside a string value. */
export const NOTIFICATION_TEMPLATE_FIELDS = [
    "title", "description", "category", "attentionLevel", "raisedAt", "key", "noteId"
] as const;
export type NotificationTemplateField = typeof NOTIFICATION_TEMPLATE_FIELDS[number];

/** Why an attempt failed. No exception message is ever recorded, only one of these. */
export const NOTIFICATION_DELIVERY_ERROR_CODES = [
    "timeout", "refused-destination", "redirect", "http", "network", "script-error", "policy",
    "record", "secret"
] as const;
export type NotificationDeliveryErrorCode = typeof NOTIFICATION_DELIVERY_ERROR_CODES[number];

/** Why a delivery ended without being sent. */
export const NOTIFICATION_DELIVERY_SKIP_REASONS = [
    /** The generation was seen or read before its grace time passed. */
    "marked",
    /** The generation was erased: dismissed, replaced, or with its note. */
    "erased",
    /** The channel was disabled or deleted, or its activation is not the live one. */
    "disabled",
    /** What the channel runs changed since the delivery was written. */
    "changed",
    /** The webhook was given another address. */
    "address",
    /** The webhook's body template is not the one that its credentials were entered for. */
    "template",
    /** The notification is about a protected note, and the channel sends nothing about such. */
    "protected",
    /** No client of the backend was connected to run a frontend channel. */
    "no-client",
    /** The user chose to skip what was due when forwarding resumed. */
    "resume"
] as const;
export type NotificationDeliverySkipReason = typeof NOTIFICATION_DELIVERY_SKIP_REASONS[number];

export type NotificationDeliveryStatus = "waiting" | "sent" | "skipped" | "failed" | "expired";

/** The delivery counts of a channel. */
export interface NotificationDeliveryCounts {
    sent: number;
    /** Sent with the public text alone. */
    sentPublic: number;
    skipped: number;
    failed: number;
    expired: number;
    /** Waiting for a free place of the channel's budget. */
    waitingForBudget: number;
}

/** The `status` record of a channel, which the forwarding instance writes after each delivery. */
export interface NotificationChannelStatus {
    lastInvokedAt?: string;
    lastCompletedAt?: string;
    durationMs?: number;
    lastErrorCode?: NotificationDeliveryErrorCode;
    /** The HTTP status of the last `http` failure. */
    lastHttpStatus?: number;
    /** Since when a send has run that has not settled, for a script that ignores its signal. */
    runningSince?: string;
    counts: NotificationDeliveryCounts;
    /** Whether the forwarding instance runs backend scripts. */
    runsBackendScripts: boolean;
    /** Whether the delivery record of the forwarding instance holds the channel's activation. */
    recordHoldsActivation: boolean;
    /** The highest sequence that the delivery record of the forwarding instance saw. */
    recordSequence: number;
    /** When the webhook's address was last changed, as the forwarding instance read it. */
    addressChangedAt?: string;
}

/** What the synced records say of a channel. */
export type NotificationChannelState = "found" | "enabled" | "changed";

/**
 * What the delivery record of this instance holds of an enabled channel: its activation as the
 * live one; a switching that failed to write and waits; an activation that the database holds and
 * the record lacks; or no room, since 1,000 channels hold a live activation.
 */
export type NotificationChannelRecordHold = "live" | "pending" | "missing" | "full";

/** Why forwarding waits on this instance until the user confirms. */
export const NOTIFICATION_PAUSE_CAUSES = [ "restore", "move", "rollback" ] as const;
export type NotificationPauseCause = typeof NOTIFICATION_PAUSE_CAUSES[number];

/** Why the channels of this instance run nothing. */
export type NotificationChannelsOff = "sync-disabled" | "safe-mode" | "configuration";

/** The forwarding of this instance, at the top of the channels card. */
export interface NotificationForwardingState {
    /** Whether this instance has no sync server, so it runs the backend channels. */
    isForwardingInstance: boolean;
    /** Why no channel runs here, or `null`. */
    off: NotificationChannelsOff | null;
    pause: { causes: NotificationPauseCause[]; since: string } | null;
    /** Whether the delivery record can be read. While it cannot, nothing is delivered. */
    isRecordReadable: boolean;
    /** The name of the delivery record, for the user to find it. */
    recordName: string;
    runsBackendScripts: boolean;
}

/** A built-in kind of channel, as the settings page offers it. */
export interface NotificationChannelTypeView {
    type: string;
    title: string;
    icon: string;
    /** False where the runtime cannot run it under its policy: webhooks need a sync server. */
    isAvailable: boolean;
}

/** The part of a built-in channel's configuration that is not secret, which syncs. */
export interface NotificationChannelConfig {
    /** A webhook's body template, JSON with placeholders inside string values. */
    template?: string;
}

/** A channel as `GET /api/notification-channels` lists it, without any part of an address. */
export interface NotificationChannelView {
    channelId: string;
    kind: "script" | "built-in";
    /** The type of a built-in channel. */
    type?: string;
    title: string;
    icon: string;
    runsOn: NotificationChannelRunsOn;
    state: NotificationChannelState;
    /** The current activation, for the `expected` of a change of the settings. */
    activationId?: string;
    /** The settings that hold, resolved from the activation and its settings records. */
    settings: NotificationChannelSettings;
    /** The settings records that hold, for the `expected` of a change of the settings. */
    settingsRecordIds: string[];
    /** What this instance's delivery record holds of an enabled channel. */
    recordHold?: NotificationChannelRecordHold;
    /** The synced status that the forwarding instance wrote. */
    status?: NotificationChannelStatus;
    /** What this instance delivered of a frontend channel. */
    localCounts?: NotificationDeliveryCounts;
    /** Whether a note of its bundle has content that is not available. */
    isNotRunnable?: boolean;
    /** Whether its script has a `~configWidget`. */
    hasConfigWidget?: boolean;
    config?: NotificationChannelConfig;
    /** Whether the forwarding instance has an address for the webhook. */
    isAddressSet?: boolean;
    /**
     * On the forwarding instance: whether the body template is the one that the webhook's
     * credentials were entered for.
     */
    isTemplateBound?: boolean;
}

/** `GET /api/notification-channels`. */
export interface NotificationChannelListResponse {
    channels: NotificationChannelView[];
    forwarding: NotificationForwardingState;
    types: NotificationChannelTypeView[];
}

/** An owned attribute of a channel note that was added, changed or removed since its enabling. */
export interface NotificationChannelAttributeChange {
    change: "added" | "changed" | "removed";
    type: "label" | "relation";
    name: string;
    value?: string;
    previousValue?: string;
}

/** `GET /api/notification-channels/:channelId/review`: what an enabling would run. */
export interface NotificationChannelReview {
    revision: string;
    runsOn: NotificationChannelRunsOn;
    /**
     * Every note of the bundle with its attributes and content, as text, with invisible and
     * bidirectional control characters written as `[U+XXXX]`. Shown as text, never rendered.
     */
    text: string;
    /** Present when only the channel note's own attributes changed since its enabling. */
    changes?: NotificationChannelAttributeChange[];
    isRunnable: boolean;
    /** Whether the forwarding instance runs backend scripts, as its status says; `null` unknown. */
    forwardingRunsBackendScripts: boolean | null;
    hasConfigWidget: boolean;
}

/** `POST /api/notification-channels/:channelId/enable`. */
export interface NotificationChannelEnableRequest extends NotificationChannelSettings {
    /** The revision that the user reviewed. Another one is refused with 409. */
    revision: string;
    /** The settings that a script's widget collected, written as owned labels of its note. */
    labels?: Record<string, string>;
}

/** The answer of an enabling or a disabling: what this instance's delivery record holds now. */
export interface NotificationChannelSwitchResponse {
    channel: NotificationChannelView;
    /** Whether the delivery record holds the switching, so that a restore cannot take it back. */
    isRecorded: boolean;
}

/** `PATCH /api/notification-channels/:channelId/settings`. */
export interface NotificationChannelSettingsRequest extends Partial<NotificationChannelSettings> {
    /** The activation and the settings records that the change read. */
    expected: { activationId: string; recordIds: string[] };
}

/**
 * The answer of a route that changes one channel: the creation or the edit of a built-in channel,
 * and a change of the settings.
 */
export interface NotificationChannelResponse {
    channel: NotificationChannelView;
}

/** `POST /api/notification-channels`: a built-in channel. */
export interface NotificationChannelCreateRequest {
    type: string;
    title: string;
    config?: NotificationChannelConfig;
}

/** `PATCH /api/notification-channels/:channelId`: a built-in channel. */
export interface NotificationChannelEditRequest {
    title?: string;
    config?: NotificationChannelConfig;
}

/** The bundle of a script, as the client runs it. */
export interface NotificationChannelBundle {
    script: string;
    html: string;
    noteId: string;
    allNoteIds: string[];
}

/** `GET /api/notification-channels/:channelId/config-widget?revision=`. */
export interface NotificationChannelConfigWidgetResponse {
    bundle: NotificationChannelBundle;
}

/** `POST /api/notification-channels/:channelId/test`. Always answers with status 200. */
export interface NotificationChannelTestResponse {
    code: "sent" | NotificationDeliveryErrorCode | NotificationDeliverySkipReason;
    /** The message of a script's error, rendered as text. */
    diagnostic?: string;
}

/** `POST /api/notification-channels/resume`: ends the pause of forwarding. */
export interface NotificationForwardingResumeRequest {
    /** Whether what is still due is sent, or skipped. */
    sendDue: boolean;
}

/** `POST /api/notification-channels/deliveries/claim`: a tab asks to run a frontend channel. */
export interface NotificationDeliveryClaimRequest {
    deliveryKey: string;
    profileId: string;
}

export interface NotificationDeliveryClaimResponse {
    granted: boolean;
    bundle?: NotificationChannelBundle;
    payload?: NotificationChannelPayload;
    attempt?: number;
    /** The owned labels of the channel note, as its activation holds them. */
    channelSettings?: Record<string, string>;
}

/** `POST /api/notification-channels/deliveries/result`: the outcome of a granted run. */
export interface NotificationDeliveryResultRequest {
    deliveryKey: string;
    profileId: string;
    durationMs: number;
    errorCode?: NotificationDeliveryErrorCode;
}

/**
 * Where a webhook's receiver can be, beside public addresses, for the host of its URL only:
 * private networks (RFC 1918, unique-local and carrier-grade NAT), and this machine (loopback).
 * Plain HTTP goes only to an address in one of the ranges allowed.
 */
export interface NotificationWebhookNetwork {
    allowPrivate: boolean;
    allowLoopback: boolean;
}

/** `GET /api/notification-channels/:channelId/secret`: names of what is set, never a value. */
export interface NotificationChannelSecretView {
    isSet: boolean;
    /** The version that a change names. */
    version: number;
    /** The name that the user gave the address, all that a page shows of it. */
    label?: string;
    /** The names of the headers that are set. */
    headers: string[];
    /** The names of the secret values that are set. */
    values: string[];
    hasSigningSecret: boolean;
    network: NotificationWebhookNetwork;
    /** When the address was last changed. */
    changedAt?: string;
    /** The SHA-256 of the template that the credentials were entered for, in hex. */
    templateHash: string;
    /** Whether the host lets a webhook reach the local network. */
    isNetworkAllowed: boolean;
}

/**
 * `PUT /api/notification-channels/:channelId/secret`, with the password and the code in the
 * `trilium-cred` and `trilium-totp` headers. With `url` it replaces the whole entry; without,
 * it changes what it carries, a header or a value by its name, `null` removing it.
 */
export interface NotificationChannelSecretPutRequest {
    url?: string;
    headers?: Record<string, string | null>;
    network?: NotificationWebhookNetwork;
    signingSecret?: string | null;
    values?: Record<string, string | null>;
    label?: string;
    /**
     * The body template that the credentials go with, as the dialog shows it, or `""` for the
     * default body. The route stores its SHA-256, never the text.
     */
    template?: string;
    /** The version that the page read. Another one is refused with 409. */
    expected: number;
}

/** `DELETE /api/notification-channels/:channelId/secret`. */
export interface NotificationChannelSecretDeleteRequest {
    expected: number;
}

/** The most labels that an enabling writes, and the size of each value. */
export const NOTIFICATION_CHANNEL_MAX_LABELS = 20;
export const NOTIFICATION_CHANNEL_LABEL_MAX_BYTES = 1024;
/** The headers that a webhook can add, the size of each, and the secret values alike. */
export const WEBHOOK_MAX_HEADERS = 10;
export const WEBHOOK_MAX_VALUES = 10;
export const WEBHOOK_SECRET_MAX_BYTES = 4 * 1024;
export const WEBHOOK_TEMPLATE_MAX_BYTES = 16 * 1024;
/** The browser profiles that a backend grants one frontend delivery to, at most. */
export const NOTIFICATION_FRONTEND_MAX_PROFILES = 16;
/** No attempt is made for a generation older than this. */
export const NOTIFICATION_DELIVERY_DEADLINE_MS = 23 * 60 * 60 * 1000;
