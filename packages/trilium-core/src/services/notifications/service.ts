/**
 * @module
 *
 * The notification service: raises, updates, marks and dismissals, the private text of sensitive
 * notifications, budgets and the limit on what an instance admits, alerts, housekeeping, the timer
 * of rows dated ahead, and the listeners for notes and synced rows. It reaches the database through
 * its store alone.
 */
import {
    NOTIFICATION_DISMISS_REASONS,
    NOTIFICATION_LIVE_LIMIT,
    NOTIFICATION_LIVE_LIMIT_FOR_OTHERS,
    NOTIFICATION_PAGE_SIZE,
    type NotificationCategory,
    type NotificationContent,
    type NotificationCounts,
    type NotificationDismissResponse,
    type NotificationListResponse,
    type NotificationMarkRow,
    type NotificationPatch,
    type NotificationPrivateContent,
    type NotificationPrivateTextUpdate,
    type NotificationRow,
    type NoteRow,
    type TriliumNotification,
    type WebSocketMessage
} from "@triliumnext/commons";
import { t } from "i18next";

import type BNotification from "../../becca/entities/bnotification.js";
import * as cls from "../context.js";
import events from "../events.js";
import { getLog } from "../log.js";
import { isProtectedSessionAvailable } from "../protected_session.js";
import { randomString } from "../utils/index.js";
import {
    AHEAD_TOLERANCE_MS,
    checkContentSize,
    checkInput,
    checkPatch,
    checkPlainPrivateTextSize,
    checkRefs,
    compactContent,
    describeRow,
    formatUtcDateTime,
    getLinkNoteId,
    getNotificationId,
    getReferencedNoteId,
    getTimeOfNotificationId,
    isNotificationId,
    isReservedName,
    isShownRow,
    isToken,
    makeTextPrivate,
    NotificationError,
    parseContent,
    parseUtcDateTime,
    type PrivateText,
    type RaiseOutcome,
    resolveView,
    type ViewContext,
    type ViewEntry
} from "./model.js";
import {
    getNotificationKeys,
    type NotificationKeys,
    openPrivateText,
    PRIVATE_TEXT_FIELDS,
    sealField
} from "./protected_text.js";
import type * as storeModule from "./store.js";
import TransientNotifications from "./transients.js";

export type NotificationStore = typeof storeModule;

/** Who raises: a built-in feature by its name, a script by its note, or a client by its session. */
export type NotificationProducer =
    | { kind: "built-in"; name: string }
    | { kind: "script"; noteId: string }
    | { kind: "client"; sessionId?: string };

export interface NotificationTransport {
    /** Sends a message to every client of this backend. */
    send(message: WebSocketMessage): void;
}

export interface NotificationSettings {
    isCategoryOff(category: NotificationCategory): boolean;
}

/** The outcome of a raise, or `queued` for a built-in producer over its budget. */
export interface CreateResult {
    outcome: RaiseOutcome | "queued";
    /** The new or the stored generation, `null` for the other outcomes. */
    notification: TriliumNotification | null;
}

export interface NotificationServiceDependencies {
    store: NotificationStore;
    transport: NotificationTransport;
    settings: NotificationSettings;
    /** When this instance last applied a batch of sync, in milliseconds. */
    getLastSyncedBatchTime(): number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An alert is sent for a notification raised within this time. */
const ALERT_WINDOW_MS = 10 * MINUTE;
/** The instance has settled once no synced batch was applied for this time. */
const SETTLE_MS = 10 * SECOND;
/** Alerts for synced rows wait for the instance to settle at most this long. */
const SETTLE_LIMIT_MS = 2 * MINUTE;
/** The longest wait of the timer of rows dated ahead. */
const DUE_TIMER_MAX_MS = DAY;
/** The timer of rows dated ahead fires at most once in this time. */
const DUE_TIMER_MIN_INTERVAL_MS = MINUTE;
/** A log line and a toast about refused raises are repeated at most once in this time. */
const REPORT_INTERVAL_MS = MINUTE;

const PRODUCER_MINUTE_BUDGET = 30;
const SHARED_MINUTE_BUDGET = 120;
const DAILY_BUDGET = 500;
const GENERATED_ID_LENGTH = 16;

export default class NotificationService {

    private readonly store: NotificationStore;
    private readonly transport: NotificationTransport;
    private readonly settings: NotificationSettings;
    private readonly getLastSyncedBatchTime: () => number;
    private readonly budgets = new RaiseBudgets();
    private readonly transients: TransientNotifications;
    /** Raises of built-in producers over their budget, oldest first. */
    private readonly queuedRaises: { input: unknown; producer: NotificationProducer }[] = [];
    /** The generations that this backend alerted for, with their times. */
    private readonly alerted = new Map<string, number>();
    private readonly pendingAlerts = new Set<string>();
    /** The generations that sync brought since the instance last settled. */
    private readonly syncedArrivals = new Set<string>();
    private readonly lastReports = new Map<string, number>();
    private isStarted = false;
    private isSubscribed = false;
    /** Whether sync brought notifications or deleted notes since the instance last settled. */
    private hasSyncedChanges = false;
    private settleTimer: ReturnType<typeof setTimeout> | null = null;
    private settleWaitStartMs = 0;
    private queueTimer: ReturnType<typeof setTimeout> | null = null;
    private alertTimer: ReturnType<typeof setTimeout> | null = null;
    private housekeepingTimer: ReturnType<typeof setInterval> | null = null;
    private dueTimer: ReturnType<typeof setTimeout> | null = null;
    private dueAtMs: number | null = null;
    private lastDueFireMs = -Infinity;
    private lastDueCheckMs = 0;

    constructor(dependencies: NotificationServiceDependencies) {
        this.store = dependencies.store;
        this.transport = dependencies.transport;
        this.settings = dependencies.settings;
        this.getLastSyncedBatchTime = dependencies.getLastSyncedBatchTime;
        this.transients = new TransientNotifications({
            transport: this.transport,
            isNoteSensitive: (noteId) => this.isNoteSensitive(noteId),
            isProtectedSessionOpen: () => isProtectedSessionAvailable()
        });
    }

    /**
     * Raises a notification by the rules of a raise. A built-in producer over its budget is
     * queued, and its raise is written once the budget allows.
     *
     * @returns the outcome, with the notification for `new` and `stored`.
     * @throws NotificationError for input that fails a check, a budget or the limit. Each check
     *         runs before the first write.
     */
    create(input: unknown, producer: NotificationProducer): CreateResult {
        const nowMs = Date.now();
        const isBuiltIn = producer.kind === "built-in";
        const checked = checkInput(input, isBuiltIn, nowMs);
        if (this.settings.isCategoryOff(checked.category)) {
            return { outcome: "categoryOff", notification: null };
        }

        const budgetCode = this.budgets.check(getBudgetKey(producer), isBuiltIn, nowMs);
        if (budgetCode && isBuiltIn) {
            this.queueRaise(input, producer);
            return { outcome: "queued", notification: null };
        }
        if (budgetCode) {
            this.report(`dropped:${getProducerName(producer)}`, budgetCode,
                `Dropped notifications of ${getProducerName(producer)} over its budget.`,
                "notifications.budget-toast");
            throw new NotificationError(budgetCode);
        }

        // Refusals come before the transaction: a nested one that throws runs the rollback hook.
        const id = checked.id ?? randomString(GENERATED_ID_LENGTH);
        const raisedAtMs = checked.raisedAtMs
            ?? toTimeMs(this.store.getDefaultRaisedAt(id, nowMs));
        const outcome = this.store.classify(id, raisedAtMs, nowMs);
        if (outcome === "erased" || outcome === "late") {
            return { outcome, notification: null };
        }
        if (outcome === "new") {
            this.checkAdmission(producer);
        }

        const notificationId = getNotificationId(id, raisedAtMs);
        const stored = outcome === "stored" ? this.store.getNotification(notificationId) : null;
        const linkNoteId = checked.content.link === undefined
            ? null : getLinkNoteId(checked.content.link);
        const isSensitive = checked.isNamedSensitive
            || this.store.hasMark(notificationId, "sensitive")
            || !!stored?.isSensitive
            || this.isNoteSensitive(checked.noteId ?? linkNoteId);
        // Root text that comes without private text is not trusted for a sensitive one.
        const made = isSensitive && !checked.privateText
            ? makeTextPrivate(checked.content)
            : { content: checked.content, text: {} };
        const keys = isSensitive ? getNotificationKeys() : null;
        const privateContent = keys
            ? this.buildPrivateText(notificationId, keys,
                { fill: checked.privateText ?? made.text })
            : null;
        this.budgets.draw(getBudgetKey(producer), getProducerName(producer), isBuiltIn, nowMs);

        return this.store.transactional(() => {
            const notification = stored ?? this.store.raise({
                id,
                raisedAt: formatUtcDateTime(raisedAtMs),
                tag: checked.tag,
                noteId: checked.noteId,
                category: checked.category,
                type: checked.type,
                attentionLevel: checked.attentionLevel,
                isSensitive,
                producer: getProducerName(producer),
                content: JSON.stringify(made.content)
            }, { nowMs }).notification;
            if (!notification) {
                throw new NotificationError("internal");
            }

            if (isSensitive) {
                this.store.writeMark(notificationId, "sensitive", nowMs);
                this.enforceSensitivity(notification, nowMs);
            }
            if (privateContent !== null) {
                this.store.writePrivateText(notificationId, privateContent, nowMs);
            }
            if (outcome === "new") {
                this.queueAlert(notificationId);
            }
            return { outcome, notification: this.toView(notification, nowMs) };
        });
    }

    /**
     * Changes the current generation of an ID, dated now or one millisecond after its stored date.
     *
     * @param expected the revision that the caller read; another stored revision is refused.
     * @throws NotificationError for a patch that fails a check, an ID without a current
     *         generation, a stale revision or a budget.
     */
    update(
        id: unknown,
        patch: unknown,
        producer: NotificationProducer,
        expected?: unknown
    ): TriliumNotification {
        const nowMs = Date.now();
        const isBuiltIn = producer.kind === "built-in";
        if (!isToken(id) || (expected !== undefined && typeof expected !== "string")) {
            throw new NotificationError("invalid-input");
        }
        if (!isBuiltIn && isReservedName(id)) {
            throw new NotificationError("reserved-name");
        }
        const checked = checkPatch(patch);

        const context = this.store.getViewContext(nowMs);
        const notification = this.getCurrent(id, context);
        if (!notification) {
            throw new NotificationError("not-found");
        }
        if (expected !== undefined && expected !== this.store.getRevision(notification)) {
            throw new NotificationError("stale-revision");
        }

        const budgetCode = this.budgets.check(getBudgetKey(producer), isBuiltIn, nowMs);
        if (budgetCode && !isBuiltIn) {
            throw new NotificationError(budgetCode);
        }

        const hasPrivateText = checked.protectedTitle !== undefined
            || checked.protectedDescription !== undefined;
        const isSensitive = describeRow(notification, context).isSensitive
            || checked.sensitive === true || hasPrivateText;
        const stored = parseContent(notification.content) ?? { v: 1 };
        // The text of a version without the flag is not public once the notification is.
        const base = isSensitive && !notification.isSensitive
            ? makeTextPrivate(stored)
            : { content: stored, text: {} };
        const patched = patchContent(base.content, checked, isSensitive && !hasPrivateText);
        checkContentSize(patched.content);
        const set: PrivateText = { ...patched.text };
        if (checked.protectedTitle !== undefined) {
            set.title = checked.protectedTitle;
        }
        if (checked.protectedDescription !== undefined) {
            set.description = checked.protectedDescription;
        }
        const keys = isSensitive ? getNotificationKeys() : null;
        const privateContent = keys
            ? this.buildPrivateText(notification.notificationId, keys, { set, fill: base.text })
            : null;
        this.budgets.draw(getBudgetKey(producer), getProducerName(producer), isBuiltIn, nowMs);

        return this.store.transactional(() => {
            this.store.rewrite(notification,
                { content: JSON.stringify(patched.content), isSensitive }, nowMs);
            if (isSensitive) {
                this.store.writeMark(notification.notificationId, "sensitive", nowMs);
            }
            if (privateContent !== null) {
                this.store.writePrivateText(notification.notificationId, privateContent, nowMs);
            }
            return this.toView(notification, nowMs);
        });
    }

    /** Writes the mark of the state for each stored generation of the refs. */
    setState(refs: unknown, state: unknown) {
        const checkedRefs = checkRefs(refs);
        if (state !== "seen" && state !== "read") {
            throw new NotificationError("invalid-input");
        }

        const nowMs = Date.now();
        this.store.transactional(() => {
            for (const { id, raisedAtMs } of checkedRefs) {
                this.store.writeMark(getNotificationId(id, raisedAtMs), state, nowMs);
            }
        });
    }

    /** Erases the stored generations of the refs, but no persistent one that the user dismisses. */
    dismiss(refs: unknown, reason: unknown): NotificationDismissResponse {
        const checkedRefs = checkRefs(refs);
        if (!(NOTIFICATION_DISMISS_REASONS as readonly unknown[]).includes(reason)) {
            throw new NotificationError("invalid-input");
        }

        const nowMs = Date.now();
        return this.store.transactional(() => {
            const erased: string[] = [];
            let refused = 0;
            for (const { id, raisedAtMs } of checkedRefs) {
                const notification = this.store.getNotification(getNotificationId(id, raisedAtMs));
                if (!notification) {
                    continue;
                }
                if (reason === "user" && notification.type === "persistent") {
                    refused++;
                    continue;
                }
                erased.push(notification.notificationId);
            }
            this.store.eraseNotifications(erased, nowMs);
            return { refused };
        });
    }

    /** Erases the current generation of an ID. */
    dismissById(id: unknown) {
        if (!isToken(id)) {
            throw new NotificationError("invalid-input");
        }

        const nowMs = Date.now();
        this.store.transactional(() => {
            const notification = this.getCurrent(id, this.store.getViewContext(nowMs));
            if (notification) {
                this.store.eraseNotifications([ notification.notificationId ], nowMs);
            }
        });
    }

    /**
     * Creates a transient notification, or replaces one with its owner token. One of a client ends
     * a minute after its last change, and one of backend code with the process.
     *
     * @returns the owner token.
     * @throws NotificationError for input that fails a check, a missing or wrong token for an ID
     *         that exists, and a create beyond the limits.
     */
    putTransient(id: unknown, input: unknown, producer: NotificationProducer, token?: unknown) {
        return this.transients.put(id, input, {
            name: getProducerName(producer),
            key: getBudgetKey(producer),
            isBuiltIn: producer.kind === "built-in",
            expires: producer.kind === "client"
        }, token);
    }

    /** Ends a transient notification. @throws NotificationError for a missing or wrong token. */
    dismissTransient(id: unknown, token: unknown) {
        this.transients.dismiss(id, token);
    }

    getById(id: unknown): TriliumNotification | null {
        if (!isToken(id)) {
            throw new NotificationError("invalid-input");
        }

        const nowMs = Date.now();
        const notification = this.getCurrent(id, this.store.getViewContext(nowMs));
        return notification ? this.toView(notification, nowMs) : null;
    }

    /** Every shown notification with the tag, newest first. */
    getByTag(tag: unknown): TriliumNotification[] {
        if (!isToken(tag)) {
            throw new NotificationError("invalid-input");
        }

        const nowMs = Date.now();
        const keys = getNotificationKeys();
        return resolveView(this.store.getStoredNotifications(), this.store.getViewContext(nowMs))
            .filter(({ row }) => row.tag === tag)
            .map((entry) => this.entryToView(entry, keys));
    }

    /**
     * One page of the view, newest first, after the generation that `after` names. The first page
     * also has the counts of the whole view.
     */
    getPage(after?: unknown): NotificationListResponse {
        if (after !== undefined && !isNotificationId(after)) {
            throw new NotificationError("invalid-input");
        }

        const nowMs = Date.now();
        const view = resolveView(this.store.getStoredNotifications(),
            this.store.getViewContext(nowMs));
        const start = after === undefined ? 0 : findPageStart(view, after);
        const page = view.slice(start, start + NOTIFICATION_PAGE_SIZE);
        const keys = getNotificationKeys();
        const response: NotificationListResponse = {
            notifications: page.map((entry) => this.entryToView(entry, keys)),
            changeId: this.store.getMaxEntityChangeId()
        };

        const last = page.at(-1);
        if (last && start + page.length < view.length) {
            response.next = last.row.notificationId;
        }
        if (after === undefined) {
            response.counts = this.getCounts(view, nowMs);
            response.transients = this.transients.list();
            response.transientSeq = this.transients.getSeq();
        }
        return response;
    }

    /**
     * What a `frontend-update` attaches to a change of the four tables: a generation as the view
     * gives it while it counts for the view, a mark as its row, a private text with the revision of
     * its notification and, while a protected session is open, its text. A channel record gets
     * nothing.
     */
    getClientEntity(entityName: string, entityId: string): object | null {
        const nowMs = Date.now();
        if (entityName === "notification_marks") {
            return this.store.getMark(entityId)?.getPojo() ?? null;
        }

        const notification = this.store.getNotification(entityId);
        if (!notification) {
            return null;
        }
        if (entityName === "notifications") {
            const context = this.store.getViewContext(nowMs);
            return isShownRow(notification, context)
                ? this.entryToView(describeRow(notification, context), getNotificationKeys())
                : null;
        }
        if (entityName !== "notification_private_texts") {
            return null;
        }
        const update: NotificationPrivateTextUpdate = {
            notificationId: entityId,
            revision: this.store.getRevision(notification),
            ...this.openPrivateFields(entityId, getNotificationKeys())
        };
        return update;
    }

    /**
     * Makes the text of the notifications about a note private, as `protectNote()` protects it in a
     * protected session: the title and the description move to the private text.
     */
    protectNotificationsAbout(noteId: string) {
        this.transients.protectAbout(noteId);
        const nowMs = Date.now();
        const keys = getNotificationKeys();
        for (const notification of this.store.getNotificationsAbout(noteId)) {
            const { notificationId } = notification;
            if (!notification.isSensitive) {
                const made = makeTextPrivate(parseContent(notification.content) ?? { v: 1 });
                const privateContent = keys
                    ? this.buildPrivateText(notificationId, keys, { set: made.text })
                    : null;
                this.store.rewrite(notification,
                    { content: JSON.stringify(made.content), isSensitive: true }, nowMs);
                if (privateContent !== null) {
                    this.store.writePrivateText(notificationId, privateContent, nowMs);
                }
            }
            this.store.writeMark(notificationId, "sensitive", nowMs);
        }
    }

    /** Erases the notifications about a note that was deleted. */
    eraseNotificationsAbout(noteId: string) {
        const notificationIds = this.store.getNotificationsAbout(noteId)
            .map(({ notificationId }) => notificationId);
        this.store.eraseNotifications(notificationIds);
    }

    /**
     * Erases what newer and erased generations cover and the notifications of deleted notes, trims
     * the history, and rewrites the versions that meet the fact that they are sensitive.
     */
    runHousekeeping() {
        const nowMs = Date.now();
        this.store.transactional(() => {
            this.store.runHousekeeping(nowMs);
            for (const notification of this.store.getStoredNotifications()) {
                this.enforceSensitivity(notification, nowMs);
            }
        });
    }

    /**
     * Subscribes the listeners, runs housekeeping, and arms the hourly housekeeping and the timer
     * of rows dated ahead.
     */
    start() {
        if (this.isStarted) {
            return;
        }

        this.isStarted = true;
        this.subscribe();
        this.lastDueCheckMs = Date.now();
        this.runTimed("housekeeping", () => this.runHousekeeping());
        this.housekeepingTimer = setInterval(
            () => this.runTimed("housekeeping", () => this.runHousekeeping()), HOUR);
        this.armDueTimer();
    }

    /**
     * Stops the timers and the listeners, and forgets the budgets, the queue, the alerts and the
     * transient notifications.
     */
    stop() {
        this.isStarted = false;
        for (const timer of [ this.settleTimer, this.queueTimer, this.alertTimer, this.dueTimer ]) {
            if (timer !== null) {
                clearTimeout(timer);
            }
        }
        if (this.housekeepingTimer !== null) {
            clearInterval(this.housekeepingTimer);
        }
        this.settleTimer = this.queueTimer = this.alertTimer = this.dueTimer = null;
        this.housekeepingTimer = null;
        this.dueAtMs = null;
        this.lastDueFireMs = -Infinity;
        this.hasSyncedChanges = false;
        this.syncedArrivals.clear();
        this.pendingAlerts.clear();
        this.alerted.clear();
        this.queuedRaises.length = 0;
        this.budgets.clear();
        this.lastReports.clear();
        this.transients.stop();
    }

    private subscribe() {
        if (this.isSubscribed) {
            return;
        }

        this.isSubscribed = true;
        events.subscribe(events.ENTITY_CHANGE_SYNCED, ({ entityName, entityRow }) =>
            this.onSyncedChange(entityName, entityRow));
        events.subscribe(events.ENTITY_DELETE_SYNCED, ({ entityName, entityId }) =>
            this.onSyncedDeletion(entityName, entityId));
        events.subscribe(events.ENTITY_DELETED, ({ entityName, entityId }) => {
            if (this.isStarted && entityName === "notes") {
                this.runListener(entityName, entityId,
                    () => this.eraseNotificationsAbout(entityId));
            }
        });
    }

    /** Rewrites a synced version that meets the fact, and keeps a synced generation to alert. */
    private onSyncedChange(entityName: string, entityRow: unknown) {
        if (!this.isStarted) {
            return;
        }

        if (entityName === "notifications") {
            const { notificationId } = entityRow as NotificationRow;
            this.runListener(entityName, notificationId, () => {
                const notification = this.store.getNotification(notificationId);
                if (notification) {
                    this.enforceSensitivity(notification, Date.now());
                    this.syncedArrivals.add(notificationId);
                }
            });
            this.hasSyncedChanges = true;
        } else if (entityName === "notification_marks") {
            const { notificationId, kind } = entityRow as NotificationMarkRow;
            this.runListener(entityName, notificationId, () => {
                const notification = this.store.getNotification(notificationId);
                if (notification && kind === "sensitive") {
                    this.enforceSensitivity(notification, Date.now());
                }
            });
            this.hasSyncedChanges = true;
        } else if (entityName === "notification_private_texts") {
            this.hasSyncedChanges = true;
        } else if (entityName === "notes" && (entityRow as NoteRow).isProtected) {
            const { noteId } = entityRow as NoteRow;
            this.runListener(entityName, noteId, () => {
                this.transients.protectAbout(noteId);
                for (const notification of this.store.getNotificationsAbout(noteId)) {
                    this.enforceSensitivity(notification, Date.now());
                }
            });
        }
        this.waitForSettling();
    }

    private onSyncedDeletion(entityName: string, entityId: string) {
        if (!this.isStarted) {
            return;
        }

        if (entityName === "notifications" || entityName === "notes") {
            this.hasSyncedChanges = true;
        }
        this.waitForSettling();
    }

    private waitForSettling() {
        if (this.settleTimer !== null) {
            return;
        }

        this.settleWaitStartMs = Date.now();
        this.settleTimer = setTimeout(() => this.checkSettled(), SETTLE_MS);
    }

    private checkSettled() {
        this.settleTimer = null;
        const nowMs = Date.now();
        const quietMs = nowMs - this.getLastSyncedBatchTime();
        const waitedMs = nowMs - this.settleWaitStartMs;
        if (quietMs < SETTLE_MS && waitedMs < SETTLE_LIMIT_MS) {
            const delayMs = Math.min(SETTLE_MS - quietMs, SETTLE_LIMIT_MS - waitedMs);
            this.settleTimer = setTimeout(() => this.checkSettled(), delayMs);
            return;
        }

        if (this.hasSyncedChanges) {
            this.hasSyncedChanges = false;
            this.runTimed("housekeeping", () => this.runHousekeeping());
        }
        for (const notificationId of this.syncedArrivals) {
            this.queueAlert(notificationId);
        }
        this.syncedArrivals.clear();
        this.armDueTimer();
    }

    /** Arms the timer for the earliest moment at which a row dated ahead comes within the hour. */
    private armDueTimer() {
        if (this.dueTimer !== null) {
            clearTimeout(this.dueTimer);
            this.dueTimer = null;
        }

        const nowMs = Date.now();
        const earliestMs = this.runTimed("due-timer", () => this.store.getEarliestTimeAhead(nowMs));
        if (earliestMs === null || earliestMs === undefined) {
            this.dueAtMs = null;
            return;
        }

        this.dueAtMs = earliestMs - AHEAD_TOLERANCE_MS;
        const fireAtMs = Math.max(Math.min(this.dueAtMs, nowMs + DUE_TIMER_MAX_MS),
            this.lastDueFireMs + DUE_TIMER_MIN_INTERVAL_MS);
        this.dueTimer = setTimeout(() => this.onDueTimer(), Math.max(0, fireAtMs - nowMs));
    }

    private onDueTimer() {
        this.dueTimer = null;
        const nowMs = Date.now();
        this.lastDueFireMs = nowMs;
        if (this.dueAtMs !== null && nowMs >= this.dueAtMs) {
            this.runTimed("housekeeping", () => this.runHousekeeping());
            // The generations that came within the hour since the last check alert as synced ones.
            for (const notification of this.store.getStoredNotifications()) {
                const timeMs = getTimeOfNotificationId(notification.notificationId);
                if (timeMs > this.lastDueCheckMs + AHEAD_TOLERANCE_MS
                    && timeMs <= nowMs + AHEAD_TOLERANCE_MS) {
                    this.queueAlert(notification.notificationId);
                }
            }
            this.lastDueCheckMs = nowMs;
            this.transport.send({ type: "notifications-due" });
        }
        this.armDueTimer();
    }

    /** Sends the alert once the transaction that wrote the generation has ended. */
    private queueAlert(notificationId: string) {
        this.pendingAlerts.add(notificationId);
        if (this.alertTimer === null) {
            this.alertTimer = setTimeout(() => this.flushAlerts(), 0);
        }
    }

    private flushAlerts() {
        this.alertTimer = null;
        const nowMs = Date.now();
        for (const [ notificationId, timeMs ] of this.alerted) {
            if (nowMs - timeMs > ALERT_WINDOW_MS) {
                this.alerted.delete(notificationId);
            }
        }

        const notificationIds = [ ...this.pendingAlerts ];
        this.pendingAlerts.clear();
        for (const notificationId of notificationIds) {
            if (this.runTimed("alert", () => this.isAlertDue(notificationId, nowMs))) {
                this.alerted.set(notificationId, getTimeOfNotificationId(notificationId));
                this.transport.send({ type: "notification-alert", notificationId });
            }
        }
    }

    /**
     * Whether a generation gets an alert: it is current and pending, of level `medium` or `high`,
     * raised within the last 10 minutes, and not alerted before.
     */
    private isAlertDue(notificationId: string, nowMs: number) {
        const notification = this.store.getNotification(notificationId);
        if (!notification || this.alerted.has(notificationId)
            || notification.attentionLevel === "low"
            || nowMs - getTimeOfNotificationId(notificationId) > ALERT_WINDOW_MS) {
            return false;
        }

        const context = this.store.getViewContext(nowMs);
        return this.getCurrent(notification.id, context)?.notificationId === notificationId
            && describeRow(notification, context).state === "pending";
    }

    private queueRaise(input: unknown, producer: NotificationProducer) {
        this.queuedRaises.push({ input, producer });
        this.armQueueTimer();
    }

    private armQueueTimer() {
        const first = this.queuedRaises[0];
        if (!first || this.queueTimer !== null) {
            return;
        }

        const delayMs = this.budgets.getWait(getBudgetKey(first.producer), Date.now());
        this.queueTimer = setTimeout(() => this.flushQueue(), delayMs);
    }

    /** Writes the queued raises that the budgets of their producers allow, in their order. */
    private flushQueue() {
        this.queueTimer = null;
        while (this.queuedRaises.length > 0) {
            const { input, producer } = this.queuedRaises[0];
            if (this.budgets.check(getBudgetKey(producer), true, Date.now())) {
                break;
            }
            this.queuedRaises.shift();
            this.runTimed("queued-raise", () => this.create(input, producer));
        }
        this.armQueueTimer();
    }

    /** @throws NotificationError `full` while the instance stores the limit of the producer. */
    private checkAdmission(producer: NotificationProducer) {
        const limit = producer.kind === "built-in"
            ? NOTIFICATION_LIVE_LIMIT
            : NOTIFICATION_LIVE_LIMIT_FOR_OTHERS;
        if (this.store.getStoredNotifications().length < limit) {
            return;
        }

        this.report("full", "full",
            "Refused a notification: this instance holds its limit of notifications.",
            "notifications.full-toast");
        throw new NotificationError("full");
    }

    /** Logs a refusal and sends its toast, each at most once a minute per kind. */
    private report(kind: string, code: string, logLine: string, toastKey: string) {
        const nowMs = Date.now();
        if (nowMs - (this.lastReports.get(`log:${kind}`) ?? -Infinity) >= REPORT_INTERVAL_MS) {
            this.lastReports.set(`log:${kind}`, nowMs);
            getLog().error(`${logLine} Code: ${code}.`);
        }
        if (nowMs - (this.lastReports.get(`toast:${code}`) ?? -Infinity) >= REPORT_INTERVAL_MS) {
            this.lastReports.set(`toast:${code}`, nowMs);
            this.transport.send({ type: "toast", message: t(toastKey) });
        }
    }

    /**
     * Where this instance has the mark, or has the note as protected, rewrites a version without
     * the flag: its text is dropped and the row is flagged. A flagged row gets the mark it lacks.
     */
    private enforceSensitivity(notification: BNotification, nowMs: number) {
        const { notificationId } = notification;
        const isMarked = this.store.hasMark(notificationId, "sensitive");
        if (!notification.isSensitive) {
            const noteId = getReferencedNoteId(notification.noteId, notification.content);
            const isNoteProtected = noteId !== null
                && this.store.getNoteProtection(noteId) === "protected";
            if (!isMarked && !isNoteProtected) {
                return;
            }

            const made = makeTextPrivate(parseContent(notification.content) ?? { v: 1 });
            this.store.rewrite(notification,
                { content: JSON.stringify(made.content), isSensitive: true }, nowMs);
        }
        if (!isMarked) {
            this.store.writeMark(notificationId, "sensitive", nowMs);
        }
    }

    /**
     * The sealed private text of a generation after a write. A field of `set` replaces the stored
     * one, and an empty one clears it; a field of `fill` is written only where no stored field
     * opens. Every other stored field is kept where it opens.
     *
     * @returns the content to write, or `null` when the write changes nothing.
     * @throws NotificationError `too-large` for a text over 8 KiB as plain JSON.
     */
    private buildPrivateText(
        notificationId: string,
        keys: NotificationKeys,
        changes: { set?: PrivateText; fill?: PrivateText }
    ): string | null {
        const stored = this.store.getPrivateText(notificationId);
        const opened = stored ? openPrivateText(keys, notificationId, stored.content) : {};
        const plain: PrivateText = {};
        const sealed: NotificationPrivateContent = { v: 1 };
        let isChanged = false;
        for (const field of PRIVATE_TEXT_FIELDS) {
            const kept = opened[field];
            const setText = changes.set?.[field];
            const fillText = changes.fill?.[field];
            if (setText !== undefined && setText !== kept?.text) {
                isChanged = true;
                if (setText) {
                    plain[field] = setText;
                    sealed[field] = sealField(keys, notificationId, field, setText);
                }
            } else if (kept) {
                plain[field] = kept.text;
                sealed[field] = kept.sealed;
            } else if (fillText) {
                isChanged = true;
                plain[field] = fillText;
                sealed[field] = sealField(keys, notificationId, field, fillText);
            }
        }

        if (!isChanged) {
            return null;
        }
        checkPlainPrivateTextSize(plain);
        return JSON.stringify(sealed);
    }

    /** The newest generation of an ID that the view shows. */
    private getCurrent(id: string, context: ViewContext): BNotification | null {
        let current: BNotification | null = null;
        for (const notification of this.store.getGenerations(id)) {
            // The keys of one ID share their hash, so they compare as their times do.
            if (isShownRow(notification, context)
                && (!current || notification.notificationId > current.notificationId)) {
                current = notification;
            }
        }
        return current;
    }

    private isNoteSensitive(noteId: string | null) {
        return noteId !== null && this.store.getNoteProtection(noteId) !== "plain";
    }

    private toView(notification: BNotification, nowMs: number): TriliumNotification {
        const entry = describeRow(notification, this.store.getViewContext(nowMs));
        return this.entryToView(entry, getNotificationKeys());
    }

    /** The notification as a reader gets it, with its private text while a session is open. */
    private entryToView(
        entry: ViewEntry<BNotification>,
        keys: NotificationKeys | null
    ): TriliumNotification {
        const { row, state, isSensitive, content } = entry;
        const view: TriliumNotification = {
            notificationId: row.notificationId,
            id: row.id,
            raisedAt: row.raisedAt,
            updatedAt: row.utcDateModified,
            revision: this.store.getRevision(row),
            category: row.category,
            type: row.type,
            attentionLevel: row.attentionLevel,
            state,
            producer: row.producer
        };
        if (row.tag !== null) {
            view.tag = row.tag;
        }
        if (row.noteId !== null) {
            view.noteId = row.noteId;
        }
        copyContent(view, content);
        if (isSensitive) {
            view.sensitive = true;
        }
        return Object.assign(view, this.openPrivateFields(row.notificationId, keys));
    }

    /** The fields of a generation's private text that open under the keys. */
    private openPrivateFields(notificationId: string, keys: NotificationKeys | null) {
        const fields: Pick<TriliumNotification, "protectedTitle" | "protectedDescription"> = {};
        const privateText = keys ? this.store.getPrivateText(notificationId) : null;
        if (keys && privateText) {
            const opened = openPrivateText(keys, notificationId, privateText.content);
            if (opened.title) {
                fields.protectedTitle = opened.title.text;
            }
            if (opened.description) {
                fields.protectedDescription = opened.description.text;
            }
        }
        return fields;
    }

    private getCounts(view: ViewEntry<BNotification>[], nowMs: number): NotificationCounts {
        return {
            total: view.length,
            pending: view.filter(({ state }) => state === "pending").length,
            unread: view.filter(({ state }) => state !== "read").length,
            live: this.store.getStoredNotifications().length,
            dailyBudgetReached: this.budgets.getDailyBudgetReached(nowMs)
        };
    }

    /** Runs a listener, which logs its error by entity, ID and code. */
    private runListener(entityName: string, entityId: string, fn: () => void) {
        try {
            fn();
        } catch (e) {
            const code = e instanceof NotificationError ? e.code : "internal";
            getLog().error(`A notification listener failed for ${entityName} `
                + `${JSON.stringify(String(entityId).substring(0, 40))}: ${code}.`);
        }
    }

    /** Runs work of a timer in a CLS context, and logs its error by a code. */
    private runTimed<T>(task: string, fn: () => T): T | undefined {
        try {
            return cls.init(fn);
        } catch (e) {
            const code = e instanceof NotificationError ? e.code : "internal";
            getLog().error(`Notification task ${task} failed: ${code}.`);
            return undefined;
        }
    }

}

/**
 * Counts the raises of each producer in sliding windows: 30 a minute per producer, 120 a minute
 * for all producers that are not built in, and 500 a day for each of those.
 */
export class RaiseBudgets {

    private readonly minuteDraws = new Map<string, number[]>();
    private readonly dayDraws = new Map<string, { producer: string; times: number[] }>();
    private sharedDraws: number[] = [];

    /** The code of the budget that a raise exceeds now, or `null`. */
    check(key: string, isBuiltIn: boolean, nowMs: number): "budget" | "daily-budget" | null {
        if (this.count(this.minuteDraws.get(key), nowMs - MINUTE) >= PRODUCER_MINUTE_BUDGET) {
            return "budget";
        }
        if (isBuiltIn) {
            return null;
        }
        if (this.count(this.sharedDraws, nowMs - MINUTE) >= SHARED_MINUTE_BUDGET) {
            return "budget";
        }
        return this.count(this.dayDraws.get(key)?.times, nowMs - DAY) >= DAILY_BUDGET
            ? "daily-budget"
            : null;
    }

    draw(key: string, producer: string, isBuiltIn: boolean, nowMs: number) {
        this.prune(nowMs);
        this.minuteDraws.set(key, [ ...this.minuteDraws.get(key) ?? [], nowMs ]);
        if (!isBuiltIn) {
            this.sharedDraws.push(nowMs);
            const day = this.dayDraws.get(key) ?? { producer, times: [] };
            day.times.push(nowMs);
            this.dayDraws.set(key, day);
        }
    }

    /** The milliseconds until a producer has a raise of its minute budget again. */
    getWait(key: string, nowMs: number) {
        const times = this.minuteDraws.get(key) ?? [];
        const oldest = times[times.length - PRODUCER_MINUTE_BUDGET];
        return oldest === undefined ? 0 : Math.max(0, oldest + MINUTE - nowMs);
    }

    /** The producers that have raised their daily budget, by their `producer` value. */
    getDailyBudgetReached(nowMs: number) {
        const producers = new Set<string>();
        for (const { producer, times } of this.dayDraws.values()) {
            if (this.count(times, nowMs - DAY) >= DAILY_BUDGET) {
                producers.add(producer);
            }
        }
        return [ ...producers ];
    }

    clear() {
        this.minuteDraws.clear();
        this.dayDraws.clear();
        this.sharedDraws = [];
    }

    private count(times: number[] | undefined, sinceMs: number) {
        return times ? times.filter((timeMs) => timeMs > sinceMs).length : 0;
    }

    /** Drops the draws that no window counts any more. */
    private prune(nowMs: number) {
        for (const [ key, times ] of this.minuteDraws) {
            const kept = times.filter((timeMs) => timeMs > nowMs - MINUTE);
            if (kept.length === 0) {
                this.minuteDraws.delete(key);
            } else {
                this.minuteDraws.set(key, kept);
            }
        }
        for (const [ key, day ] of this.dayDraws) {
            day.times = day.times.filter((timeMs) => timeMs > nowMs - DAY);
            if (day.times.length === 0) {
                this.dayDraws.delete(key);
            }
        }
        this.sharedDraws = this.sharedDraws.filter((timeMs) => timeMs > nowMs - MINUTE);
    }

}

/** The `producer` value of a row: a built-in name, `script:<noteId>` or `client`. */
export function getProducerName(producer: NotificationProducer) {
    switch (producer.kind) {
        case "built-in":
            return producer.name;
        case "script":
            return `script:${producer.noteId}`;
        case "client":
            return "client";
    }
}

/** The key of a producer's budget. Each session of a client has a budget of its own. */
function getBudgetKey(producer: NotificationProducer) {
    return producer.kind === "client" && producer.sessionId
        ? `client:${producer.sessionId}`
        : getProducerName(producer);
}

/**
 * Applies a patch to a content. An empty text clears its field. Where the text is private, the
 * title and the description, empty or not, go to the private text and the public ones are kept;
 * the progress label is dropped and the captions of the actions are left empty.
 */
function patchContent(
    content: NotificationContent,
    patch: NotificationPatch,
    isTextPrivate: boolean
): { content: NotificationContent; text: PrivateText } {
    const patched: NotificationContent = { ...content };
    const text: PrivateText = {};
    for (const field of [ "title", "description" ] as const) {
        const value = patch[field];
        if (value !== undefined && isTextPrivate) {
            text[field] = value;
        } else if (value === "") {
            delete patched[field];
        } else if (value !== undefined) {
            patched[field] = value;
        }
    }

    if (patch.progressLabel === "") {
        delete patched.progressLabel;
    } else if (patch.progressLabel !== undefined && !isTextPrivate) {
        patched.progressLabel = patch.progressLabel;
    }
    if (patch.icon !== undefined) {
        patched.icon = patch.icon;
    }
    if (patch.progress !== undefined) {
        patched.progress = patch.progress;
    }
    if (patch.actions !== undefined) {
        patched.actions = isTextPrivate
            ? makeTextPrivate({ v: 1, actions: patch.actions }).content.actions
            : patch.actions;
    }
    return { content: compactContent(patched), text };
}

/** Copies the fields of a content onto a view. */
function copyContent(view: TriliumNotification, content: NotificationContent) {
    const { v: _version, ...fields } = compactContent(content);
    Object.assign(view, fields);
}

/** The index of the first entry of the view after the generation that the cursor names. */
function findPageStart(view: ViewEntry<BNotification>[], after: string) {
    const afterMs = getTimeOfNotificationId(after);
    const index = view.findIndex(({ row }) => {
        const timeMs = getTimeOfNotificationId(row.notificationId);
        return timeMs < afterMs || (timeMs === afterMs && row.notificationId < after);
    });
    return index === -1 ? view.length : index;
}

/** Parses a date that a store function formatted. */
function toTimeMs(utcDateTime: string) {
    const timeMs = parseUtcDateTime(utcDateTime);
    if (timeMs === null) {
        throw new NotificationError("internal");
    }
    return timeMs;
}
