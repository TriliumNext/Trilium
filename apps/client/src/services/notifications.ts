/**
 * @module
 *
 * The notifications of this backend, as the bell and the panel show them: a signal store that loads
 * the view of `GET /api/notifications` in pages and follows the entity changes that
 * `froca_updater.ts` passes to it. It implements `NotificationApi` for frontend code.
 */
import { computed, signal } from "@preact/signals";
import type {
    NotificationApi, NotificationCounts, NotificationCreateResponse,
    NotificationDismissReason, NotificationErrorCode, NotificationInput, NotificationListResponse,
    NotificationMarkKind, NotificationMarkRow, NotificationMarkState, NotificationPatch,
    NotificationPrivateTextUpdate, NotificationRef, NotificationState, TriliumNotification
} from "@triliumnext/commons";
import {
    NOTIFICATION_ERROR_CODES, NOTIFICATION_PAGE_SIZE
} from "@triliumnext/commons/src/lib/notifications.js";

import type { EntityChange } from "../server_types.js";
import options from "./options.js";
import server from "./server.js";
import ws, { logError, subscribeToMessages, subscribeToReconnect } from "./ws.js";

/** Seen and read marks wait this long, so that the marks of one look go in one request. */
const STATE_FLUSH_DELAY_MS = 500;
const STATE_RANK: Record<NotificationState, number> = { pending: 0, seen: 1, read: 2 };

/** A refusal of a notification route, by its code. */
export class NotificationRequestError extends Error {

    constructor(readonly code: NotificationErrorCode) {
        super(code);
        this.name = "NotificationRequestError";
    }

}

export class NotificationStore implements NotificationApi {

    /** The notifications of the view, newest first. */
    readonly notifications = signal<readonly TriliumNotification[]>([]);
    /** The counts of the whole view, from the first page of the last load. */
    readonly counts = signal<NotificationCounts | null>(null);
    /** Whether a load has finished, after which the store has the whole view. */
    readonly isLoaded = signal(false);
    /** The pending notifications: from the counts of the first page until the load finishes. */
    readonly pendingCount = computed(() => (this.isLoaded.value
        ? this.countNotifications((state) => state === "pending")
        : this.counts.value?.pending ?? 0));
    /** The pending and the seen notifications, counted as {@link pendingCount} is. */
    readonly unreadCount = computed(() => (this.isLoaded.value
        ? this.countNotifications((state) => state !== "read")
        : this.counts.value?.unread ?? 0));

    private view = new NotificationView();
    private load: ActiveLoad | null = null;
    private loadPromise: Promise<void> | null = null;
    private isStarted = false;
    private readonly queuedStates = new Map<NotificationMarkState, Map<string, NotificationRef>>([
        [ "seen", new Map() ],
        [ "read", new Map() ]
    ]);
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly waiters = new Map<string, Set<(notification: TriliumNotification) => void>>();

    /** Subscribes to the messages of the backend and loads the view. */
    start() {
        if (this.isStarted) {
            return;
        }

        this.isStarted = true;
        subscribeToMessages((message) => {
            if (message.type === "notification-alert") {
                this.onAlert(message.notificationId);
            } else if (message.type === "notifications-due"
                || message.type === "protectedSessionLogin") {
                void this.reload();
            }
        });
        subscribeToReconnect(() => void this.reload());
        void this.reload();
    }

    /** Applies the changes of the four tables of notifications that a `frontend-update` brought. */
    applyEntityChanges(changes: EntityChange[]) {
        if (!this.isStarted || changes.length === 0) {
            return;
        }

        for (const change of changes) {
            this.view.applyChange(change);
            if (this.load) {
                if (this.load.next !== this.view) {
                    this.load.next.applyChange(change);
                }
                this.load.changes.push(change);
            }
        }
        this.publish();
    }

    /** Loads the view again, in pages. The view shown so far stays until the last page is in. */
    reload() {
        const promise = this.runLoad().finally(() => {
            if (this.loadPromise === promise) {
                this.loadPromise = null;
            }
        });
        this.loadPromise = promise;
        return promise;
    }

    /** Resolves once the store has the whole view, and starts a load if none has finished. */
    async whenLoaded() {
        if (!this.isLoaded.value && !this.loadPromise) {
            void this.reload();
        }
        while (this.loadPromise) {
            await this.loadPromise;
        }
    }

    /** Resolves to the notification once the store has it, or to `null` after `timeoutMs`. */
    waitFor(notificationId: string, timeoutMs: number): Promise<TriliumNotification | null> {
        const held = this.view.get(notificationId);
        if (held) {
            return Promise.resolve(held);
        }

        return new Promise((resolve) => {
            const waiters = this.waiters.get(notificationId) ?? new Set();
            const waiter = (notification: TriliumNotification | null) => {
                clearTimeout(timer);
                waiters.delete(waiter);
                if (waiters.size === 0) {
                    this.waiters.delete(notificationId);
                }
                resolve(notification);
            };
            const timer = setTimeout(() => waiter(null), timeoutMs);
            waiters.add(waiter);
            this.waiters.set(notificationId, waiters);
        });
    }

    markSeen(notifications: Iterable<TriliumNotification>) {
        this.queueState(notifications, "seen");
    }

    markRead(notifications: Iterable<TriliumNotification>) {
        this.queueState(notifications, "read");
    }

    /** Marks every notification of the store as read, once the store has the whole view. */
    async markAllAsRead() {
        await this.whenLoaded();
        this.markRead(this.notifications.value);
        await this.flushStates();
    }

    /**
     * Dismisses every standard notification of the store, once the store has the whole view.
     * Persistent ones stay: only their handler or "Dismiss anyway" closes them.
     */
    async clearAll() {
        await this.whenLoaded();
        const cleared = this.notifications.value.filter(({ type }) => type === "standard");
        if (cleared.length === 0) {
            return;
        }

        for (const { notificationId } of cleared) {
            this.view.delete(notificationId);
            this.load?.next.delete(notificationId);
        }
        this.publish();
        try {
            await this.sendDismissal(cleared.map(toRef), "user");
        } catch (e) {
            reportFailure("dismiss", e);
        }
        // Loads the counts of the first page again: the number of live notifications changed.
        await this.reload();
    }

    async create(input: NotificationInput) {
        const request = () => server.postWithSilentErrors<NotificationCreateResponse>(
            "notifications", input);
        const response = await this.send(request, [ "category-off" ]);
        return response?.notification ?? null;
    }

    async update(target: string | TriliumNotification, patch: NotificationPatch) {
        const id = typeof target === "string" ? target : target.id;
        const expected = typeof target === "string" ? undefined : target.revision;
        const request = () => server.patch<NotificationCreateResponse>(
            `notifications/${encodeURIComponent(id)}`, { patch, expected }, undefined,
            { silentBadRequest: true, silentNotFound: true, silentConflict: true });
        const response = await this.send(request, [ "stale-revision", "not-found" ]);
        return response?.notification ?? null;
    }

    async dismiss(target: string | NotificationRef) {
        let ref: NotificationRef | undefined;
        if (typeof target === "string") {
            await this.whenLoaded();
            const current = this.view.getCurrent(target);
            ref = current && toRef(current);
        } else {
            ref = target;
        }

        if (ref) {
            const refs = [ ref ];
            await this.send(() => this.sendDismissal(refs, "handler"));
        }
    }

    async getById(id: string) {
        await this.whenLoaded();
        return this.view.getCurrent(id) ?? null;
    }

    async getByTag(tag: string) {
        await this.whenLoaded();
        return this.notifications.value.filter((notification) => notification.tag === tag);
    }

    /** Sends the queued seen and read marks now. */
    async flushStates() {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        let isFailed = false;
        for (const [ state, queued ] of this.queuedStates) {
            const refs = [ ...queued.values() ];
            queued.clear();
            for (let start = 0; start < refs.length; start += NOTIFICATION_PAGE_SIZE) {
                const page = refs.slice(start, start + NOTIFICATION_PAGE_SIZE);
                try {
                    await server.postWithSilentErrors("notifications/state", { refs: page, state });
                } catch (e) {
                    reportFailure("state", e);
                    isFailed = true;
                }
            }
        }
        // The view shows the marks before the backend stores them, so a failure loads it again.
        if (isFailed) {
            await this.reload();
        }
    }

    private async runLoad() {
        const load: ActiveLoad = { next: new NotificationView(), changes: [] };
        this.load = load;
        // The first load shows each page as it comes; a later one swaps the view when it is done.
        const isProgressive = !this.isLoaded.value;
        let counts: NotificationCounts | null = null;
        let after: string | undefined;
        try {
            do {
                const page = await server.getWithSilentErrors<NotificationListResponse>(
                    after ? `notifications?after=${encodeURIComponent(after)}` : "notifications");
                if (this.load !== load) {
                    return;
                }

                mergePage(load, page);
                counts ??= page.counts ?? null;
                if (isProgressive) {
                    this.view = load.next;
                    this.counts.value = counts;
                    this.publish();
                }
                after = page.next;
            } while (after);

            this.view = load.next;
            this.counts.value = counts;
            this.isLoaded.value = true;
            this.publish();
        } catch (e) {
            if (this.load === load) {
                reportFailure("load", e);
            }
        } finally {
            if (this.load === load) {
                this.load = null;
            }
        }
    }

    private queueState(notifications: Iterable<TriliumNotification>, state: NotificationMarkState) {
        let isQueued = false;
        for (const notification of notifications) {
            if (STATE_RANK[notification.state] >= STATE_RANK[state]) {
                continue;
            }

            // The view shows the mark at once, and its entity change confirms it later.
            this.view.applyMark(notification.notificationId, state);
            this.load?.next.applyMark(notification.notificationId, state);
            this.queuedStates.get(state)?.set(notification.notificationId, toRef(notification));
            if (state === "read") {
                this.queuedStates.get("seen")?.delete(notification.notificationId);
            }
            isQueued = true;
        }

        if (isQueued) {
            this.publish();
            this.flushTimer ??= setTimeout(() => void this.flushStates(), STATE_FLUSH_DELAY_MS);
        }
    }

    private async sendDismissal(refs: NotificationRef[], reason: NotificationDismissReason) {
        for (let start = 0; start < refs.length; start += NOTIFICATION_PAGE_SIZE) {
            await server.postWithSilentErrors("notifications/dismiss", {
                refs: refs.slice(start, start + NOTIFICATION_PAGE_SIZE), reason
            });
        }
    }

    /**
     * Sends a request and waits until its entity changes have reached the store. A refusal throws a
     * {@link NotificationRequestError}, or returns `null` for one of `nullCodes`.
     */
    private async send<T>(
        request: () => Promise<T>,
        nullCodes: NotificationErrorCode[] = []
    ): Promise<T | null> {
        try {
            const result = await request();
            await ws.waitForMaxKnownEntityChangeId();
            return result;
        } catch (e) {
            const code = getErrorCode(e);
            if (nullCodes.includes(code)) {
                return null;
            }
            throw new NotificationRequestError(code);
        }
    }

    private onAlert(notificationId: string) {
        if (options.is("notificationsSilent")) {
            return;
        }

        import("./notification_alerts.js")
            .then(({ showAlert }) => showAlert(notificationId))
            .catch((e: unknown) => reportFailure("alert", e));
    }

    private publish() {
        this.notifications.value = this.view.toArray();
        for (const [ notificationId, waiters ] of this.waiters) {
            const notification = this.view.get(notificationId);
            if (notification) {
                for (const waiter of [ ...waiters ]) {
                    waiter(notification);
                }
            }
        }
    }

    private countNotifications(isCounted: (state: NotificationState) => boolean) {
        return this.notifications.value.filter(({ state }) => isCounted(state)).length;
    }

}

/**
 * The notifications that a client shows, by the rules of the backend's view: of each ID the newest
 * generation, which the entity changes replace, mark and erase. Every change makes a new object, so
 * a component can compare a notification by reference.
 */
export class NotificationView {

    private readonly byNotificationId = new Map<string, TriliumNotification>();
    /** The `notificationId` of the generation shown for each ID. */
    private readonly currentById = new Map<string, string>();

    get(notificationId: string) {
        return this.byNotificationId.get(notificationId);
    }

    /** The generation shown for an ID. */
    getCurrent(id: string) {
        const notificationId = this.currentById.get(id);
        return notificationId === undefined ? undefined : this.byNotificationId.get(notificationId);
    }

    /** Adds or replaces a generation, unless the view has a newer one of its ID. */
    put(notification: TriliumNotification) {
        const currentId = this.currentById.get(notification.id);
        const current = currentId === undefined ? undefined : this.byNotificationId.get(currentId);
        if (current && current.notificationId !== notification.notificationId) {
            if (isNewerGeneration(current, notification)) {
                return;
            }
            this.byNotificationId.delete(current.notificationId);
        }

        this.byNotificationId.set(notification.notificationId, notification);
        this.currentById.set(notification.id, notification.notificationId);
    }

    delete(notificationId: string) {
        const notification = this.byNotificationId.get(notificationId);
        if (!notification) {
            return;
        }

        this.byNotificationId.delete(notificationId);
        if (this.currentById.get(notification.id) === notificationId) {
            this.currentById.delete(notification.id);
        }
    }

    /** Raises the state of a generation, or makes it sensitive, which drops its public text. */
    applyMark(notificationId: string, kind: NotificationMarkKind) {
        const notification = this.byNotificationId.get(notificationId);
        if (!notification) {
            return;
        }

        if (kind === "sensitive") {
            if (!notification.sensitive) {
                this.byNotificationId.set(notificationId, withoutPublicText(notification));
            }
        } else if (STATE_RANK[kind] > STATE_RANK[notification.state]) {
            this.byNotificationId.set(notificationId, { ...notification, state: kind });
        }
    }

    applyPrivateText(update: NotificationPrivateTextUpdate) {
        const notification = this.byNotificationId.get(update.notificationId);
        if (!notification) {
            return;
        }

        const { protectedTitle: _title, protectedDescription: _text, ...rest } = notification;
        const updated: TriliumNotification = { ...rest, revision: update.revision };
        if (update.protectedTitle !== undefined) {
            updated.protectedTitle = update.protectedTitle;
        }
        if (update.protectedDescription !== undefined) {
            updated.protectedDescription = update.protectedDescription;
        }
        this.byNotificationId.set(update.notificationId, updated);
    }

    /**
     * Applies a change of the four tables. A change of a notification without its row is one that
     * the backend's view does not show, or an erasure.
     */
    applyChange(change: EntityChange) {
        if (change.entityName === "notifications") {
            if (change.isErased || !change.entity) {
                this.delete(change.entityId);
            } else {
                this.put(change.entity as unknown as TriliumNotification);
            }
        } else if (change.entityName === "notification_marks" && change.entity) {
            const mark = change.entity as unknown as NotificationMarkRow;
            this.applyMark(mark.notificationId, mark.kind);
        } else if (change.entityName === "notification_private_texts" && change.entity) {
            this.applyPrivateText(change.entity as unknown as NotificationPrivateTextUpdate);
        }
    }

    /** The notifications, newest first. */
    toArray() {
        return [ ...this.byNotificationId.values() ].sort(compareNewestFirst);
    }

}

/** What a load builds: the next view, and the changes that arrived since it started. */
interface ActiveLoad {
    readonly next: NotificationView;
    readonly changes: EntityChange[];
}

/**
 * Adds a page to the view that a load builds. A change that arrived since the load started and is
 * newer than the page is applied to the page's notifications first, so a page that arrives late
 * brings nothing back that a change took away.
 */
function mergePage(load: ActiveLoad, page: NotificationListResponse) {
    const pageView = new NotificationView();
    for (const notification of page.notifications) {
        pageView.put(notification);
    }
    for (const change of load.changes) {
        if ((change.id ?? Infinity) > page.changeId) {
            pageView.applyChange(change);
        }
    }
    for (const notification of pageView.toArray()) {
        load.next.put(notification);
    }
}

/**
 * Sorts newest first, as the backend's view does: by `raisedAt`, whose dates sort as their text
 * does, then by `notificationId`.
 */
function compareNewestFirst(a: TriliumNotification, b: TriliumNotification) {
    if (a.raisedAt !== b.raisedAt) {
        return a.raisedAt > b.raisedAt ? -1 : 1;
    }
    if (a.notificationId !== b.notificationId) {
        return a.notificationId > b.notificationId ? -1 : 1;
    }
    return 0;
}

/** Whether `a` was raised after `b`. */
function isNewerGeneration(a: TriliumNotification, b: TriliumNotification) {
    return compareNewestFirst(a, b) < 0;
}

/** A notification as the backend's view gives it once it is sensitive and its row unflagged. */
function withoutPublicText(notification: TriliumNotification): TriliumNotification {
    const { title: _title, description: _text, progressLabel: _label, ...rest } = notification;
    const hidden: TriliumNotification = { ...rest, sensitive: true };
    if (notification.link) {
        hidden.link = notification.link.split("?")[0];
    }
    if (notification.actions) {
        hidden.actions = notification.actions.map(({ id, icon }) =>
            (icon === undefined ? { id, caption: "" } : { id, caption: "", icon }));
    }
    return hidden;
}

function toRef({ id, raisedAt }: TriliumNotification): NotificationRef {
    return { id, raisedAt };
}

/** The code of a refused request: the body of every refusal of a notification route is its code. */
function getErrorCode(error: unknown): NotificationErrorCode {
    let body: unknown = error;
    if (typeof error === "string") {
        try {
            body = JSON.parse(error);
        } catch {
            return "internal";
        }
    }

    const code = (body as { code?: unknown } | null)?.code;
    return (NOTIFICATION_ERROR_CODES as readonly unknown[]).includes(code)
        ? code as NotificationErrorCode
        : "internal";
}

/** Logs a failure by a fixed text and its code: nothing of a row reaches the log. */
function reportFailure(task: string, error: unknown) {
    logError(`A notification request failed: ${task}, ${getErrorCode(error)}.`);
}

const notificationStore = new NotificationStore();
export default notificationStore;
