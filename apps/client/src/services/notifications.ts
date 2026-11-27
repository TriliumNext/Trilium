/**
 * @module
 *
 * The notifications of this backend, as the bell and the panel show them: a signal store that loads
 * the view of `GET /api/notifications` in pages and follows the entity changes that
 * `froca_updater.ts` passes to it. It implements `NotificationApi` for frontend code.
 */
import { computed, signal } from "@preact/signals";
import type {
    NotificationAction, NotificationActionHandler, NotificationApi, NotificationCounts,
    NotificationCreateResponse, NotificationDismissReason, NotificationErrorCode,
    NotificationInput, NotificationListResponse, NotificationMarkKind, NotificationMarkRow,
    NotificationMarkState, NotificationPatch, NotificationPrivateTextUpdate, NotificationRef,
    NotificationState, TransientNotification, TransientNotificationHandle,
    TransientNotificationInput, TransientNotificationPutRequest, TriliumNotification,
    WebSocketMessage
} from "@triliumnext/commons";
import {
    NOTIFICATION_ERROR_CODES, NOTIFICATION_PAGE_SIZE, TRANSIENT_NOTIFICATION_REFRESH_MS
} from "@triliumnext/commons/src/lib/notifications.js";

import type { EntityChange } from "../server_types.js";
import options from "./options.js";
import server from "./server.js";
import { randomSecret, randomString } from "./utils.js";
import ws, { logError, subscribeToMessages, subscribeToReconnect } from "./ws.js";

/** Seen and read marks wait this long, so that the marks of one look go in one request. */
const STATE_FLUSH_DELAY_MS = 500;
const STATE_RANK: Record<NotificationState, number> = { pending: 0, seen: 1, read: 2 };
/** The transient messages held while their list loads, at most; a gap loads the list again. */
const MAX_HELD_TRANSIENT_MESSAGES = 100;
/** A transient notification of this client sends at most four requests a second. */
const TRANSIENT_SEND_INTERVAL_MS = 250;
const TRANSIENT_ID_LENGTH = 16;
const TRANSIENT_TOKEN_LENGTH = 32;
/** The options of a request whose refusals the caller reads as codes, without an error toast. */
export const SILENT_REFUSALS = {
    silentBadRequest: true, silentNotFound: true, silentConflict: true
};

type TransientNotificationsMessage = Extract<WebSocketMessage, { type: "transient-notifications" }>;
type ForwardMessage = Extract<WebSocketMessage, { type: "notification-forward" }>;

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
    /** The transient notifications of the backend, oldest first. */
    readonly transients = signal<readonly TransientNotification[]>([]);
    /** The handlers of actions by their names, which a component reads to show its buttons. */
    readonly actionHandlers = signal<ReadonlyMap<string, NotificationActionHandler>>(new Map());

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
    private transientById = new Map<string, TransientNotification>();
    /** The counter of the last transient message applied, `null` until a list is taken. */
    private transientSeq: number | null = null;
    /** Transient messages that wait for a list to be taken. */
    private readonly heldTransientMessages: TransientNotificationsMessage[] = [];
    private isFetchingTransients = false;
    /** Counts the reconnects, so that the answer to a list request from before one is dropped. */
    private transientGeneration = 0;
    /** The transient notifications that this client created, by their IDs. */
    private readonly ownTransients = new Map<string, ClientTransientHandle>();

    /** Subscribes to the messages of the backend and loads the view. */
    start() {
        if (this.isStarted) {
            return;
        }

        this.isStarted = true;
        subscribeToMessages((message) => {
            if (message.type === "notification-alert") {
                this.onAlert(message.notificationId);
            } else if (message.type === "notification-forward") {
                runForwardedDelivery(message);
            } else if (message.type === "transient-notifications") {
                this.onTransientMessage(message);
            } else if (message.type === "notifications-due"
                || message.type === "protectedSessionLogin") {
                void this.reload();
            }
        });
        subscribeToReconnect(() => {
            // A backend that restarted counts its transient messages from zero again.
            this.transientSeq = null;
            this.heldTransientMessages.length = 0;
            this.isFetchingTransients = false;
            this.transientGeneration++;
            void this.reload();
        });
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

    /** Shows a transient notification of this client, and returns its handle at once. */
    createTransientNotification(input: TransientNotificationInput): TransientNotificationHandle {
        const handle = new ClientTransientHandle(input, (id) => this.ownTransients.delete(id));
        this.ownTransients.set(handle.id, handle);
        return handle;
    }

    /** The handle of a transient notification that this client created and has not dismissed. */
    getOwnTransient(id: string): ClientTransientHandle | undefined {
        return this.ownTransients.get(id);
    }

    /** Registers the handler of the notifications that name it. */
    registerActionHandler(name: string, handler: NotificationActionHandler) {
        const handlers = new Map(this.actionHandlers.value);
        handlers.set(name, handler);
        this.actionHandlers.value = handlers;
    }

    getActionHandler(name: string) {
        return this.actionHandlers.value.get(name);
    }

    /** Dismisses a standard notification for the user: "Remove" on its card. */
    remove(notification: TriliumNotification) {
        return this.dismissShown([ notification ], "user");
    }

    /** Dismisses a persistent notification without its handler: "Dismiss anyway". */
    dismissAnyway(notification: TriliumNotification) {
        return this.dismissShown([ notification ], "force");
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
                if (!after) {
                    this.takeTransients(page);
                }
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

    /** Takes the notifications out of the view, and loads it again when the backend refuses. */
    private async dismissShown(
        notifications: TriliumNotification[],
        reason: NotificationDismissReason
    ) {
        for (const { notificationId } of notifications) {
            this.view.delete(notificationId);
            this.load?.next.delete(notificationId);
        }
        this.publish();
        try {
            await this.sendDismissal(notifications.map(toRef), reason);
        } catch (e) {
            reportFailure("dismiss", e);
            await this.reload();
        }
    }

    private onTransientMessage(message: TransientNotificationsMessage) {
        if (this.transientSeq === null || this.isFetchingTransients) {
            this.holdTransientMessage(message);
        } else {
            this.applyTransientMessage(message);
        }
    }

    private holdTransientMessage(message: TransientNotificationsMessage) {
        this.heldTransientMessages.push(message);
        if (this.heldTransientMessages.length > MAX_HELD_TRANSIENT_MESSAGES) {
            this.heldTransientMessages.shift();
        }
    }

    private applyTransientMessage(message: TransientNotificationsMessage) {
        const seq = this.transientSeq;
        if (seq === null || message.seq <= seq) {
            return;
        }
        if (message.seq > seq + 1) {
            // A message was missed: the list loads again, and the newer messages wait for it.
            this.holdTransientMessage(message);
            void this.fetchTransients();
            return;
        }

        for (const id of message.removed) {
            this.transientById.delete(id);
        }
        for (const transient of message.changed) {
            this.transientById.set(transient.id, transient);
        }
        this.transientSeq = message.seq;
        this.publishTransients();
    }

    /** Takes the list of a first page, unless this client has applied newer messages. */
    private takeTransients(page: NotificationListResponse) {
        const { transients, transientSeq } = page;
        if (!transients || transientSeq === undefined
            || (this.transientSeq !== null && transientSeq < this.transientSeq)) {
            return;
        }

        this.transientById = new Map(transients.map((transient) => [ transient.id, transient ]));
        this.transientSeq = transientSeq;
        this.publishTransients();
        const held = this.heldTransientMessages.splice(0).sort((a, b) => a.seq - b.seq);
        for (const message of held) {
            this.applyTransientMessage(message);
        }
    }

    /** Loads the transient notifications from the first page of the view. */
    private async fetchTransients() {
        if (this.isFetchingTransients) {
            return;
        }

        this.isFetchingTransients = true;
        const generation = this.transientGeneration;
        try {
            const page = await server.getWithSilentErrors<NotificationListResponse>(
                "notifications");
            if (generation === this.transientGeneration) {
                this.isFetchingTransients = false;
                this.takeTransients(page);
            }
        } catch (e) {
            if (generation === this.transientGeneration) {
                this.isFetchingTransients = false;
            }
            reportFailure("transients", e);
        }
    }

    private publishTransients() {
        this.transients.value = [ ...this.transientById.values() ].sort((a, b) =>
            compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id));
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

/**
 * A transient notification of this client. It merges the changes of its setters and sends them in
 * order, at most four requests a second, and sends itself again every 20 seconds, since the backend
 * ends it a minute after its last change. A request that fails is logged by its code, and the next
 * change tries again. Each request includes the handle's own owner token, so the next change also
 * works after a creation whose answer was lost.
 */
export class ClientTransientHandle implements TransientNotificationHandle {

    readonly id = randomString(TRANSIENT_ID_LENGTH);
    private readonly token = randomSecret(TRANSIENT_TOKEN_LENGTH);
    private input: TransientNotificationInput;
    /** Whether a request was sent, so that a dismissal sends a `DELETE`. */
    private isSent = false;
    /** Whether a request succeeded, so that the refreshes keep the notification alive. */
    private isCreated = false;
    private hasChanges = true;
    private isDismissed = false;
    private sending: Promise<void> | null = null;
    private sendTimer: ReturnType<typeof setTimeout> | null = null;
    private refreshTimer: ReturnType<typeof setTimeout> | null = null;
    private lastSendMs = -Infinity;

    constructor(input: TransientNotificationInput, private readonly onEnd: (id: string) => void) {
        this.input = { ...input };
        this.scheduleSend();
    }

    setTitle(title: string) {
        this.change({ title });
    }

    setDescription(description: string) {
        this.change({ description });
    }

    setProtectedTitle(protectedTitle: string) {
        this.change({ protectedTitle });
    }

    setProtectedDescription(protectedDescription: string) {
        this.change({ protectedDescription });
    }

    setIcon(icon: string) {
        this.change({ icon });
    }

    setProgress(progress: number) {
        this.change({ progress });
    }

    setProgressLabel(progressLabel: string) {
        this.change({ progressLabel });
    }

    setActions(actions: NotificationAction[]) {
        this.change({ actions });
    }

    /** Makes the notification sensitive for good, for a handler result with `sensitive: true`. */
    makeSensitive() {
        this.change({ sensitive: true });
    }

    /** Ends the notification at once: the changes that wait are dropped. */
    dismiss() {
        if (this.isDismissed) {
            return;
        }

        this.isDismissed = true;
        for (const timer of [ this.sendTimer, this.refreshTimer ]) {
            if (timer !== null) {
                clearTimeout(timer);
            }
        }
        this.sendTimer = this.refreshTimer = null;
        this.onEnd(this.id);
        void this.end();
    }

    private change(patch: TransientNotificationInput) {
        if (this.isDismissed) {
            return;
        }

        this.input = { ...this.input, ...patch };
        this.hasChanges = true;
        this.scheduleSend();
    }

    /** Sends the changes once the request in flight is done and a quarter second has passed. */
    private scheduleSend() {
        if (this.sendTimer !== null || this.sending !== null) {
            return;
        }

        const delayMs = Math.max(0, this.lastSendMs + TRANSIENT_SEND_INTERVAL_MS - Date.now());
        this.sendTimer = setTimeout(() => {
            this.sendTimer = null;
            void this.send();
        }, delayMs);
    }

    private async send() {
        if (this.refreshTimer !== null) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
        this.hasChanges = false;
        this.lastSendMs = Date.now();
        this.isSent = true;
        const request: TransientNotificationPutRequest = {
            notification: this.input, token: this.token
        };

        this.sending = this.put(request);
        await this.sending;
        this.sending = null;
        if (this.isDismissed) {
            return;
        }
        if (this.hasChanges) {
            this.scheduleSend();
        } else if (this.isCreated) {
            this.refreshTimer = setTimeout(() => {
                this.refreshTimer = null;
                this.hasChanges = true;
                this.scheduleSend();
            }, TRANSIENT_NOTIFICATION_REFRESH_MS);
        }
    }

    private async put(request: TransientNotificationPutRequest) {
        try {
            await server.put(`notifications/transient/${encodeURIComponent(this.id)}`, request,
                undefined, SILENT_REFUSALS);
            this.isCreated = true;
        } catch (e) {
            reportFailure("transient", e);
        }
    }

    /** Ends the notification on the backend once the request in flight is done. */
    private async end() {
        if (this.sending) {
            await this.sending;
        }
        if (!this.isSent) {
            return;
        }

        try {
            await server.remove(`notifications/transient/${encodeURIComponent(this.id)}`, undefined,
                { token: this.token }, SILENT_REFUSALS);
        } catch (e) {
            reportFailure("transient", e);
        }
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

function compareText(a: string, b: string) {
    if (a === b) {
        return 0;
    }
    return a < b ? -1 : 1;
}

/** The code of a refused request: the body of every refusal of a notification route is its code. */
export function getErrorCode(error: unknown): NotificationErrorCode {
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

/** Loads the runner of frontend channels on first use, and runs it for an announced delivery. */
function runForwardedDelivery(message: ForwardMessage) {
    import("./notification_channels.js")
        .then((channels) => channels.runForwardedDelivery(message))
        .catch((e: unknown) => reportFailure("forward", e));
}

const notificationStore = new NotificationStore();
export default notificationStore;
