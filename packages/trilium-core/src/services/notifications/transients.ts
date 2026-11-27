/**
 * @module
 *
 * The transient notifications of this backend: notifications of ongoing operations, which live in
 * memory and reach the clients of this backend only. A change goes out in a
 * `transient-notifications` message, at most one in 300 ms.
 */
import {
    type NotificationContent,
    TRANSIENT_NOTIFICATION_EXPIRY_MS,
    TRANSIENT_NOTIFICATION_LIMIT,
    TRANSIENT_NOTIFICATION_PRODUCER_LIMIT,
    type TransientNotification
} from "@triliumnext/commons";

import { randomString } from "../utils/index.js";
import {
    checkTransientInput,
    compactContent,
    formatUtcDateTime,
    isReservedName,
    isToken,
    makeTextPrivate,
    NotificationError,
    type PrivateText
} from "./model.js";
import type { NotificationTransport } from "./service.js";

/** At most one `transient-notifications` message goes out in this time. */
const BROADCAST_INTERVAL_MS = 300;
const TOKEN_LENGTH = 32;
const OWNER_TOKEN = new RegExp(`^[A-Za-z0-9]{${TOKEN_LENGTH}}$`);

/** Who holds a transient notification, as the service names it. */
export interface TransientProducer {
    /** The `producer` value: the name of a built-in producer, `script:<noteId>` or `client`. */
    name: string;
    /** What the limit per producer counts by: a client by its session. */
    key: string;
    isBuiltIn: boolean;
    /** Whether the notification ends a minute after its last change, as one of a client does. */
    expires: boolean;
}

export interface TransientDependencies {
    transport: NotificationTransport;
    /** Whether a note is protected, which makes a transient notification about it sensitive. */
    isNoteSensitive(noteId: string): boolean;
    /** Whether a protected session is open, while which the clients get the private text. */
    isProtectedSessionOpen(): boolean;
}

interface TransientEntry {
    id: string;
    token: string;
    producer: TransientProducer;
    createdAt: string;
    noteId: string | null;
    content: NotificationContent;
    privateText: PrivateText;
    isSensitive: boolean;
    expiresAtMs: number | null;
}

export default class TransientNotifications {

    private readonly entries = new Map<string, TransientEntry>();
    private readonly changedIds = new Set<string>();
    private readonly removedIds = new Set<string>();
    private seq = 0;
    private lastBroadcastMs = -Infinity;
    private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
    private expiryTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly dependencies: TransientDependencies) {}

    /**
     * Creates a transient notification, with the owner token that the caller chose or a new one,
     * or replaces one with its owner token. A replacement keeps the producer and the sensitivity
     * of the one that it replaces.
     *
     * @returns the owner token.
     * @throws NotificationError for input that fails a check, a missing or wrong token for an ID
     *         that exists, and a create beyond the limits.
     */
    put(id: unknown, input: unknown, producer: TransientProducer, token?: unknown): string {
        if (!isToken(id) || (token !== undefined && !isOwnerToken(token))) {
            throw new NotificationError("invalid-input");
        }
        if (!producer.isBuiltIn && isReservedName(id)) {
            throw new NotificationError("reserved-name");
        }
        const checked = checkTransientInput(input, producer.isBuiltIn);

        const nowMs = Date.now();
        this.sweep(nowMs);
        const existing = this.entries.get(id);
        if (existing && existing.token !== token) {
            throw new NotificationError("not-owner");
        }
        if (!existing) {
            this.checkLimits(producer);
        }

        const owner = existing?.producer ?? producer;
        const isSensitive = !!existing?.isSensitive || checked.isNamedSensitive
            || (checked.noteId !== null && this.dependencies.isNoteSensitive(checked.noteId));
        // Root text that comes without private text is not trusted for a sensitive one.
        const made = isSensitive && !checked.privateText
            ? makeTextPrivate(checked.content)
            : { content: checked.content, text: {} };
        const entry: TransientEntry = {
            id,
            token: existing?.token ?? token ?? randomString(TOKEN_LENGTH),
            producer: owner,
            createdAt: existing?.createdAt ?? formatUtcDateTime(nowMs),
            noteId: checked.noteId,
            content: made.content,
            privateText: checked.privateText ?? made.text,
            isSensitive,
            expiresAtMs: owner.expires ? nowMs + TRANSIENT_NOTIFICATION_EXPIRY_MS : null
        };
        this.entries.set(id, entry);
        this.markChanged(id);
        this.armExpiryTimer();
        return entry.token;
    }

    /**
     * Ends a transient notification. An ID that does not exist, or no longer does, ends nothing.
     *
     * @throws NotificationError for a missing or wrong token.
     */
    dismiss(id: unknown, token: unknown) {
        if (!isToken(id) || typeof token !== "string") {
            throw new NotificationError("invalid-input");
        }

        const entry = this.entries.get(id);
        if (!entry) {
            return;
        }
        if (entry.token !== token) {
            throw new NotificationError("not-owner");
        }
        this.remove(id);
        this.armExpiryTimer();
    }

    /** Makes the transient notifications about a note sensitive, with their text made private. */
    protectAbout(noteId: string) {
        for (const entry of [ ...this.entries.values() ]) {
            if (entry.noteId !== noteId || entry.isSensitive) {
                continue;
            }
            const made = makeTextPrivate(entry.content);
            this.entries.set(entry.id, {
                ...entry, content: made.content, privateText: made.text, isSensitive: true
            });
            this.markChanged(entry.id);
        }
    }

    /** The transient notifications as the clients get them, oldest first. */
    list(): TransientNotification[] {
        this.sweep(Date.now());
        const isSessionOpen = this.dependencies.isProtectedSessionOpen();
        return [ ...this.entries.values() ].map((entry) => toView(entry, isSessionOpen));
    }

    /** The counter of the last `transient-notifications` message. */
    getSeq() {
        return this.seq;
    }

    /** Ends every transient notification and stops the timers, without a message. */
    stop() {
        for (const timer of [ this.broadcastTimer, this.expiryTimer ]) {
            if (timer !== null) {
                clearTimeout(timer);
            }
        }
        this.broadcastTimer = this.expiryTimer = null;
        this.entries.clear();
        this.changedIds.clear();
        this.removedIds.clear();
    }

    /** @throws NotificationError `transient-limit` when the backend or the producer is full. */
    private checkLimits(producer: TransientProducer) {
        let ofProducer = 0;
        for (const entry of this.entries.values()) {
            if (entry.producer.key === producer.key) {
                ofProducer++;
            }
        }
        if (this.entries.size >= TRANSIENT_NOTIFICATION_LIMIT
            || ofProducer >= TRANSIENT_NOTIFICATION_PRODUCER_LIMIT) {
            throw new NotificationError("transient-limit");
        }
    }

    /** Ends the notifications of clients that were not updated for a minute. */
    private sweep(nowMs: number) {
        for (const entry of [ ...this.entries.values() ]) {
            if (entry.expiresAtMs !== null && entry.expiresAtMs <= nowMs) {
                this.remove(entry.id);
            }
        }
    }

    private remove(id: string) {
        this.entries.delete(id);
        this.changedIds.delete(id);
        this.removedIds.add(id);
        this.scheduleBroadcast();
    }

    private markChanged(id: string) {
        this.removedIds.delete(id);
        this.changedIds.add(id);
        this.scheduleBroadcast();
    }

    private scheduleBroadcast() {
        if (this.broadcastTimer !== null) {
            return;
        }

        const delayMs = Math.max(0, this.lastBroadcastMs + BROADCAST_INTERVAL_MS - Date.now());
        this.broadcastTimer = setTimeout(() => this.broadcast(), delayMs);
    }

    private broadcast() {
        this.broadcastTimer = null;
        if (this.changedIds.size === 0 && this.removedIds.size === 0) {
            return;
        }

        this.lastBroadcastMs = Date.now();
        this.seq++;
        const isSessionOpen = this.dependencies.isProtectedSessionOpen();
        const changed: TransientNotification[] = [];
        for (const id of this.changedIds) {
            const entry = this.entries.get(id);
            if (entry) {
                changed.push(toView(entry, isSessionOpen));
            }
        }
        const removed = [ ...this.removedIds ];
        this.changedIds.clear();
        this.removedIds.clear();
        this.dependencies.transport.send({
            type: "transient-notifications", seq: this.seq, changed, removed
        });
    }

    /** Arms the timer for the earliest end of a notification of a client. */
    private armExpiryTimer() {
        if (this.expiryTimer !== null) {
            clearTimeout(this.expiryTimer);
            this.expiryTimer = null;
        }

        let earliestMs = Infinity;
        for (const { expiresAtMs } of this.entries.values()) {
            if (expiresAtMs !== null) {
                earliestMs = Math.min(earliestMs, expiresAtMs);
            }
        }
        if (earliestMs === Infinity) {
            return;
        }
        this.expiryTimer = setTimeout(() => {
            this.expiryTimer = null;
            this.sweep(Date.now());
            this.armExpiryTimer();
        }, Math.max(0, earliestMs - Date.now()));
    }

}

function isOwnerToken(value: unknown): value is string {
    return typeof value === "string" && OWNER_TOKEN.test(value);
}

/** A transient notification as the clients get it, its private text in a protected session. */
function toView(entry: TransientEntry, isSessionOpen: boolean): TransientNotification {
    const { v: _version, ...fields } = compactContent(entry.content);
    const view: TransientNotification = {
        id: entry.id,
        type: "transient",
        producer: entry.producer.name,
        createdAt: entry.createdAt,
        ...fields
    };
    if (entry.noteId !== null) {
        view.noteId = entry.noteId;
    }
    if (entry.isSensitive) {
        view.sensitive = true;
        if (isSessionOpen && entry.privateText.title) {
            view.protectedTitle = entry.privateText.title;
        }
        if (isSessionOpen && entry.privateText.description) {
            view.protectedDescription = entry.privateText.description;
        }
    }
    return view;
}
