/**
 * @module
 *
 * The records of channels on Becca: definitions of built-in channels, activations, revocations,
 * settings and status. Every row that it writes passes the checks that a receiver applies to it.
 */
import type {
    NotificationChannelRecordKind,
    NotificationChannelSettings,
    NotificationChannelStatus
} from "@triliumnext/commons";

import becca from "../../../becca/becca.js";
import BNotificationChannelRecord from "../../../becca/entities/bnotification_channel_record.js";
import { newEntityId } from "../../utils/index.js";
import {
    type ActivationRecord,
    type ChannelDefinition,
    type ChannelRecordContents,
    checkChannelRecordRow,
    formatUtcDateTime,
    getActivationRecordId,
    getRevocationRecordId,
    getRewriteDateMs,
    getStatusRecordId,
    NotificationError,
    parseChannelRecord,
    parseUtcDateTime,
    resolveSettings,
    type SettingsRecord
} from "../model.js";

/** A record of a kind with its parsed content. */
export interface StoredRecord<K extends NotificationChannelRecordKind> {
    recordId: string;
    channelId: string;
    content: ChannelRecordContents[K];
    utcDateModified: string;
}

/** The settings that hold for the current activation, and the records that they come from. */
export interface HeldSettings {
    activationId: string;
    settings: NotificationChannelSettings;
    currentRecordIds: string[];
}

/** The records of a kind whose content passes its checks, of one channel or of all. */
export function getRecords<K extends NotificationChannelRecordKind>(
    kind: K,
    channelId?: string
): StoredRecord<K>[] {
    const records: StoredRecord<K>[] = [];
    for (const record of Object.values(becca.notificationChannelRecords)) {
        if (record.kind !== kind || (channelId !== undefined && record.channelId !== channelId)) {
            continue;
        }
        const content = parseChannelRecord(kind, record.content);
        if (content) {
            records.push({
                recordId: record.recordId,
                channelId: record.channelId,
                content,
                utcDateModified: record.utcDateModified
            });
        }
    }
    return records;
}

/** The definition of a built-in channel, deleted ones included. */
export function getDefinition(channelId: string): ChannelDefinition | null {
    return readRecord("channel", channelId)?.content ?? null;
}

export function getActivation(channelId: string): ActivationRecord | null {
    return readRecord("activation", getActivationRecordId(channelId))?.content ?? null;
}

export function getStatus(channelId: string): NotificationChannelStatus | null {
    return readRecord("status", getStatusRecordId(channelId))?.content.status ?? null;
}

/** Whether a revocation of the database names the activation. */
export function isRevoked(activationId: string) {
    return readRecord("revocation", getRevocationRecordId(activationId))?.content.activationId
        === activationId;
}

/** The live activation of a channel: one that the `activation` record names and none revokes. */
export function getLiveActivationId(channelId: string): string | null {
    const activationId = getActivation(channelId)?.activationId ?? null;
    return activationId !== null && !isRevoked(activationId) ? activationId : null;
}

/** The settings that hold for the live activation of a channel, or `null` without one. */
export function getHeldSettings(channelId: string): HeldSettings | null {
    const activation = getActivation(channelId);
    const activationId = activation?.activationId ?? null;
    if (!activation || activationId === null || isRevoked(activationId)) {
        return null;
    }

    const records = getRecords("settings", channelId);
    const resolved = resolveSettings({ activationId, settings: activation.settings }, records);
    return { activationId, ...resolved };
}

/**
 * The highest sequence that the database knows: of every channel's `activation` record, and of
 * the delivery record of the forwarding instance as its `status` records name it.
 */
export function getHighestSequence() {
    let highest = 0;
    for (const { content } of getRecords("activation")) {
        highest = Math.max(highest, content.sequence);
    }
    for (const { content } of getRecords("status")) {
        highest = Math.max(highest, content.status.recordSequence);
    }
    return highest;
}

/** The channels that have an `activation` record, deleted ones included. */
export function getActivatedChannelIds() {
    return getRecords("activation").map(({ channelId }) => channelId);
}

export function writeDefinition(
    channelId: string,
    definition: ChannelDefinition,
    nowMs = Date.now()
) {
    return writeRecord("channel", channelId, channelId, definition, nowMs);
}

export function writeActivation(
    channelId: string,
    activation: ActivationRecord,
    nowMs = Date.now()
) {
    const recordId = getActivationRecordId(channelId);
    return writeRecord("activation", recordId, channelId, activation, nowMs);
}

/** Writes the revocation of an activation, once: a revocation that exists stays as it is. */
export function writeRevocation(channelId: string, activationId: string, nowMs = Date.now()) {
    if (isRevoked(activationId)) {
        return;
    }
    writeRecord("revocation", getRevocationRecordId(activationId), channelId,
        { v: 1, activationId, revokedAt: formatUtcDateTime(nowMs) }, nowMs);
}

/** @returns the ID of the new settings record. */
export function writeSettingsRecord(
    channelId: string,
    content: SettingsRecord,
    nowMs = Date.now()
) {
    const recordId = newEntityId();
    writeRecord("settings", recordId, channelId, content, nowMs);
    return recordId;
}

export function writeStatus(
    channelId: string,
    status: NotificationChannelStatus,
    nowMs = Date.now()
) {
    return writeRecord("status", getStatusRecordId(channelId), channelId, { v: 1, status }, nowMs);
}

function readRecord<K extends NotificationChannelRecordKind>(
    kind: K,
    recordId: string
): StoredRecord<K> | null {
    const record = becca.getNotificationChannelRecord(recordId);
    const content = record?.kind === kind ? parseChannelRecord(kind, record.content) : null;
    if (!record || !content) {
        return null;
    }
    const { channelId, utcDateModified } = record;
    return { recordId, channelId, content, utcDateModified };
}

/**
 * Writes a record, dated now or one millisecond after its stored date, whichever is later.
 *
 * @throws NotificationError for a row that fails its checks.
 */
function writeRecord<K extends NotificationChannelRecordKind>(
    kind: K,
    recordId: string,
    channelId: string,
    content: ChannelRecordContents[K],
    nowMs: number
) {
    const stored = becca.getNotificationChannelRecord(recordId);
    const storedMs = stored ? parseUtcDateTime(stored.utcDateModified) : null;
    const now = formatUtcDateTime(nowMs);
    const row = {
        recordId,
        channelId,
        kind,
        content: JSON.stringify(content),
        utcDateCreated: stored?.utcDateCreated ?? now,
        utcDateModified: storedMs === null
            ? now
            : formatUtcDateTime(getRewriteDateMs(nowMs, storedMs))
    };
    const code = checkChannelRecordRow(row);
    if (code) {
        throw new NotificationError(code);
    }

    if (!stored) {
        return new BNotificationChannelRecord(row).save();
    }
    stored.updateFromRow(row);
    return stored.save();
}
