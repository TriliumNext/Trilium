/**
 * @module
 *
 * The forwarder: which instance forwards, the deliveries of the ledger and their attempts with the
 * checks before each, the frontend deliveries that tabs claim, the switchings of channels that the
 * delivery record takes, the pause after a restore, a move or a rollback, the status of channels
 * and the notices of a channel that stops.
 */
import {
    isBuiltInNotificationProducer,
    NOTIFICATION_DELIVERY_DEADLINE_MS,
    NOTIFICATION_FRONTEND_MAX_PROFILES,
    type EntityChangeRecord,
    type NotificationChannelPayload,
    type NotificationChannelsOff,
    type NotificationChannelStatus,
    type NotificationDeliveryClaimResponse,
    type NotificationDeliveryErrorCode,
    type NotificationDeliverySkipReason,
    type NotificationPauseCause,
    type WebSocketMessage
} from "@triliumnext/commons";
import { t } from "i18next";

import type BNotification from "../../../becca/entities/bnotification.js";
import config from "../../config.js";
import * as cls from "../../context.js";
import events from "../../events.js";
import { getLog } from "../../log.js";
import optionService from "../../options.js";
import { getPlatform } from "../../platform.js";
import { runBundle } from "../../script.js";
import { isScriptingEnabled } from "../../scripting_guard.js";
import { getSql } from "../../sql/index.js";
import { isIncomingChangeTaken } from "../../sync_update.js";
import { randomString } from "../../utils/index.js";
import {
    type ActivationRecord,
    checkChannelRecordRow,
    formatUtcDateTime,
    getTimeOfNotificationId,
    isDatedAhead,
    isShownRow,
    NotificationError,
    parseChannelRecord
} from "../model.js";
import * as store from "../store.js";
import { hashTemplate } from "./body_template.js";
import {
    type Channel,
    getChannel,
    getChannels,
    getCurrentRevision,
    isChannelHeld
} from "./catalog.js";
import {
    DeliveryRecord,
    dropOldEntries,
    endChannel,
    getEntry,
    getHighestRecordSequence,
    type RecordState,
    seeSequence,
    takeRevocation,
    takeSwitching,
    type Switching
} from "./delivery_record.js";
import * as ledger from "./ledger.js";
import type { Delivery } from "./ledger.js";
import { buildPayload, getDeliveryKey } from "./payload.js";
import {
    getActivation,
    getHeldSettings,
    getHighestSequence,
    getRecords,
    getStatus,
    isRevoked,
    writeDefinition,
    writeStatus
} from "./records.js";
import { getChannelType, loadChannelTypes, onAddressChanged } from "./registry.js";
import { getBackendBundle, getFrontendBundle } from "./script_channels.js";
import { ChannelSendError } from "./types.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** An attempt that has not settled in this time is aborted through its signal. */
export const ATTEMPT_TIMEOUT_MS = 30 * SECOND;
/** The waits before the second, third and fourth attempt. */
const RETRY_DELAYS_MS = [ MINUTE, 5 * MINUTE, 30 * MINUTE ];
const RETRY_AFTER_MAX_MS = HOUR;
/** The instance has settled once no synced batch was applied for this time. */
const SETTLE_MS = 10 * SECOND;
/** Deliveries wait for the instance to settle at most this long. */
const SETTLE_LIMIT_MS = 2 * MINUTE;
/** A channel sends at most this many deliveries an hour. */
const CHANNEL_BUDGET = 30;
/** What a producer that is not built in sends through one channel in an hour, at most. */
const PRODUCER_SHARE = 10;
/** What all producers that are not built in send through one channel in an hour, at most. */
const COMMON_SHARE = 20;
const ENABLINGS_PER_HOUR = 10;
const SETTINGS_CHANGES_PER_HOUR = 10;
const TEST_SENDS_PER_MINUTE = 5;
/** A confirmed sync cursor pauses nothing again for this time. */
const CONFIRMED_CURSOR_MS = 48 * HOUR;
const RECORD_RETRY_MS = MINUTE;
/** The checks of channels wait this long after a change, so that a batch of changes runs one. */
const CHECK_DELAY_MS = SECOND;
const NOTICE_INTERVAL_MS = HOUR;
const SETTINGS_LINK = "#root/_hidden/_options/_optionsNotifications";
/** The longest wait of the timer of due deliveries. */
const DUE_TIMER_MAX_MS = HOUR;

/** Why a delivery ends before its attempt, or `null` to go on. */
type DeliveryEnd =
    | { status: "skipped"; reason: NotificationDeliverySkipReason }
    | { status: "failed"; reason: NotificationDeliveryErrorCode }
    | { status: "expired" };

/** What a test send runs, once its checks passed. */
interface CheckedTest {
    channel: Channel;
    template: string | undefined;
    channelSettings: Record<string, string>;
}

/** What an attempt sends, once its checks passed. */
interface CheckedAttempt extends CheckedTest {
    notification: BNotification;
    isSensitive: boolean;
}

/** A built-in notice of a channel that stops, or of the forwarding of this instance. */
export interface ChannelNotice {
    id: string;
    title: string;
    description: string;
    link: string;
}

/** The built-in notices that the forwarder raises and dismisses. */
export interface NoticePort {
    raise(notice: ChannelNotice): void;
    dismiss(id: string): void;
    /** Whether the notice has a current generation. */
    isShown(id: string): boolean;
    /** The newest time of a stored or erased generation of the notice. */
    getNewestTime(id: string): number | null;
}

export interface ForwarderTransport {
    send(message: WebSocketMessage): void;
    /** The clients connected to this backend. */
    getClientCount(): number;
}

export interface ForwarderDependencies {
    record: DeliveryRecord;
    transport: ForwarderTransport;
    notices: NoticePort;
    /** When this instance last applied a batch of sync, in milliseconds. */
    getLastSyncedBatchTime(): number;
}

/** What the last attempt of a channel did, for its status. */
interface ChannelRun {
    lastInvokedAtMs?: number;
    lastCompletedAtMs?: number;
    durationMs?: number;
    lastErrorCode?: NotificationDeliveryErrorCode;
    lastHttpStatus?: number;
}

/**
 * Whether this instance runs the backend channels: one that has no sync server host set at all,
 * the sync server of a cluster or the only instance.
 */
export function isForwardingInstance() {
    return !getSyncServerHost();
}

/**
 * Why no channel runs on this instance: safe mode, the configuration switch, or a sync server host
 * overridden as `disabled`, the documented way to run a copy of production data.
 */
export function getChannelsOff(): NotificationChannelsOff | null {
    if (getPlatform().getEnv("TRILIUM_SAFE_MODE")) {
        return "safe-mode";
    }
    if (config.Notifications?.channelsDisabled) {
        return "configuration";
    }
    return getSyncServerHost() === "disabled" ? "sync-disabled" : null;
}

/** The high-water mark of the entity change IDs, which no deletion lowers. */
export function getEntityChangeMark() {
    return getSql().getValue<number | null>(
        "SELECT seq FROM sqlite_sequence WHERE name = 'entity_changes'") ?? 0;
}

export default class NotificationForwarder {

    readonly record: DeliveryRecord;
    private readonly transport: ForwarderTransport;
    private readonly notices: NoticePort;
    private readonly getLastSyncedBatchTime: () => number;
    /** The causes of a pause from the moment this instance took them. */
    private readonly pauseCauses = new Set<NotificationPauseCause>();
    /** The channels whose send has not settled, with the delivery that it runs. */
    private readonly running = new Map<string, { deliveryKey: string; startedAtMs: number }>();
    /** The channels that a receiver asked to wait, until when. */
    private readonly heldUntil = new Map<string, number>();
    /** The first attempts of each channel in the last hour, with their producers. */
    private readonly sends = new Map<string, { atMs: number; producer: string }[]>();
    /** The producers in the order in which they last had a place of the common share. */
    private readonly lastShareAt = new Map<string, number>();
    /** The channels whose budget has no free place, until the oldest send of the hour leaves it. */
    private readonly budgetHeldUntil = new Map<string, number>();
    /** Sent deliveries whose end the record does not hold yet: this process sends none again. */
    private readonly unrecordedEnds = new Map<string, Delivery>();
    /** The grants of claims that failed on this side, released before the next announcement. */
    private readonly failedClaims = new Map<string, string[]>();
    private readonly runs = new Map<string, ChannelRun>();
    private readonly rates = new Map<string, number[]>();
    private readonly waitingForBudget = new Map<string, number>();
    private readonly raisedNotices = new Set<string>();
    /** The highest sync cursor that paused forwarding, which a confirmation covers. */
    private highestCursor = 0;
    /** When due deliveries began to wait for the instance to settle. */
    private settleWaitSinceMs: number | null = null;
    private isStarted = false;
    private isSubscribed = false;
    private dueTimer: ReturnType<typeof setTimeout> | null = null;
    private recordTimer: ReturnType<typeof setTimeout> | null = null;
    private checkTimer: ReturnType<typeof setTimeout> | null = null;
    /** Whether a channel record changed since the record was last written. */
    private isMarkDue = false;
    private unsubscribeAddresses: (() => void) | null = null;

    constructor(dependencies: ForwarderDependencies) {
        this.record = dependencies.record;
        this.transport = dependencies.transport;
        this.notices = dependencies.notices;
        this.getLastSyncedBatchTime = dependencies.getLastSyncedBatchTime;
    }

    /**
     * Loads the types of channel and the delivery record, takes the pause that a restore or a move
     * left, takes what the database holds beyond the record, scans and arms the timer.
     */
    async start() {
        if (this.isStarted) {
            return;
        }

        this.isStarted = true;
        this.subscribe();
        await loadChannelTypes();
        await this.openRecord();
    }

    /** Stops the timers and the listeners. Deliveries and the record stay as they are. */
    stop() {
        this.isStarted = false;
        for (const timer of [ this.dueTimer, this.recordTimer, this.checkTimer ]) {
            if (timer !== null) {
                clearTimeout(timer);
            }
        }
        this.dueTimer = this.recordTimer = this.checkTimer = null;
        this.unsubscribeAddresses?.();
        this.unsubscribeAddresses = null;
        this.pauseCauses.clear();
        this.running.clear();
        this.heldUntil.clear();
        this.sends.clear();
        this.lastShareAt.clear();
        this.budgetHeldUntil.clear();
        this.unrecordedEnds.clear();
        this.failedClaims.clear();
        this.runs.clear();
        this.rates.clear();
        this.waitingForBudget.clear();
        this.raisedNotices.clear();
        this.highestCursor = 0;
        this.settleWaitSinceMs = null;
        this.isMarkDue = false;
    }

    /** The causes of the pause, of the record and of this process. */
    getPauseCauses(): NotificationPauseCause[] {
        const causes = new Set(this.pauseCauses);
        for (const cause of this.record.getState()?.pause?.causes ?? []) {
            causes.add(cause);
        }
        return [ ...causes ];
    }

    getPauseSince(): number | null {
        const sinceMs = this.record.getState()?.pause?.sinceMs;
        return sinceMs ?? (this.pauseCauses.size > 0 ? Date.now() : null);
    }

    isPaused() {
        return this.pauseCauses.size > 0 || !!this.record.getState()?.pause;
    }

    /** Waiting deliveries of a channel that wait for a free place of its budget. */
    getWaitingForBudget(channelId: string) {
        return this.waitingForBudget.get(channelId) ?? 0;
    }

    /** Since when the send of a channel has run without settling. */
    getRunningSince(channelId: string) {
        return this.running.get(channelId)?.startedAtMs ?? null;
    }

    /**
     * Writes the deliveries of a `high` generation that is younger than 23 hours, one for each
     * channel that runs here, unless the record holds it as ended. Runs inside the transaction
     * that stored the generation.
     */
    onGenerationStored(notificationId: string) {
        if (!this.isStarted || this.isPaused() || !this.record.getState()) {
            return;
        }

        const notification = store.getNotification(notificationId);
        if (notification?.attentionLevel === "high") {
            this.writeDeliveries([ notification ], Date.now());
            this.armDueTimer();
        }
    }

    /**
     * Writes the deliveries that are missing for the `high` generations of the last 23 hours, as at
     * start, when a channel comes on and when a pause ends.
     */
    scan() {
        if (!this.isStarted || this.isPaused() || !this.record.getState()) {
            return;
        }

        const nowMs = Date.now();
        const context = store.getViewContext(nowMs);
        const notifications = store.getStoredNotifications().filter((notification) =>
            notification.attentionLevel === "high" && isShownRow(notification, context));
        this.writeDeliveries(notifications, nowMs);
        this.armDueTimer();
    }

    /**
     * Ends the pause that the user confirmed. The scan of a start runs first, and with the choice
     * to skip, each delivery that waits and each one that the scan finds missing ends as skipped,
     * in the ledger and in the record. Once the record no longer holds the pause, forwarding opens
     * with a second scan.
     *
     * @throws NotificationError `record` when the record cannot be written.
     */
    async resume(sendDue: boolean) {
        const confirmed = this.getPauseCauses();
        if (confirmed.length === 0) {
            return;
        }

        const nowMs = Date.now();
        const result = await this.record.run((draft) => {
            const found = cls.init(() => this.findMissingDeliveries(nowMs));
            const waiting = ledger.getOpenDeliveries().map(({ deliveryKey }) => deliveryKey);
            const owed = [ ...waiting, ...found.map(({ deliveryKey }) => deliveryKey) ];
            if (!sendDue) {
                for (const deliveryKey of owed) {
                    const entry = getEntry(draft, deliveryKey, nowMs);
                    entry.endedAtMs ??= nowMs;
                    entry.endedAs ??= "skipped";
                }
            }
            if (confirmed.includes("move")) {
                cls.init(() => this.takeDatabase(draft, true));
            }
            if (confirmed.includes("rollback")) {
                draft.confirmedCursor = {
                    cursor: this.highestCursor,
                    untilMs: nowMs + CONFIRMED_CURSOR_MS
                };
            }
            const causes = (draft.pause?.causes ?? [])
                .filter((cause) => !confirmed.includes(cause));
            draft.pause = causes.length > 0 && draft.pause ? { ...draft.pause, causes } : null;
            return { owed, found };
        });
        if (!result.isWritten || !result.value) {
            throw new NotificationError("internal");
        }

        const { owed, found } = result.value;
        for (const cause of confirmed) {
            if (!this.record.getState()?.pause?.causes.includes(cause)) {
                this.pauseCauses.delete(cause);
            }
        }
        this.runTimed("resume", () => getSql().transactional(() => {
            for (const delivery of found) {
                ledger.insertDelivery(delivery, nowMs);
            }
            if (!sendDue) {
                for (const deliveryKey of owed) {
                    ledger.finishDelivery(deliveryKey, "skipped", "resume", nowMs);
                }
            }
        }));
        if (!this.isPaused()) {
            this.dismissNotice(getInstanceNoticeId("paused"));
            this.runTimed("scan", () => this.scan());
        }
    }

    /**
     * Pauses forwarding for a cause: from now in this process, and in the record once it is
     * written.
     */
    async pauseFor(cause: NotificationPauseCause) {
        this.pauseCauses.add(cause);
        this.runTimed("notice", () => this.raiseNotice(getInstanceNoticeId("paused"),
            t("notifications.forwarding-paused-title"),
            t("notifications.forwarding-paused-description"), SETTINGS_LINK));
        const nowMs = Date.now();
        await this.record.run((draft) => {
            const causes = new Set(draft.pause?.causes ?? []);
            causes.add(cause);
            draft.pause = { causes: [ ...causes ], sinceMs: draft.pause?.sinceMs ?? nowMs };
        });
    }

    /**
     * Pauses forwarding when a sync client logs in with a pull cursor beyond the newest entity
     * change of this instance: the data directory was rolled back. A cursor that a confirmation
     * covered pauses nothing for 48 hours.
     */
    onSyncLogin(cursor: unknown) {
        if (!this.isStarted || !Number.isSafeInteger(cursor)) {
            return;
        }

        const newest = getSql().getValue<number>(
            "SELECT COALESCE(MAX(id), 0) FROM entity_changes WHERE isSynced = 1");
        const confirmed = this.record.getState()?.confirmedCursor;
        const isCovered = !!confirmed && (cursor as number) <= confirmed.cursor
            && Date.now() < confirmed.untilMs;
        if ((cursor as number) <= newest || isCovered) {
            return;
        }

        this.highestCursor = Math.max(this.highestCursor, cursor as number);
        void this.pauseFor("rollback");
    }

    /**
     * Takes a batch of sync into the record before it is applied: the switchings that the batch
     * will commit, by their sequences, the sequences of the rows that lose, the revocations and the
     * channels that end. The batch is applied in the synchronous step after the write, whether or
     * not the write succeeded.
     */
    async takeSyncBatch(entityChanges: EntityChangeRecord[], nowMs: number, apply: () => void) {
        const plan = this.isStarted
            ? this.runTimed("sync", () => planBatch(entityChanges, nowMs))
            : undefined;
        if (!plan || (plan.switchings.length === 0 && plan.seen.length === 0
            && plan.revocations.length === 0 && plan.ended.length === 0)) {
            apply();
            this.scheduleChecks();
            return;
        }

        await this.record.run((draft) => {
            for (const { channelId, sequence } of plan.seen) {
                seeSequence(draft, channelId, sequence);
            }
            for (const activationId of plan.revocations) {
                takeRevocation(draft, activationId);
            }
            for (const channelId of plan.ended) {
                endChannel(draft, channelId);
            }
        }, plan.switchings);
        apply();
        this.runTimed("status", () => {
            for (const { channelId } of plan.switchings) {
                this.writeRecordSequence(channelId);
            }
        });
        this.scheduleChecks();
    }

    /**
     * Enables a channel at its reviewed revision: the switching reaches the record first, then the
     * transaction writes the activation, and `writeActivation` builds the rest of the row.
     *
     * @returns whether the record holds the switching.
     */
    async switchOn(
        channelId: string,
        writeActivation: (activationId: string, sequence: number) => void
    ) {
        this.checkRate(`enable:${channelId}`, ENABLINGS_PER_HOUR, HOUR);
        const activationId = randomString(16);
        const sequence = this.getNextSequence();
        const result = await this.record.run(() => undefined,
            [ { channelId, activationId, sequence, isRevoked: false } ]);

        cls.init(() => getSql().transactional(() => writeActivation(activationId, sequence)));
        this.runTimed("notice",
            () => this.dismissNotice(getChannelNoticeId(channelId, "disabled")));
        this.afterSwitch(channelId);
        return result.isWritten;
    }

    /**
     * Disables a channel. Never refused: the record takes the switching and the revocation first,
     * then the transaction writes the cleared activation and the revocation.
     *
     * @returns whether the record holds the switching.
     */
    async switchOff(channelId: string, writeDisabling: (sequence: number) => void) {
        const activationId = getActivation(channelId)?.activationId ?? null;
        const sequence = this.getNextSequence();
        const result = await this.record.run((draft) => {
            if (activationId !== null) {
                takeRevocation(draft, activationId);
            }
        }, [ { channelId, activationId: null, sequence, isRevoked: true } ]);

        cls.init(() => getSql().transactional(() => writeDisabling(sequence)));
        if (activationId !== null && isForwardingInstance()) {
            this.runTimed("notice", () => this.raiseChannelNotice(channelId, "disabled"));
        }
        this.afterSwitch(channelId);
        return result.isWritten;
    }

    /** What the record holds of an enabled channel, for its card. */
    getRecordHold(channelId: string, activationId: string) {
        if (this.record.isPending(channelId)) {
            return "pending";
        }
        if (this.record.isLive(channelId, activationId)) {
            return "live";
        }
        const state = this.record.getState();
        return state && state.channels.size >= 1000 && !state.channels.has(channelId)
            ? "full"
            : "missing";
    }

    /** @throws NotificationError `rate-limit` past ten changes of the settings in an hour. */
    checkSettingsRate(activationId: string) {
        this.checkRate(`settings:${activationId}`, SETTINGS_CHANGES_PER_HOUR, HOUR);
    }

    /**
     * Sends a made-up notification through a backend channel, under the checks of a delivery.
     *
     * @returns the code of the outcome, and for a script's error its message.
     */
    async sendTest(channelId: string): Promise<{ code: string; diagnostic?: string }> {
        this.checkRate(`test:${channelId}`, TEST_SENDS_PER_MINUTE, MINUTE);
        const nowMs = Date.now();
        const checked = this.runTimed("test", () => this.checkTest(channelId));
        if (!checked || "end" in checked) {
            return { code: checked?.end ?? "disabled" };
        }

        const payload: NotificationChannelPayload = {
            key: `test-${randomString(16)}`,
            title: t("notifications.payload-title-general"),
            category: "general",
            attentionLevel: "high",
            raisedAt: formatUtcDateTime(nowMs)
        };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
        try {
            const delivery = { key: payload.key, attempt: 1, signal: controller.signal };
            await this.startSend(checked.channel, checked.template, payload, delivery,
                checked.channelSettings);
            return { code: "sent" };
        } catch (e) {
            const code = toErrorCode(e, checked.channel, controller.signal);
            if (code !== "script-error") {
                return { code };
            }
            const message = e instanceof Error ? e.message : String(e);
            return { code, diagnostic: message.substring(0, 1000) };
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * A tab asks for a frontend delivery that was announced. It is granted once per browser
     * profile, and at most to 16 profiles, after the checks of an attempt; the grant reaches the
     * record before the answer, and the checks run again after the write.
     */
    async claim(
        deliveryKey: string,
        profileId: string
    ): Promise<NotificationDeliveryClaimResponse> {
        const refused = { granted: false };
        if (!this.isStarted || this.isPaused() || !this.record.getState()) {
            return refused;
        }

        const nowMs = Date.now();
        const delivery = ledger.getDelivery(deliveryKey);
        if (!delivery || delivery.status !== "announced") {
            return refused;
        }
        const first = this.runTimed("claim", () => this.checkDelivery(delivery, nowMs));
        if (!first || "end" in first) {
            this.endIfDecided(delivery, first);
            return refused;
        }

        const claimId = randomString(16);
        const isPublic = first.isSensitive;
        const result = await this.record.run((draft) => {
            const entry = getEntry(draft, deliveryKey, nowMs);
            if (entry.endedAtMs !== undefined
                || entry.grants.length >= NOTIFICATION_FRONTEND_MAX_PROFILES
                || entry.grants.some((grant) => grant.profileId === profileId)) {
                return false;
            }
            entry.grants.push({ profileId, claimId, atMs: nowMs, isPublic });
            if (isPublic) {
                entry.publicAtMs ??= nowMs;
            }
            return true;
        });
        if (!result.isWritten) {
            this.scheduleAnnouncement(delivery, claimId);
            return refused;
        }
        if (!result.value) {
            return refused;
        }

        const answer = this.runTimed("claim",
            () => this.answerClaim(delivery, profileId, isPublic));
        if (answer && answer.granted) {
            return answer;
        }
        if (!answer) {
            // The payload could not be built: the grant is released and the tabs claim again.
            this.scheduleAnnouncement(delivery, claimId);
        } else {
            void this.releaseGrant(deliveryKey, claimId);
        }
        return refused;
    }

    /** The outcome of a granted run in a tab. The first result ends the delivery. */
    reportResult(
        deliveryKey: string,
        profileId: string,
        errorCode?: NotificationDeliveryErrorCode
    ) {
        const delivery = ledger.getDelivery(deliveryKey);
        const grants = this.record.getState()?.entries.get(deliveryKey)?.grants ?? [];
        if (!delivery || !grants.some((grant) => grant.profileId === profileId)) {
            throw new NotificationError("not-found");
        }

        const nowMs = Date.now();
        if (delivery.status === "announced") {
            if (errorCode) {
                ledger.finishDelivery(deliveryKey, "failed", errorCode, nowMs);
            } else {
                ledger.finishDelivery(deliveryKey, "sent", null, nowMs);
                if (grants.some((grant) => grant.isPublic)) {
                    ledger.markPublicOnly(deliveryKey);
                }
            }
        }
    }

    /**
     * Writes the highest sequence of the record into the status of a channel, so that the next
     * enabling from any device that has synced passes here. The forwarding instance only.
     */
    writeRecordSequence(channelId: string) {
        if (!isForwardingInstance() || !isChannelHeld(channelId)) {
            return;
        }
        this.writeChannelStatus(channelId);
    }

    private subscribe() {
        if (this.isSubscribed) {
            return;
        }

        this.isSubscribed = true;
        events.subscribe(events.ENTITY_CHANGED, ({ entityName, entity }) => {
            if (entityName === "notifications" && this.isStarted) {
                this.runListener(() => this.onGenerationStored(
                    (entity as BNotification).notificationId));
            }
            this.onEntityChange(entityName);
        });
        events.subscribe(events.ENTITY_CHANGE_SYNCED, ({ entityName, entityRow }) => {
            if (entityName === "notifications" && this.isStarted) {
                this.runListener(() => this.onGenerationStored(
                    (entityRow as { notificationId: string }).notificationId));
            }
            this.onEntityChange(entityName);
        });
        events.subscribe(events.ENTITY_DELETED,
            ({ entityName }) => this.onEntityChange(entityName));
        events.subscribe(events.ENTITY_DELETE_SYNCED, ({ entityName }) =>
            this.onEntityChange(entityName));
        this.unsubscribeAddresses = onAddressChanged((channelId) =>
            this.runTimed("address", () => this.reconcileAddress(channelId)));
    }

    private onEntityChange(entityName: string) {
        if (!this.isStarted || !CHECKED_ENTITIES.has(entityName)) {
            return;
        }
        if (entityName === "notification_channel_records") {
            this.isMarkDue = true;
        }
        this.scheduleChecks();
    }

    /** Reads the record, retrying every minute while it cannot be read, and opens forwarding. */
    private async openRecord() {
        if (!this.isStarted) {
            return;
        }

        if (!await this.record.load()) {
            this.runTimed("notice", () => {
                this.raiseNotice(getInstanceNoticeId("record"),
                    t("notifications.forwarding-record-title"),
                    t("notifications.forwarding-record-description"), SETTINGS_LINK);
                for (const channel of getChannels()) {
                    if (channel.runsOn === "backend") {
                        this.writeChannelStatus(channel.channelId, { lastErrorCode: "record" });
                    }
                }
            });
            this.recordTimer = setTimeout(() => {
                this.recordTimer = null;
                void this.openRecord();
            }, RECORD_RETRY_MS);
            return;
        }
        this.runTimed("notice", () => this.dismissNotice(getInstanceNoticeId("record")));

        const state = this.record.getState();
        const causes: NotificationPauseCause[] = [];
        if (this.record.wasMissing()) {
            if (this.runTimed("start", () => holdsDeliveryState())) {
                causes.push("move");
            }
        } else if (state && getEntityChangeMark() < state.mark) {
            causes.push("restore");
        }
        for (const cause of causes) {
            this.pauseCauses.add(cause);
        }

        const nowMs = Date.now();
        const isMissing = this.record.wasMissing();
        await this.record.run((draft) => {
            if (causes.length > 0) {
                const merged = new Set([ ...draft.pause?.causes ?? [], ...causes ]);
                draft.pause = { causes: [ ...merged ], sinceMs: draft.pause?.sinceMs ?? nowMs };
            }
            if (!isMissing) {
                cls.init(() => this.takeDatabase(draft, false));
            }
            dropOldEntries(draft, nowMs);
        });
        if (this.isPaused()) {
            this.runTimed("notice", () => this.raiseNotice(getInstanceNoticeId("paused"),
                t("notifications.forwarding-paused-title"),
                t("notifications.forwarding-paused-description"), SETTINGS_LINK));
        }

        this.runTimed("start", () => {
            for (const channel of getChannels()) {
                this.reconcileAddress(channel.channelId);
            }
            this.scan();
        });
        this.scheduleChecks();
        this.armDueTimer();
        this.armPendingRetry();
    }

    /**
     * Takes into the record what the database holds beyond it: an activation numbered above its
     * entry, or above the floor, is a switching that reached the database and not the record. An
     * activation that a revocation names, or whose channel is gone, is live no longer. With
     * `isConfirmation`, the activations that no revocation names join whatever their sequence.
     */
    private takeDatabase(draft: RecordState, isConfirmation: boolean) {
        for (const { channelId, content } of getRecords("activation")) {
            const isHeld = isChannelHeld(channelId);
            const revoked = content.activationId !== null && isRevoked(content.activationId);
            if (!isHeld) {
                endChannel(draft, channelId);
                continue;
            }
            takeSwitching(draft, toSwitching(channelId, content, revoked));
            if (revoked && content.activationId !== null) {
                takeRevocation(draft, content.activationId);
            }
        }
    }

    /** The deliveries that the generations of the last 23 hours owe and that the ledger lacks. */
    private findMissingDeliveries(nowMs: number) {
        const context = store.getViewContext(nowMs);
        const found: Parameters<typeof ledger.insertDelivery>[0][] = [];
        const channels = this.getActiveChannels(true);
        for (const notification of store.getStoredNotifications()) {
            if (notification.attentionLevel !== "high" || !isShownRow(notification, context)
                || !isWithinDeadline(notification.notificationId, nowMs)) {
                continue;
            }
            for (const active of channels) {
                const delivery = this.toDelivery(notification, active);
                const entry = this.record.getState()?.entries.get(delivery.deliveryKey);
                if (!ledger.getDelivery(delivery.deliveryKey) && entry?.endedAtMs === undefined) {
                    found.push(delivery);
                }
            }
        }
        return found;
    }

    private writeDeliveries(notifications: BNotification[], nowMs: number) {
        const candidates = notifications.filter((notification) =>
            notification.attentionLevel === "high"
            && isWithinDeadline(notification.notificationId, nowMs)
            && !isDatedAhead(getTimeOfNotificationId(notification.notificationId), nowMs));
        if (candidates.length === 0) {
            return;
        }

        const channels = this.getActiveChannels(false);
        const entries = this.record.getState()?.entries;
        for (const notification of candidates) {
            for (const active of channels) {
                const delivery = this.toDelivery(notification, active);
                if (entries?.get(delivery.deliveryKey)?.endedAtMs === undefined) {
                    ledger.insertDelivery(delivery, nowMs);
                }
            }
        }
    }

    private toDelivery(notification: BNotification, active: ActiveChannel) {
        const timeMs = getTimeOfNotificationId(notification.notificationId);
        return {
            deliveryKey: getDeliveryKey(notification.id, notification.raisedAt,
                active.channel.channelId),
            notificationId: notification.notificationId,
            channelId: active.channel.channelId,
            activationId: active.activation.activationId ?? "",
            revision: active.activation.revision ?? "",
            configurationId: active.channel.definition?.configurationId ?? null,
            graceTime: active.graceTime,
            dueAtMs: timeMs + active.graceTime * SECOND
        };
    }

    /**
     * The channels that run here: not off, a backend one on the forwarding instance only, with a
     * live activation that the record holds as live. With `isTakingDatabase`, during a
     * confirmation, the record's hold is not asked: the confirmation takes those activations.
     */
    private getActiveChannels(isTakingDatabase: boolean): ActiveChannel[] {
        if (getChannelsOff()) {
            return [];
        }

        const isForwarding = isForwardingInstance();
        const active: ActiveChannel[] = [];
        for (const channel of getChannels()) {
            if (channel.runsOn === "backend" && !isForwarding) {
                continue;
            }
            const held = getHeldSettings(channel.channelId);
            const activation = getActivation(channel.channelId);
            const isLive = !!held && this.record.isLive(channel.channelId, held.activationId);
            if (!held || !activation || (!isTakingDatabase && !isLive)) {
                continue;
            }
            active.push({ channel, activation, graceTime: held.settings.graceTime });
        }
        return active;
    }

    private armDueTimer() {
        if (!this.isStarted) {
            return;
        }
        if (this.dueTimer !== null) {
            clearTimeout(this.dueTimer);
            this.dueTimer = null;
        }

        const nowMs = Date.now();
        let nextMs = nowMs + DUE_TIMER_MAX_MS;
        const open = this.runTimed("due", () => ledger.getOpenDeliveries()) ?? [];
        for (const delivery of open) {
            const deadlineMs = getTimeOfNotificationId(delivery.notificationId)
                + NOTIFICATION_DELIVERY_DEADLINE_MS;
            const isHeld = this.running.has(delivery.channelId)
                || this.unrecordedEnds.has(delivery.deliveryKey);
            const dueMs = isHeld ? null : this.getNextTime(delivery);
            nextMs = Math.min(nextMs, deadlineMs, dueMs ?? deadlineMs);
        }
        const aheadMs = this.runTimed("due", () => store.getEarliestTimeAhead(nowMs));
        if (aheadMs !== null && aheadMs !== undefined) {
            nextMs = Math.min(nextMs, aheadMs - HOUR);
        }
        this.dueTimer = setTimeout(() => this.processDue(), Math.max(0, nextMs - nowMs));
    }

    private getDueAt(delivery: Delivery) {
        return Math.max(delivery.dueAtMs, delivery.nextAttemptAtMs ?? 0,
            this.heldUntil.get(delivery.channelId) ?? 0);
    }

    /**
     * When a delivery next needs the forwarder: its due time, after a free place of its channel's
     * budget for a first attempt, or for one announced to the tabs the time of a new announcement,
     * `null` without one.
     */
    private getNextTime(delivery: Delivery) {
        if (delivery.status === "announced") {
            return delivery.nextAttemptAtMs;
        }
        const budgetMs = delivery.attempts === 0 ? this.budgetHeldUntil.get(delivery.channelId) : 0;
        return Math.max(this.getDueAt(delivery), budgetMs ?? 0);
    }

    /** Ends the deliveries past their deadline and starts what is due, at most one per channel. */
    private processDue() {
        this.dueTimer = null;
        if (!this.isStarted) {
            return;
        }

        const nowMs = Date.now();
        if (this.isPaused() || !this.record.getState()) {
            return;
        }
        const quietMs = nowMs - this.getLastSyncedBatchTime();
        if (quietMs < SETTLE_MS) {
            this.settleWaitSinceMs ??= nowMs;
            const waitedMs = nowMs - this.settleWaitSinceMs;
            if (waitedMs < SETTLE_LIMIT_MS) {
                const delayMs = Math.min(SETTLE_MS - quietMs, SETTLE_LIMIT_MS - waitedMs);
                this.dueTimer = setTimeout(() => this.processDue(), delayMs);
                return;
            }
        }
        this.settleWaitSinceMs = null;

        this.runTimed("due", () => {
            this.scan();
            ledger.purgeFinished(nowMs);
            const due = new Map<string, Delivery[]>();
            for (const delivery of ledger.getOpenDeliveries()) {
                if (!isWithinDeadline(delivery.notificationId, nowMs)) {
                    ledger.finishDelivery(delivery.deliveryKey, "expired", null, nowMs);
                } else if ((this.getNextTime(delivery) ?? Infinity) <= nowMs
                    && !this.running.has(delivery.channelId)
                    && !this.unrecordedEnds.has(delivery.deliveryKey)) {
                    due.set(delivery.channelId, [ ...due.get(delivery.channelId) ?? [], delivery ]);
                }
            }
            this.waitingForBudget.clear();
            for (const [ channelId, deliveries ] of due) {
                this.startNext(channelId, deliveries, nowMs);
            }
        });
        void this.recordUnrecordedEnds();
        this.armDueTimer();
    }

    /** Starts the next delivery of a channel that its budget allows. */
    private startNext(channelId: string, deliveries: Delivery[], nowMs: number) {
        const announced = deliveries.filter(({ status }) => status === "announced");
        for (const delivery of announced) {
            void this.announceAgain(delivery);
        }

        const waiting = deliveries.filter(({ status }) => status === "waiting");
        const picked = this.pickWithinBudget(channelId, waiting, nowMs);
        if (!picked) {
            return;
        }

        if (getChannel(channelId)?.runsOn === "frontend") {
            this.announce(picked, nowMs);
            // The next waiting delivery of the channel is picked at once, within the budget.
            this.armDueTimer();
            return;
        }
        void this.attempt(picked);
    }

    /**
     * The delivery that a channel starts next: a built-in producer's first, then of the producers
     * that are not built in the one whose turn of the common share comes first, each with its
     * oldest delivery. A retry draws nothing from the budget.
     */
    private pickWithinBudget(channelId: string, deliveries: Delivery[], nowMs: number) {
        const sends = (this.sends.get(channelId) ?? []).filter(({ atMs }) => nowMs - atMs < HOUR);
        this.sends.set(channelId, sends);
        const retry = deliveries.find(({ attempts }) => attempts > 0);
        if (retry) {
            return retry;
        }

        const producerOf = (delivery: Delivery) =>
            store.getNotification(delivery.notificationId)?.producer ?? "client";
        const isOver = (producer: string) => {
            if (sends.length >= CHANNEL_BUDGET) {
                return true;
            }
            if (isBuiltInNotificationProducer(producer)) {
                return false;
            }
            const others = sends.filter((send) => !isBuiltInNotificationProducer(send.producer));
            return others.length >= COMMON_SHARE
                || others.filter((send) => send.producer === producer).length >= PRODUCER_SHARE;
        };

        const candidates = deliveries.map((delivery) =>
            ({ delivery, producer: producerOf(delivery) }));
        const builtIn = candidates.find(({ producer }) =>
            isBuiltInNotificationProducer(producer) && !isOver(producer));
        let picked = builtIn ?? null;
        if (!picked) {
            const firstByProducer = new Map<string, (typeof candidates)[number]>();
            for (const candidate of candidates) {
                if (!firstByProducer.has(candidate.producer) && !isOver(candidate.producer)) {
                    firstByProducer.set(candidate.producer, candidate);
                }
            }
            const turnOf = (producer: string) => this.lastShareAt.get(producer) ?? 0;
            picked = [ ...firstByProducer.values() ]
                .sort((a, b) => turnOf(a.producer) - turnOf(b.producer))[0] ?? null;
        }

        this.waitingForBudget.set(channelId, deliveries.length - (picked ? 1 : 0));
        if (!picked) {
            const oldestMs = Math.min(...sends.map(({ atMs }) => atMs));
            this.budgetHeldUntil.set(channelId, oldestMs + HOUR);
            return null;
        }
        this.budgetHeldUntil.delete(channelId);
        sends.push({ atMs: nowMs, producer: picked.producer });
        this.lastShareAt.set(picked.producer, nowMs);
        return picked.delivery;
    }

    /** Announces a frontend delivery to the tabs, or skips it when no client is connected. */
    private announce(delivery: Delivery, nowMs: number) {
        const checked = this.checkDelivery(delivery, nowMs);
        if ("end" in checked) {
            this.endIfDecided(delivery, checked);
            return;
        }
        if (this.transport.getClientCount() === 0) {
            ledger.finishDelivery(delivery.deliveryKey, "skipped", "no-client", nowMs);
            return;
        }
        ledger.markAnnounced(delivery.deliveryKey, null);
        this.transport.send({
            type: "notification-forward",
            deliveryKey: delivery.deliveryKey,
            channelId: delivery.channelId
        });
    }

    /**
     * Announces a delivery again after a claim failed on this side: the grants that the failed
     * claims left are released first, and when that fails, the next time is tried instead.
     */
    private async announceAgain(delivery: Delivery) {
        const claimIds = this.failedClaims.get(delivery.deliveryKey) ?? [];
        if (claimIds.length > 0) {
            const result = await this.record.run((draft) => {
                const entry = draft.entries.get(delivery.deliveryKey);
                if (entry) {
                    entry.grants = entry.grants
                        .filter((grant) => !claimIds.includes(grant.claimId));
                }
            });
            if (!result.isWritten) {
                this.runTimed("announce", () => this.scheduleNextAnnouncement(delivery));
                return;
            }
            this.failedClaims.delete(delivery.deliveryKey);
        }
        this.runTimed("announce", () => {
            ledger.markAnnounced(delivery.deliveryKey, null);
            this.announce({ ...delivery, status: "waiting" }, Date.now());
        });
    }

    private scheduleAnnouncement(delivery: Delivery, claimId: string) {
        this.failedClaims.set(delivery.deliveryKey,
            [ ...this.failedClaims.get(delivery.deliveryKey) ?? [], claimId ]);
        this.runTimed("announce", () => this.scheduleNextAnnouncement(delivery));
    }

    private scheduleNextAnnouncement(delivery: Delivery) {
        const current = ledger.getDelivery(delivery.deliveryKey);
        const failures = this.failedClaims.get(delivery.deliveryKey)?.length ?? 1;
        const delayMs = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length) - 1];
        if (current?.status === "announced") {
            ledger.markAnnounced(delivery.deliveryKey, Date.now() + delayMs);
        }
        this.armDueTimer();
    }

    private async releaseGrant(deliveryKey: string, claimId: string) {
        await this.record.run((draft) => {
            const entry = draft.entries.get(deliveryKey);
            if (entry) {
                entry.grants = entry.grants.filter((grant) => grant.claimId !== claimId);
            }
        });
    }

    /** The answer of a claim after its grant was written, or `null` when building it failed. */
    private answerClaim(
        delivery: Delivery,
        profileId: string,
        isPublic: boolean
    ): NotificationDeliveryClaimResponse | null {
        const nowMs = Date.now();
        if (this.isPaused()) {
            return { granted: false };
        }
        const checked = this.checkDelivery(delivery, nowMs);
        if ("end" in checked || (checked.isSensitive && !isPublic)) {
            this.endIfDecided(delivery, checked);
            return { granted: false };
        }

        try {
            const current = getCurrentRevision(checked.channel);
            const bundle = current.collected
                ? getFrontendBundle(current.collected, "script")
                : null;
            if (!bundle) {
                return null;
            }
            const { payload } = buildPayload(checked.notification, delivery.deliveryKey,
                store.getViewContext(nowMs), isPublic);
            ledger.addProfile(delivery.deliveryKey, profileId);
            return {
                granted: true,
                bundle,
                payload,
                attempt: 1,
                channelSettings: checked.channelSettings
            };
        } catch {
            return null;
        }
    }

    /**
     * One attempt of a backend delivery. A public payload reaches the record before it is handed
     * over, the checks run again after each write in the step that starts the send, and the channel
     * takes no other attempt until the send settles.
     */
    private async attempt(delivery: Delivery) {
        const { channelId, deliveryKey } = delivery;
        const startedAtMs = Date.now();
        this.running.set(channelId, { deliveryKey, startedAtMs });
        const run: ChannelRun = { lastInvokedAtMs: startedAtMs };
        const attempt = delivery.attempts + 1;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
            let started: StartedSend | null = null;
            for (let pass = 0; pass < 2 && !started; pass++) {
                const step = this.runTimed("attempt", () => this.startAttempt(delivery, attempt,
                    controller.signal));
                if (!step || "done" in step) {
                    return;
                }
                if ("needsPublic" in step) {
                    const written = await this.record.run((draft) => {
                        getEntry(draft, deliveryKey, Date.now()).publicAtMs ??= Date.now();
                    });
                    if (!written.isWritten) {
                        this.runTimed("attempt",
                            () => this.failAttempt(delivery, attempt, "record", run));
                        return;
                    }
                    continue;
                }
                started = step;
            }
            if (!started) {
                return;
            }

            timer = setTimeout(() => {
                controller.abort();
                run.lastErrorCode = "timeout";
                this.runTimed("status", () => this.writeChannelStatus(channelId, run));
            }, ATTEMPT_TIMEOUT_MS);
            try {
                await started.promise;
            } catch (e) {
                const code = toErrorCode(e, started.channel, controller.signal);
                if (e instanceof ChannelSendError) {
                    run.lastHttpStatus = e.details.httpStatus;
                    if (e.details.retryAfterMs !== undefined) {
                        this.heldUntil.set(channelId,
                            Date.now() + Math.min(e.details.retryAfterMs, RETRY_AFTER_MAX_MS));
                    }
                }
                this.runTimed("attempt", () => this.failAttempt(delivery, attempt, code, run));
                return;
            }

            run.lastErrorCode = undefined;
            const isPublic = started.isPublic;
            await this.recordSent({ ...delivery, isPublicOnly: isPublic }, run);
        } finally {
            if (timer !== null) {
                clearTimeout(timer);
            }
            this.running.delete(channelId);
            this.armDueTimer();
        }
    }

    /**
     * The synchronous step that starts a send: the checks, the payload and the call. Asks for the
     * public fact to be written first when the payload must carry the public text alone and the
     * record does not hold that yet.
     */
    private startAttempt(delivery: Delivery, attempt: number, signal: AbortSignal):
        | { done: true }
        | { needsPublic: true }
        | { promise: Promise<unknown>; channel: Channel; isPublic: boolean } {
        const nowMs = Date.now();
        if (this.isPaused() || !this.record.getState()) {
            return { done: true };
        }
        const checked = this.checkDelivery(delivery, nowMs);
        if ("end" in checked) {
            this.endIfDecided(delivery, checked);
            return { done: true };
        }

        const entry = this.record.getState()?.entries.get(delivery.deliveryKey);
        if (checked.isSensitive && entry?.publicAtMs === undefined) {
            return { needsPublic: true };
        }

        const { payload } = buildPayload(checked.notification, delivery.deliveryKey,
            store.getViewContext(nowMs), entry?.publicAtMs !== undefined);
        ledger.recordAttempt(delivery.deliveryKey, attempt, null, null);
        const promise = this.startSend(checked.channel, checked.template, payload,
            { key: delivery.deliveryKey, attempt, signal }, checked.channelSettings);
        return { promise, channel: checked.channel, isPublic: entry?.publicAtMs !== undefined };
    }

    /** Starts the send of a channel: a built-in type's, or the bundle of a backend script. */
    private startSend(
        channel: Channel,
        template: string | undefined,
        payload: NotificationChannelPayload,
        delivery: { key: string; attempt: number; signal: AbortSignal },
        channelSettings: Record<string, string>
    ): Promise<unknown> {
        if (channel.type) {
            return channel.type.send({ channelId: channel.channelId, template, payload, delivery });
        }

        const current = getCurrentRevision(channel);
        if (!current.collected) {
            return Promise.reject(new ChannelSendError("policy"));
        }
        const bundle = getBackendBundle(current.collected);
        try {
            const result: unknown = cls.init(() => runBundle(bundle, {
                notification: payload,
                delivery,
                channelSettings
            }));
            return Promise.resolve(result).catch((e: unknown) => {
                throw new ScriptFailure(e);
            });
        } catch (e) {
            return Promise.reject(new ScriptFailure(e));
        }
    }

    /**
     * The checks before every attempt and every grant. A delivery ends when its generation is
     * erased or past its deadline, when the record holds it as ended, when its channel no longer
     * has the recorded activation, revision, address and template or the record does not hold
     * that activation as live, when the policy of the runtime does not let the channel run, when a
     * mark came before its first attempt, and when it is sensitive and the channel sends nothing
     * about protected notes.
     */
    private checkDelivery(
        delivery: Delivery,
        nowMs: number
    ): CheckedAttempt | { end: DeliveryEnd } {
        const notification = store.getNotification(delivery.notificationId);
        if (!notification || !isShownRow(notification, store.getViewContext(nowMs))) {
            return { end: { status: "skipped", reason: "erased" } };
        }
        if (!isWithinDeadline(delivery.notificationId, nowMs)) {
            return { end: { status: "expired" } };
        }
        const entry = this.record.getState()?.entries.get(delivery.deliveryKey);
        if (entry?.endedAtMs !== undefined) {
            return { end: entry.endedAs === "skipped"
                ? { status: "skipped", reason: "resume" }
                : { status: "skipped", reason: "disabled" } };
        }

        const channel = getChannel(delivery.channelId);
        const activation = channel ? getActivation(channel.channelId) : null;
        if (!channel || !activation || activation.activationId !== delivery.activationId
            || isRevoked(delivery.activationId)
            || !this.record.isLive(channel.channelId, delivery.activationId)) {
            return { end: { status: "skipped", reason: "disabled" } };
        }
        const check = this.checkChannel(channel, activation, delivery);
        if ("end" in check) {
            return check;
        }

        const held = getHeldSettings(channel.channelId);
        if (delivery.attempts === 0 && delivery.graceTime > 0
            && (store.hasMark(notification.notificationId, "seen")
                || store.hasMark(notification.notificationId, "read"))) {
            return { end: { status: "skipped", reason: "marked" } };
        }
        const isSensitive = entry?.publicAtMs !== undefined
            || isNotificationSensitive(notification, nowMs);
        if (isSensitive && held?.settings.protectedNotes !== "public") {
            return { end: { status: "skipped", reason: "protected" } };
        }
        return {
            notification,
            channel,
            isSensitive,
            template: check.template,
            channelSettings: getChannelSettings(activation)
        };
    }

    /** The checks of a channel's revision, address, template and policy. */
    private checkChannel(
        channel: Channel,
        activation: ActivationRecord,
        delivery: { revision: string; configurationId: string | null } | null
    ): { template: string | undefined } | { end: DeliveryEnd } {
        const revision = getCurrentRevision(channel).revision;
        const expectedRevision = delivery?.revision ?? activation.revision;
        if (revision === null || revision !== expectedRevision
            || revision !== activation.revision) {
            return { end: { status: "skipped", reason: "changed" } };
        }

        if (channel.kind === "built-in") {
            const type = channel.type;
            if (!type || !type.isAvailable()) {
                return { end: { status: "failed", reason: "policy" } };
            }
            const address = type.getAddressState(channel.channelId);
            const configurationId = delivery?.configurationId
                ?? channel.definition?.configurationId ?? null;
            if (!address || address.configurationId !== configurationId) {
                return { end: { status: "skipped", reason: "address" } };
            }
            const template = channel.definition?.config.template;
            if (hashTemplate(template) !== address.templateHash) {
                return { end: { status: "skipped", reason: "template" } };
            }
            return { template };
        }

        if (channel.runsOn === "backend" && !isScriptingEnabled()) {
            return { end: { status: "failed", reason: "policy" } };
        }
        return { template: undefined };
    }

    /** The checks of a test send, which has no delivery of the ledger. */
    private checkTest(channelId: string): CheckedTest | { end: string } {
        const channel = getChannel(channelId);
        const activation = channel ? getActivation(channelId) : null;
        if (!channel || !activation || activation.activationId === null
            || isRevoked(activation.activationId)) {
            return { end: "disabled" };
        }
        if (channel.runsOn === "frontend") {
            return { end: "policy" };
        }
        const check = this.checkChannel(channel, activation, null);
        if ("end" in check) {
            return { end: check.end.status === "expired" ? "expired" : check.end.reason };
        }
        return {
            channel,
            template: check.template,
            channelSettings: getChannelSettings(activation)
        };
    }

    private endIfDecided(
        delivery: Delivery,
        checked: CheckedAttempt | { end: DeliveryEnd } | undefined
    ) {
        if (!checked || !("end" in checked)) {
            return;
        }
        const { end } = checked;
        const nowMs = Date.now();
        if (end.status === "expired") {
            ledger.finishDelivery(delivery.deliveryKey, "expired", null, nowMs);
        } else {
            ledger.finishDelivery(delivery.deliveryKey, end.status, end.reason, nowMs);
        }
        if (getChannel(delivery.channelId)?.runsOn === "backend") {
            this.writeChannelStatus(delivery.channelId);
        }
    }

    /** Counts a failed attempt: a retry waits 1, 5 or 30 minutes; the fourth failure ends it. */
    private failAttempt(
        delivery: Delivery,
        attempt: number,
        code: NotificationDeliveryErrorCode,
        run: ChannelRun
    ) {
        const nowMs = Date.now();
        run.lastCompletedAtMs = nowMs;
        run.durationMs = nowMs - (run.lastInvokedAtMs ?? nowMs);
        run.lastErrorCode = code;
        const delayMs = code === "policy" ? undefined : RETRY_DELAYS_MS[attempt - 1];
        if (delayMs === undefined || !isWithinDeadline(delivery.notificationId, nowMs + delayMs)) {
            ledger.recordAttempt(delivery.deliveryKey, attempt, null, code);
            ledger.finishDelivery(delivery.deliveryKey, "failed", code, nowMs);
        } else {
            ledger.recordAttempt(delivery.deliveryKey, attempt, nowMs + delayMs, code);
        }
        this.writeChannelStatus(delivery.channelId, run);
    }

    /**
     * Ends a sent delivery: the record first, then the ledger. When the record is not written, this
     * process keeps the end in memory and sends the delivery no more.
     */
    private async recordSent(delivery: Delivery, run: ChannelRun) {
        const nowMs = Date.now();
        run.lastCompletedAtMs = nowMs;
        run.durationMs = nowMs - (run.lastInvokedAtMs ?? nowMs);
        const result = await this.record.run((draft) => {
            const entry = getEntry(draft, delivery.deliveryKey, nowMs);
            entry.endedAtMs ??= nowMs;
            entry.endedAs ??= "sent";
        });
        if (!result.isWritten) {
            this.unrecordedEnds.set(delivery.deliveryKey, delivery);
            return;
        }
        this.runTimed("sent", () => this.finishSent(delivery, run));
    }

    private finishSent(delivery: Delivery, run?: ChannelRun) {
        const nowMs = Date.now();
        if (delivery.isPublicOnly) {
            ledger.markPublicOnly(delivery.deliveryKey);
        }
        ledger.finishDelivery(delivery.deliveryKey, "sent", null, nowMs);
        this.unrecordedEnds.delete(delivery.deliveryKey);
        this.writeChannelStatus(delivery.channelId, run);
    }

    /** Writes the ends that the record does not hold yet, before the channel's next attempt. */
    private async recordUnrecordedEnds() {
        for (const delivery of [ ...this.unrecordedEnds.values() ]) {
            const result = await this.record.run((draft) => {
                const entry = getEntry(draft, delivery.deliveryKey, Date.now());
                entry.endedAtMs ??= Date.now();
                entry.endedAs ??= "sent";
            });
            if (result.isWritten) {
                this.runTimed("sent", () => this.finishSent(delivery));
            }
        }
    }

    /** Writes the status of a channel. The forwarding instance only. */
    private writeChannelStatus(channelId: string, run?: ChannelRun) {
        if (!isForwardingInstance() || !getChannel(channelId)) {
            return;
        }
        if (run) {
            this.runs.set(channelId, { ...this.runs.get(channelId), ...run });
        }

        const last = this.runs.get(channelId) ?? {};
        const activationId = getActivation(channelId)?.activationId ?? null;
        const recordState = this.record.getState();
        const status: NotificationChannelStatus = {
            counts: {
                ...ledger.countDeliveries(channelId),
                waitingForBudget: this.getWaitingForBudget(channelId)
            },
            runsBackendScripts: isScriptingEnabled(),
            recordHoldsActivation: activationId !== null
                && this.record.isLive(channelId, activationId),
            recordSequence: recordState ? getHighestRecordSequence(recordState) : 0
        };
        if (last.lastInvokedAtMs !== undefined) {
            status.lastInvokedAt = formatUtcDateTime(last.lastInvokedAtMs);
        }
        if (last.lastCompletedAtMs !== undefined) {
            status.lastCompletedAt = formatUtcDateTime(last.lastCompletedAtMs);
        }
        if (last.durationMs !== undefined) {
            status.durationMs = last.durationMs;
        }
        if (last.lastErrorCode) {
            status.lastErrorCode = last.lastErrorCode;
        }
        if (last.lastHttpStatus !== undefined) {
            status.lastHttpStatus = last.lastHttpStatus;
        }
        const runningSince = this.getRunningSince(channelId);
        if (runningSince !== null) {
            status.runningSince = formatUtcDateTime(runningSince);
        }
        const address = getChannel(channelId)?.type?.getAddressState(channelId);
        if (address) {
            status.addressChangedAt = address.changedAt;
        }

        const stored = getStatus(channelId);
        if (JSON.stringify(stored) !== JSON.stringify(status)) {
            getSql().transactional(() => writeStatus(channelId, status));
        }
    }

    /**
     * Brings the `channel` record of a built-in channel into line with the address that this
     * instance holds: its configuration ID follows the host's file. The forwarding instance only.
     */
    private reconcileAddress(channelId: string) {
        const channel = getChannel(channelId);
        if (!isForwardingInstance() || !channel?.definition || !channel.type) {
            return;
        }
        const address = channel.type.getAddressState(channelId);
        const configurationId = address?.configurationId;
        if (channel.definition.configurationId === configurationId) {
            return;
        }

        const definition = { ...channel.definition };
        if (configurationId === undefined) {
            delete definition.configurationId;
        } else {
            definition.configurationId = configurationId;
        }
        getSql().transactional(() => writeDefinition(channelId, definition));
    }

    private afterSwitch(channelId: string) {
        this.runTimed("switch", () => {
            this.writeRecordSequence(channelId);
            this.scan();
        });
        this.scheduleChecks();
        this.armPendingRetry();
    }

    /**
     * Runs the checks of every channel a moment after a change, and after a change of a channel
     * record writes the record, which then holds the new high-water mark.
     */
    private scheduleChecks() {
        if (!this.isStarted || this.checkTimer !== null) {
            return;
        }
        this.checkTimer = setTimeout(() => {
            this.checkTimer = null;
            this.runTimed("checks", () => this.checkChannels());
            if (this.isMarkDue) {
                this.isMarkDue = false;
                void this.record.run(() => undefined);
            }
        }, CHECK_DELAY_MS);
    }

    /** Retries a pending switching every minute until a write carries it. */
    private armPendingRetry() {
        if (!this.record.hasPending() || this.recordTimer !== null || !this.isStarted) {
            return;
        }
        this.recordTimer = setTimeout(async () => {
            this.recordTimer = null;
            await this.record.run(() => undefined);
            this.armPendingRetry();
        }, RECORD_RETRY_MS);
    }

    /**
     * Raises or dismisses the notice of each channel that stops: one changed since it was enabled,
     * one whose activation the record does not hold, and a backend one that cannot run with backend
     * scripting off. The forwarding instance only.
     */
    private checkChannels() {
        if (!isForwardingInstance() || getChannelsOff()) {
            return;
        }

        for (const channel of getChannels()) {
            const { channelId } = channel;
            const activation = getActivation(channelId);
            const activationId = activation?.activationId ?? null;
            const isLive = activation !== null && activationId !== null && !isRevoked(activationId);
            if (!isLive || !activation) {
                for (const cause of [ "changed", "record", "scripting" ] as const) {
                    this.dismissNotice(getChannelNoticeId(channelId, cause));
                }
                continue;
            }

            const revision = getCurrentRevision(channel).revision;
            this.toggleNotice(channel, "changed", revision !== activation.revision);
            const isRecordMissing = !!this.record.getState() && !this.record.isPending(channelId)
                && !this.record.isLive(channelId, activationId);
            this.toggleNotice(channel, "record", isRecordMissing);
            if (isRecordMissing) {
                this.writeRecordSequence(channelId);
            }
            this.toggleNotice(channel, "scripting",
                channel.kind === "script" && channel.runsOn === "backend" && !isScriptingEnabled());
            this.dismissNotice(getChannelNoticeId(channelId, "disabled"));
        }
    }

    private toggleNotice(channel: Channel, cause: ChannelNoticeCause, isOn: boolean) {
        if (isOn) {
            this.raiseChannelNotice(channel.channelId, cause);
        } else {
            this.dismissNotice(getChannelNoticeId(channel.channelId, cause));
        }
    }

    private raiseChannelNotice(channelId: string, cause: ChannelNoticeCause) {
        const channel = getChannel(channelId);
        const link = channel?.kind === "script" ? `#root/${channelId}` : SETTINGS_LINK;
        this.raiseNotice(getChannelNoticeId(channelId, cause),
            t("notifications.channel-stopped-title"),
            t(`notifications.channel-${cause}-description`), link);
    }

    /**
     * Raises a notice once while its cause lasts, and a new generation of it once an hour at most.
     */
    private raiseNotice(id: string, title: string, description: string, link: string) {
        if (this.raisedNotices.has(id) || this.notices.isShown(id)) {
            this.raisedNotices.add(id);
            return;
        }
        const newestMs = this.notices.getNewestTime(id);
        if (newestMs !== null && Date.now() - newestMs < NOTICE_INTERVAL_MS) {
            return;
        }
        this.raisedNotices.add(id);
        this.notices.raise({ id, title, description, link });
    }

    private dismissNotice(id: string) {
        this.raisedNotices.delete(id);
        if (this.notices.isShown(id)) {
            this.notices.dismiss(id);
        }
    }

    /** The sequence of a new switching: one above the highest that this instance knows. */
    private getNextSequence() {
        const state = this.record.getState();
        const fromRecord = state ? getHighestRecordSequence(state) : 0;
        const next = Math.max(getHighestSequence(), fromRecord) + 1;
        if (!Number.isSafeInteger(next)) {
            throw new NotificationError("invalid-input");
        }
        return next;
    }

    /** @throws NotificationError `rate-limit` once `limit` calls of the key fell in the window. */
    private checkRate(key: string, limit: number, windowMs: number) {
        const nowMs = Date.now();
        const times = (this.rates.get(key) ?? []).filter((timeMs) => nowMs - timeMs < windowMs);
        if (times.length >= limit) {
            this.rates.set(key, times);
            throw new NotificationError("rate-limit");
        }
        times.push(nowMs);
        this.rates.set(key, times);
    }

    /** Runs a listener, which logs its error by a code. */
    private runListener(fn: () => void) {
        try {
            fn();
        } catch (e) {
            const code = e instanceof NotificationError ? e.code : "internal";
            getLog().error(`A listener of the notification channels failed: ${code}.`);
        }
    }

    /** Runs work in a CLS context, and logs its error by a code. */
    private runTimed<T>(task: string, fn: () => T): T | undefined {
        try {
            return cls.init(fn);
        } catch (e) {
            const code = e instanceof NotificationError ? e.code : "internal";
            getLog().error(`Notification channel task ${task} failed: ${code}.`);
            return undefined;
        }
    }

}

/** A send that started, with its channel and whether its payload carries the public text alone. */
interface StartedSend {
    promise: Promise<unknown>;
    channel: Channel;
    isPublic: boolean;
}

/** A channel that runs on this instance, with its live activation and grace time. */
interface ActiveChannel {
    channel: Channel;
    activation: ActivationRecord;
    graceTime: number;
}

type ChannelNoticeCause = "disabled" | "changed" | "record" | "scripting";

/** The entities whose change can change a channel's bundle, records or address. */
const CHECKED_ENTITIES = new Set([
    "notes", "attributes", "branches", "blobs", "notification_channel_records"
]);

/** The error of a script channel, which the forwarder records as `script-error`. */
class ScriptFailure extends Error {

    constructor(readonly error: unknown) {
        super(error instanceof Error ? error.message : String(error));
        this.name = "ScriptFailure";
    }

}

/** What the batch carries for the record. */
interface BatchPlan {
    switchings: Switching[];
    seen: { channelId: string; sequence: number }[];
    revocations: string[];
    ended: string[];
}

/**
 * What a batch of sync will commit of the channels: each `activation` row that wins by the
 * comparison of `updateNormalEntity()` at `nowMs`, of a channel that the database holds or the
 * batch brings; the sequences of those that lose; the revocations; the channels that the batch
 * deletes; and, for a channel that arrives, the activation that the database holds for it.
 */
function planBatch(entityChanges: EntityChangeRecord[], nowMs: number): BatchPlan {
    const plan: BatchPlan = { switchings: [], seen: [], revocations: [], ended: [] };
    const now = formatUtcDateTime(nowMs);
    const activations = new Map<string, ActivationRecord>();
    const arrivingChannels = new Set<string>();
    const deletedChannels = new Set<string>();
    const batchRevocations = new Set<string>();

    for (const { entityChange, entity } of entityChanges) {
        if (entityChange.entityName === "attributes" && entity && !entityChange.isErased) {
            const row = entity as {
                noteId?: string; name?: string; type?: string; isDeleted?: number;
            };
            if (row.type === "label" && row.name === "notificationChannel" && row.noteId) {
                (row.isDeleted ? deletedChannels : arrivingChannels).add(row.noteId);
            }
            continue;
        }
        if (entityChange.entityName !== "notification_channel_records" || !entity
            || entityChange.isErased || checkChannelRecordRow(entity) !== null) {
            continue;
        }

        const row = entity as { channelId: string; kind: string; content: string };
        if (row.kind === "revocation") {
            const content = parseChannelRecord("revocation", row.content);
            if (content) {
                batchRevocations.add(content.activationId);
            }
        } else if (row.kind === "channel") {
            const content = parseChannelRecord("channel", row.content);
            if (content?.isDeleted) {
                deletedChannels.add(row.channelId);
            } else if (content) {
                arrivingChannels.add(row.channelId);
            }
        } else if (row.kind === "activation") {
            const content = parseChannelRecord("activation", row.content);
            if (!content) {
                continue;
            }
            const localEC = getSql().getRowOrNull<{ utcDateChanged: string; isErased: number }>(
                /*sql*/`SELECT utcDateChanged, isErased FROM entity_changes
                WHERE entityName = 'notification_channel_records' AND entityId = ?`,
            [ entityChange.entityId ]);
            const isAlreadyApplied = !!entityChange.changeId && !!getSql().getValue(
                "SELECT 1 FROM entity_changes WHERE changeId = ?", [ entityChange.changeId ]);
            if (!isAlreadyApplied && isIncomingChangeTaken(localEC, entityChange, now)) {
                activations.set(row.channelId, content);
            } else {
                plan.seen.push({ channelId: row.channelId, sequence: content.sequence });
            }
        }
    }

    plan.revocations = [ ...batchRevocations ];
    plan.ended = [ ...deletedChannels ];
    for (const [ channelId, content ] of activations) {
        const isHeld = isChannelHeld(channelId) || arrivingChannels.has(channelId);
        if (deletedChannels.has(channelId) || !isHeld) {
            continue;
        }
        const isActivationRevoked = content.activationId !== null
            && (batchRevocations.has(content.activationId) || isRevoked(content.activationId));
        plan.switchings.push(toSwitching(channelId, content, isActivationRevoked));
    }
    for (const channelId of arrivingChannels) {
        const stored = activations.has(channelId) ? null : getActivation(channelId);
        if (stored && !deletedChannels.has(channelId)) {
            const isActivationRevoked = stored.activationId !== null
                && (batchRevocations.has(stored.activationId) || isRevoked(stored.activationId));
            plan.switchings.push(toSwitching(channelId, stored, isActivationRevoked));
        }
    }
    return plan;
}

function toSwitching(
    channelId: string,
    content: ActivationRecord,
    isActivationRevoked: boolean
): Switching {
    return {
        channelId,
        activationId: content.activationId,
        sequence: content.sequence,
        isRevoked: isActivationRevoked
    };
}

/** Whether the database holds an activation or a delivery, so that a missing record is a move. */
function holdsDeliveryState() {
    return getRecords("activation").some(({ content }) => content.activationId !== null)
        || ledger.hasAnyDelivery();
}

function isWithinDeadline(notificationId: string, nowMs: number) {
    return nowMs - getTimeOfNotificationId(notificationId) < NOTIFICATION_DELIVERY_DEADLINE_MS;
}

function isNotificationSensitive(notification: BNotification, nowMs: number) {
    return buildPayload(notification, "", store.getViewContext(nowMs), false).isSensitive;
}

/** The owned labels of the channel note, as the activation holds them. */
function getChannelSettings(activation: ActivationRecord) {
    const settings: Record<string, string> = {};
    for (const { type, name, value } of activation.ownedAttributes ?? []) {
        if (type === "label" && name !== "notificationChannel" && !Object.hasOwn(settings, name)) {
            settings[name] = value;
        }
    }
    return settings;
}

function toErrorCode(
    e: unknown,
    channel: Channel,
    signal: AbortSignal
): NotificationDeliveryErrorCode {
    if (signal.aborted) {
        return "timeout";
    }
    if (e instanceof ChannelSendError) {
        return e.code;
    }
    return channel.kind === "script" ? "script-error" : "network";
}

function getChannelNoticeId(channelId: string, cause: ChannelNoticeCause) {
    return `trilium:channel:${channelId.substring(0, 60)}:${cause}`;
}

function getInstanceNoticeId(cause: "paused" | "record") {
    return `trilium:forwarding:${cause}`;
}

function getSyncServerHost() {
    return config.Sync?.syncServerHost || optionService.getOptionOrNull("syncServerHost") || "";
}
