/**
 * @module
 *
 * The ledger of deliveries: the local table `notification_deliveries`, which never syncs. A
 * delivery holds no content, only what its checks compare: the activation, the revision, the
 * address and the grace time that held when it was written.
 */
import type {
    NotificationDeliveryCounts,
    NotificationDeliveryErrorCode,
    NotificationDeliverySkipReason
} from "@triliumnext/commons";

import { getSql } from "../../sql/index.js";
import { formatUtcDateTime, getTimeOfNotificationId, parseUtcDateTime } from "../model.js";

/**
 * Where a delivery is: written and not due yet or retried, announced to the tabs of a frontend
 * channel, or ended.
 */
export type LedgerStatus = "waiting" | "announced" | "sent" | "skipped" | "failed" | "expired";

export interface Delivery {
    deliveryKey: string;
    notificationId: string;
    channelId: string;
    activationId: string;
    revision: string;
    configurationId: string | null;
    /** In seconds. */
    graceTime: number;
    dueAtMs: number;
    status: LedgerStatus;
    reason: string | null;
    attempts: number;
    nextAttemptAtMs: number | null;
    isPublicOnly: boolean;
    profiles: string[];
}

interface DeliveryRow {
    deliveryKey: string;
    notificationId: string;
    channelId: string;
    activationId: string;
    revision: string;
    configurationId: string | null;
    graceTime: number;
    dueAt: string;
    status: LedgerStatus;
    reason: string | null;
    attempts: number;
    nextAttemptAt: string | null;
    isPublicOnly: number;
    profiles: string | null;
}

/** A finished delivery is kept until its generation is this old. */
const FINISHED_KEPT_MS = 48 * 60 * 60 * 1000;

/**
 * Writes a delivery unless one with its key exists, whatever its end.
 *
 * @returns whether it wrote one.
 */
export function insertDelivery(
    delivery: Omit<Delivery, "status" | "reason" | "attempts" | "nextAttemptAtMs"
        | "isPublicOnly" | "profiles">,
    nowMs: number
) {
    const changes = getSql().execute(/*sql*/`INSERT OR IGNORE INTO notification_deliveries
        (deliveryKey, notificationId, channelId, activationId, revision, configurationId,
        graceTime, dueAt, status, attempts, isPublicOnly, utcDateCreated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', 0, 0, ?)`, [
        delivery.deliveryKey, delivery.notificationId, delivery.channelId, delivery.activationId,
        delivery.revision, delivery.configurationId, delivery.graceTime,
        formatUtcDateTime(delivery.dueAtMs), formatUtcDateTime(nowMs)
    ]);
    return changes.changes > 0;
}

export function getDelivery(deliveryKey: string): Delivery | null {
    const row = getSql().getRowOrNull<DeliveryRow>(
        "SELECT * FROM notification_deliveries WHERE deliveryKey = ?", [ deliveryKey ]);
    return row ? toDelivery(row) : null;
}

/** The deliveries that have not ended, oldest generation first. */
export function getOpenDeliveries(): Delivery[] {
    return getSql().getRows<DeliveryRow>(/*sql*/`SELECT * FROM notification_deliveries
        WHERE status IN ('waiting', 'announced') ORDER BY notificationId`)
        .map(toDelivery)
        .sort((a, b) => getTimeOfNotificationId(a.notificationId)
            - getTimeOfNotificationId(b.notificationId));
}

/** Whether the ledger holds any delivery, ended or not. */
export function hasAnyDelivery() {
    return !!getSql().getValue("SELECT 1 FROM notification_deliveries LIMIT 1");
}

/** Ends a delivery. One that has ended stays as it is. */
export function finishDelivery(
    deliveryKey: string,
    status: "sent" | "skipped" | "failed" | "expired",
    reason: NotificationDeliverySkipReason | NotificationDeliveryErrorCode | null,
    nowMs: number
) {
    getSql().execute(/*sql*/`UPDATE notification_deliveries
        SET status = ?, reason = ?, nextAttemptAt = NULL, utcDateFinished = ?
        WHERE deliveryKey = ? AND status IN ('waiting', 'announced')`,
    [ status, reason, formatUtcDateTime(nowMs), deliveryKey ]);
}

/** Counts an attempt, and when it failed, when the next one is due. */
export function recordAttempt(
    deliveryKey: string,
    attempts: number,
    nextAttemptAtMs: number | null,
    reason: NotificationDeliveryErrorCode | null
) {
    getSql().execute(/*sql*/`UPDATE notification_deliveries
        SET attempts = ?, nextAttemptAt = ?, reason = ? WHERE deliveryKey = ?`, [
        attempts, nextAttemptAtMs === null ? null : formatUtcDateTime(nextAttemptAtMs), reason,
        deliveryKey
    ]);
}

/** Marks a frontend delivery as announced to the tabs, with the time of a new announcement. */
export function markAnnounced(deliveryKey: string, nextAnnouncementAtMs: number | null) {
    getSql().execute(/*sql*/`UPDATE notification_deliveries SET status = 'announced',
        attempts = attempts + 1, nextAttemptAt = ? WHERE deliveryKey = ? AND status IN
        ('waiting', 'announced')`, [
        nextAnnouncementAtMs === null ? null : formatUtcDateTime(nextAnnouncementAtMs), deliveryKey
    ]);
}

/** Notes that a payload of the delivery went out with the public text alone. */
export function markPublicOnly(deliveryKey: string) {
    getSql().execute("UPDATE notification_deliveries SET isPublicOnly = 1 WHERE deliveryKey = ?",
        [ deliveryKey ]);
}

export function addProfile(deliveryKey: string, profileId: string) {
    const delivery = getDelivery(deliveryKey);
    if (!delivery || delivery.profiles.includes(profileId)) {
        return;
    }
    getSql().execute("UPDATE notification_deliveries SET profiles = ? WHERE deliveryKey = ?",
        [ JSON.stringify([ ...delivery.profiles, profileId ]), deliveryKey ]);
}

/** The counts of a channel's deliveries, by their end. */
export function countDeliveries(
    channelId: string
): Omit<NotificationDeliveryCounts, "waitingForBudget"> {
    const rows = getSql().getRows<{ status: LedgerStatus; isPublicOnly: number; count: number }>(
        /*sql*/`SELECT status, isPublicOnly, COUNT(*) AS count FROM notification_deliveries
        WHERE channelId = ? GROUP BY status, isPublicOnly`, [ channelId ]);
    const counts = { sent: 0, sentPublic: 0, skipped: 0, failed: 0, expired: 0 };
    for (const { status, isPublicOnly, count } of rows) {
        if (status === "sent") {
            counts.sent += count;
            counts.sentPublic += isPublicOnly ? count : 0;
        } else if (status === "skipped" || status === "failed" || status === "expired") {
            counts[status] += count;
        }
    }
    return counts;
}

/** Deletes the ended deliveries whose generation is 48 hours old or older. */
export function purgeFinished(nowMs: number) {
    const finished = getSql().getColumn<string>(/*sql*/`SELECT deliveryKey || '|' || notificationId
        FROM notification_deliveries WHERE status NOT IN ('waiting', 'announced')`);
    const old = finished
        .map((value) => value.split("|"))
        .filter(([ , notificationId ]) =>
            nowMs - getTimeOfNotificationId(notificationId) >= FINISHED_KEPT_MS)
        .map(([ deliveryKey ]) => deliveryKey);
    getSql().executeMany(/*sql*/`DELETE FROM notification_deliveries WHERE deliveryKey IN (???)`,
        old);
}

function toDelivery(row: DeliveryRow): Delivery {
    let profiles: string[] = [];
    try {
        const parsed: unknown = row.profiles ? JSON.parse(row.profiles) : [];
        profiles = Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
    } catch {
        profiles = [];
    }
    return {
        deliveryKey: row.deliveryKey,
        notificationId: row.notificationId,
        channelId: row.channelId,
        activationId: row.activationId,
        revision: row.revision,
        configurationId: row.configurationId,
        graceTime: row.graceTime,
        dueAtMs: parseUtcDateTime(row.dueAt) ?? 0,
        status: row.status,
        reason: row.reason,
        attempts: row.attempts,
        nextAttemptAtMs: row.nextAttemptAt === null ? null : parseUtcDateTime(row.nextAttemptAt),
        isPublicOnly: row.isPublicOnly === 1,
        profiles
    };
}
