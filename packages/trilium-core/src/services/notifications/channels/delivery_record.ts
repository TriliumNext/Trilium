/**
 * @module
 *
 * The delivery record: what a restore of the database must not undo, kept outside it. It holds
 * the deliveries that went out with the public text alone, that ended or that were granted, an
 * entry per channel with its last activation and the highest sequence seen, the floor, the pause
 * and the high-water mark of the entity changes. Every change goes through one queue, which
 * writes the whole record and keeps a switching whose write failed until a write carries it.
 */
import { NOTIFICATION_PAUSE_CAUSES, type NotificationPauseCause } from "@triliumnext/commons";

import { isSequence } from "../model.js";
import type { DeliveryRecordPort } from "./types.js";

/** What the record holds of a channel. */
export interface ChannelEntry {
    /** The last activation that the record held, live or not. */
    activationId: string | null;
    isLive: boolean;
    /** The highest sequence of the channel's `activation` rows that the record saw. */
    sequence: number;
}

/** A frontend delivery granted to a browser profile. */
export interface Grant {
    profileId: string;
    /** The random ID of the claim, so that a failed claim releases its own grant only. */
    claimId: string;
    atMs: number;
    isPublic: boolean;
}

/** The facts of a delivery that a restore must not undo. */
export interface DeliveryEntry {
    firstAtMs: number;
    /** When a payload with the public text alone was first handed over. */
    publicAtMs?: number;
    endedAtMs?: number;
    /** How the delivery ended: sent, or skipped at the user's choice when forwarding resumed. */
    endedAs?: "sent" | "skipped";
    grants: Grant[];
}

export interface RecordState {
    /** The high-water mark of the database's entity change IDs at the last write. */
    mark: number;
    pause: { causes: NotificationPauseCause[]; sinceMs: number } | null;
    /** The highest sync cursor that a confirmation covered, and until when it counts. */
    confirmedCursor: { cursor: number; untilMs: number } | null;
    /** The highest sequence of an entry that gave way. */
    floor: number;
    channels: Map<string, ChannelEntry>;
    entries: Map<string, DeliveryEntry>;
}

/** A switching of a channel that the record takes by its sequence. */
export interface Switching {
    channelId: string;
    /** The activation of the row that is stored, `null` for a disabling. */
    activationId: string | null;
    sequence: number;
    /** Whether a revocation of the database or of the batch names the activation. */
    isRevoked: boolean;
}

/** The result of a step of the queue. */
export interface StepResult<T> {
    isWritten: boolean;
    value: T | undefined;
}

/** The channels that the record holds an entry for, at most. */
export const RECORD_CHANNEL_LIMIT = 1000;
/** An entry of a delivery leaves the record this long after it was first written. */
const ENTRY_KEPT_MS = 48 * 60 * 60 * 1000;

export class DeliveryRecord {

    private state: RecordState | null = null;
    private isReadable = false;
    private isMissing = false;
    private needsRead = true;
    private chain: Promise<unknown> = Promise.resolve();
    /** Switchings whose write failed, by channel, laid over every later step. */
    private readonly pending = new Map<string, Switching>();

    constructor(
        private readonly port: DeliveryRecordPort,
        private readonly getMark: () => number
    ) {}

    get name() {
        return this.port.name;
    }

    /** The record as the last write or read left it, or `null` while it cannot be read. */
    getState(): Readonly<RecordState> | null {
        return this.isReadable ? this.state : null;
    }

    /** Whether the last read found no record: the first start, or a database in a new place. */
    wasMissing() {
        return this.isMissing;
    }

    /** Whether a switching of the channel waits for a write that carries it. */
    isPending(channelId: string) {
        return this.pending.has(channelId);
    }

    hasPending() {
        return this.pending.size > 0;
    }

    /**
     * Whether the record holds the activation as the channel's live one, with no switching of the
     * channel pending: a pending disabling stops the channel, a pending enabling does not run it.
     */
    isLive(channelId: string, activationId: string) {
        const entry = this.getState()?.channels.get(channelId);
        return !this.pending.has(channelId) && !!entry?.isLive
            && entry.activationId === activationId;
    }

    /**
     * Reads the record again, in a step of the queue.
     *
     * @returns whether it could be read; a record that does not exist is an empty one.
     */
    load(): Promise<boolean> {
        return this.enqueue(async () => this.read());
    }

    /**
     * Runs a step of the queue on a copy of the record with the pending switchings laid over it,
     * drops the old entries and writes the copy. A switching passed here stays pending until a
     * write carries it.
     *
     * @returns whether the record was written, and what the step returned. Nothing is written
     *          while the record cannot be read.
     */
    run<T>(step: (draft: RecordState) => T, switchings: Switching[] = []): Promise<StepResult<T>> {
        for (const switching of switchings) {
            this.pending.set(switching.channelId, switching);
        }

        return this.enqueue(async () => {
            if (this.needsRead && !await this.read()) {
                return { isWritten: false, value: undefined };
            }

            const draft = cloneState(this.state ?? createEmptyState());
            const carried = [ ...this.pending.values() ];
            for (const switching of carried) {
                takeSwitching(draft, switching);
            }
            const value = step(draft);
            dropOldEntries(draft, Date.now());
            draft.mark = Math.max(draft.mark, this.readMark());

            try {
                await this.port.write(serializeState(draft));
            } catch {
                this.needsRead = true;
                return { isWritten: false, value };
            }

            this.state = draft;
            for (const switching of carried) {
                if (this.pending.get(switching.channelId) === switching) {
                    this.pending.delete(switching.channelId);
                }
            }
            return { isWritten: true, value };
        });
    }

    /** Waits for the steps that were queued before. */
    settle(): Promise<unknown> {
        return this.enqueue(async () => undefined);
    }

    /** The high-water mark of the open database, or 0 while none is open, as in setup mode. */
    private readMark() {
        try {
            return this.getMark();
        } catch {
            return 0;
        }
    }

    private async read() {
        try {
            const text = await this.port.read();
            this.state = text === null ? createEmptyState() : parseState(text);
            this.isMissing = text === null;
            this.isReadable = true;
            this.needsRead = false;
            return true;
        } catch {
            this.isReadable = false;
            this.needsRead = true;
            return false;
        }
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const result = this.chain.then(task, task);
        this.chain = result.catch(() => undefined);
        return result;
    }

}

/** A record in memory, the default of a runtime that set no port of its own, and of specs. */
export class MemoryRecordPort implements DeliveryRecordPort {

    readonly name = "memory";
    text: string | null = null;

    async read() {
        return this.text;
    }

    async write(text: string) {
        this.text = text;
    }

}

/**
 * Takes a switching by its sequence: the entry follows a row numbered above it, or above the floor
 * for a channel without an entry, and keeps the highest sequence it saw either way.
 *
 * @returns `false` when a new entry has no room: every entry holds a live activation.
 */
export function takeSwitching(state: RecordState, switching: Switching) {
    const { channelId, activationId, sequence, isRevoked } = switching;
    const entry = state.channels.get(channelId);
    if (entry && sequence <= entry.sequence) {
        return true;
    }
    if (!entry && sequence <= state.floor) {
        return true;
    }
    if (!entry && !makeRoom(state)) {
        return false;
    }

    state.channels.set(channelId, {
        activationId: activationId ?? entry?.activationId ?? null,
        isLive: activationId !== null && !isRevoked,
        sequence
    });
    return true;
}

/** Raises the sequence that an entry saw, for an `activation` row that lost in its batch. */
export function seeSequence(state: RecordState, channelId: string, sequence: number) {
    const entry = state.channels.get(channelId);
    if (entry && sequence > entry.sequence) {
        entry.sequence = sequence;
    }
}

/** Ends the live activation of an entry that a revocation names. */
export function takeRevocation(state: RecordState, activationId: string) {
    for (const entry of state.channels.values()) {
        if (entry.activationId === activationId) {
            entry.isLive = false;
        }
    }
}

/** Ends the live activation of a channel that the database lacks or holds as deleted. */
export function endChannel(state: RecordState, channelId: string) {
    const entry = state.channels.get(channelId);
    if (entry) {
        entry.isLive = false;
    }
}

/** The highest sequence that the record knows: of its entries and its floor. */
export function getHighestRecordSequence(state: Readonly<RecordState>) {
    let highest = state.floor;
    for (const { sequence } of state.channels.values()) {
        highest = Math.max(highest, sequence);
    }
    return highest;
}

export function getEntry(state: RecordState, deliveryKey: string, nowMs: number) {
    let entry = state.entries.get(deliveryKey);
    if (!entry) {
        entry = { firstAtMs: nowMs, grants: [] };
        state.entries.set(deliveryKey, entry);
    }
    return entry;
}

/** Drops the entries of deliveries that were first written 48 hours ago or earlier. */
export function dropOldEntries(state: RecordState, nowMs: number) {
    for (const [ deliveryKey, entry ] of state.entries) {
        if (nowMs - entry.firstAtMs >= ENTRY_KEPT_MS) {
            state.entries.delete(deliveryKey);
        }
    }
}

export function createEmptyState(): RecordState {
    return {
        mark: 0,
        pause: null,
        confirmedCursor: null,
        floor: 0,
        channels: new Map(),
        entries: new Map()
    };
}

export function serializeState(state: RecordState) {
    return JSON.stringify({
        v: 1,
        mark: state.mark,
        pause: state.pause,
        confirmedCursor: state.confirmedCursor,
        floor: state.floor,
        channels: Object.fromEntries(state.channels),
        entries: Object.fromEntries(state.entries)
    });
}

/**
 * Reads the text of a record.
 *
 * @throws for text that is not a record of this version.
 */
export function parseState(text: string): RecordState {
    const value: unknown = JSON.parse(text);
    if (!isObject(value) || value.v !== 1 || !isSequence(value.mark) || !isSequence(value.floor)
        || !isObject(value.channels) || !isObject(value.entries)) {
        throw new Error("record");
    }

    const state = createEmptyState();
    state.mark = value.mark;
    state.floor = value.floor;
    state.pause = parsePause(value.pause);
    state.confirmedCursor = parseConfirmedCursor(value.confirmedCursor);
    for (const [ channelId, entry ] of Object.entries(value.channels)) {
        if (!isObject(entry) || !isSequence(entry.sequence) || typeof entry.isLive !== "boolean"
            || (entry.activationId !== null && typeof entry.activationId !== "string")) {
            throw new Error("record");
        }
        state.channels.set(channelId, {
            activationId: entry.activationId,
            isLive: entry.isLive,
            sequence: entry.sequence
        });
    }
    for (const [ deliveryKey, entry ] of Object.entries(value.entries)) {
        state.entries.set(deliveryKey, parseEntry(entry));
    }
    return state;
}

function parsePause(value: unknown): RecordState["pause"] {
    if (value === null || value === undefined) {
        return null;
    }
    if (!isObject(value) || !Array.isArray(value.causes) || !isSequence(value.sinceMs)
        || !value.causes.every((cause: unknown) =>
            (NOTIFICATION_PAUSE_CAUSES as readonly unknown[]).includes(cause))) {
        throw new Error("record");
    }
    return { causes: [ ...value.causes ], sinceMs: value.sinceMs };
}

function parseConfirmedCursor(value: unknown): RecordState["confirmedCursor"] {
    if (value === null || value === undefined) {
        return null;
    }
    if (!isObject(value) || !isSequence(value.cursor) || !isSequence(value.untilMs)) {
        throw new Error("record");
    }
    return { cursor: value.cursor, untilMs: value.untilMs };
}

function parseEntry(value: unknown): DeliveryEntry {
    if (!isObject(value) || !isSequence(value.firstAtMs) || !Array.isArray(value.grants)
        || (value.publicAtMs !== undefined && !isSequence(value.publicAtMs))
        || (value.endedAtMs !== undefined && !isSequence(value.endedAtMs))) {
        throw new Error("record");
    }

    const entry: DeliveryEntry = { firstAtMs: value.firstAtMs, grants: [] };
    if (value.publicAtMs !== undefined) {
        entry.publicAtMs = value.publicAtMs;
    }
    if (value.endedAtMs !== undefined) {
        entry.endedAtMs = value.endedAtMs;
        entry.endedAs = value.endedAs === "skipped" ? "skipped" : "sent";
    }
    for (const grant of value.grants) {
        if (!isObject(grant) || typeof grant.profileId !== "string"
            || typeof grant.claimId !== "string" || !isSequence(grant.atMs)
            || typeof grant.isPublic !== "boolean") {
            throw new Error("record");
        }
        entry.grants.push({
            profileId: grant.profileId,
            claimId: grant.claimId,
            atMs: grant.atMs,
            isPublic: grant.isPublic
        });
    }
    return entry;
}

/**
 * Frees a place for a new entry when the record is full: the entry without a live activation
 * that has the lowest sequence gives way, and the floor rises to its sequence.
 *
 * @returns `false` when every entry holds a live activation.
 */
function makeRoom(state: RecordState) {
    if (state.channels.size < RECORD_CHANNEL_LIMIT) {
        return true;
    }

    let lowest: [ string, ChannelEntry ] | null = null;
    for (const item of state.channels) {
        if (!item[1].isLive && (!lowest || item[1].sequence < lowest[1].sequence)) {
            lowest = item;
        }
    }
    if (!lowest) {
        return false;
    }
    state.channels.delete(lowest[0]);
    state.floor = Math.max(state.floor, lowest[1].sequence);
    return true;
}

function cloneState(state: RecordState): RecordState {
    return parseState(serializeState(state));
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
