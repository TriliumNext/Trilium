import type {
    EntityChangeRecord,
    NotificationChannelConfig,
    NotificationChannelSettings,
    WebSocketMessage
} from "@triliumnext/commons";
import { t } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../../../becca/becca.js";
import config from "../../config.js";
import * as cls from "../../context.js";
import noteService from "../../notes.js";
import optionService from "../../options.js";
import { getPlatform } from "../../platform.js";
import { getSql } from "../../sql/index.js";
import syncUpdateService from "../../sync_update.js";
import { getNotificationService } from "../index.js";
import {
    formatUtcDateTime,
    getActivationRecordId,
    type ActivationRecord
} from "../model.js";
import type { NotificationProducer } from "../service.js";
import * as store from "../store.js";
import { hashTemplate } from "./body_template.js";
import { getBuiltInRevision, getChannel, getCurrentRevision } from "./catalog.js";
import {
    createEmptyState,
    DeliveryRecord,
    MemoryRecordPort,
    parseState,
    serializeState
} from "./delivery_record.js";
import NotificationForwarder, { type ChannelNotice, getEntityChangeMark } from "./forwarder.js";
import { buildPayload, getDeliveryKey } from "./payload.js";
import {
    getActivation, getDefinition, getStatus, writeActivation, writeDefinition
} from "./records.js";
import { clearChannelTypes, registerChannelType } from "./registry.js";
import {
    type ChannelAddressState,
    type ChannelSendRequest,
    ChannelSendError,
    type NotificationChannelType
} from "./types.js";

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const AT = formatUtcDateTime(NOW);
const CHANNEL = "specHookChannel";
const BUILT_IN: NotificationProducer = { kind: "built-in", name: "trilium:spec" };
const SCRIPT: NotificationProducer = { kind: "script", noteId: "specFlooder" };
const TABLES = [
    "notifications", "notification_marks", "notification_private_texts",
    "notification_channel_records", "notification_deliveries"
];

/** A port whose writes and reads can be made to fail, and whose writes can be held. */
class SpecPort extends MemoryRecordPort {

    isWriteFailing = false;
    isReadFailing = false;
    isWriteHeld = false;
    /** The functions that let a held write go on. */
    readonly heldWrites: (() => void)[] = [];

    override async read() {
        if (this.isReadFailing) {
            throw new Error("unreadable");
        }
        return super.read();
    }

    override async write(text: string) {
        if (this.isWriteFailing) {
            throw new Error("disk full");
        }
        if (this.isWriteHeld) {
            await new Promise<void>((resolve) => this.heldWrites.push(resolve));
        }
        return super.write(text);
    }

}

let port: SpecPort;
let forwarder: NotificationForwarder;
let messages: WebSocketMessage[];
let notices: { raised: ChannelNotice[]; shown: Set<string> };
let clients: number;
let sends: ChannelSendRequest[];
let sendImpl: (request: ChannelSendRequest) => Promise<void>;
let address: ChannelAddressState | null;
/** When the instance applied its last batch of sync. */
let lastBatchTime: () => number;

const SPEC_TYPE: NotificationChannelType = {
    type: "spechook",
    title: "Spec hook",
    icon: "bx bx-test-tube",
    isAvailable: () => true,
    checkConfig: (value) => value as NotificationChannelConfig,
    getAddressState: () => address,
    send: (request) => {
        sends.push(request);
        return sendImpl(request);
    }
};

beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    cls.init(() => getSql().transactional(() => {
        for (const table of TABLES) {
            getSql().execute(`DELETE FROM ${table}`);
            getSql().execute("DELETE FROM entity_changes WHERE entityName = ?", [ table ]);
        }
        optionService.setOption("syncServerHost", "");
    }));
    becca.notifications = {};
    becca.notificationMarks = {};
    becca.notificationPrivateTexts = {};
    becca.notificationChannelRecords = {};
    clearChannelTypes();
    registerChannelType(SPEC_TYPE);
    port = new SpecPort();
    messages = [];
    notices = { raised: [], shown: new Set() };
    clients = 1;
    sends = [];
    sendImpl = async () => undefined;
    address = { configurationId: "conf1", templateHash: hashTemplate(undefined), changedAt: AT };
    lastBatchTime = () => 0;
    forwarder = makeForwarder();
});

afterEach(() => {
    forwarder.stop();
    getNotificationService().stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function makeForwarder() {
    return new NotificationForwarder({
        record: new DeliveryRecord(port, getEntityChangeMark),
        transport: {
            send: (message) => messages.push(message),
            getClientCount: () => clients
        },
        notices: {
            raise: (notice) => {
                notices.raised.push(notice);
                notices.shown.add(notice.id);
            },
            dismiss: (id) => notices.shown.delete(id),
            isShown: (id) => notices.shown.has(id),
            getNewestTime: () => null
        },
        getLastSyncedBatchTime: () => lastBatchTime()
    });
}

/** Restarts the forwarder on the same database and record. */
async function restart() {
    forwarder.stop();
    forwarder = makeForwarder();
    await forwarder.start();
}

async function enable(
    channelId = CHANNEL,
    settings: NotificationChannelSettings = { graceTime: 60, protectedNotes: "none" }
) {
    cls.init(() => writeDefinition(channelId, {
        v: 1, type: "spechook", title: "Pager", config: {}, configurationId: "conf1"
    }));
    return forwarder.switchOn(channelId, (activationId, sequence) => {
        const definition = getDefinition(channelId);
        if (!definition) {
            throw new Error("No definition.");
        }
        writeActivation(channelId, {
            v: 1, activationId, sequence, revision: getBuiltInRevision(definition), settings
        });
    });
}

function disable(channelId = CHANNEL) {
    return forwarder.switchOff(channelId, (sequence) => {
        const activation = getActivation(channelId);
        writeActivation(channelId, {
            v: 1, activationId: null, sequence, revision: null,
            settings: activation?.settings ?? { graceTime: 0, protectedNotes: "none" }
        });
    });
}

function raise(input: Record<string, unknown> = {}, producer = BUILT_IN) {
    const { notification } = cls.init(() => getNotificationService().create(
        { title: "Pager", attentionLevel: "high", ...input }, producer));
    if (!notification) {
        throw new Error("Nothing was stored.");
    }
    return notification;
}

function deliveries() {
    return getSql().getRows<{ status: string; reason: string | null; channelId: string }>(
        "SELECT status, reason, channelId FROM notification_deliveries ORDER BY notificationId");
}

/** The reason of each delivery, by its channel. */
function reasonsByChannel() {
    return Object.fromEntries(deliveries().map(({ channelId, reason }) => [ channelId, reason ]));
}

function recordState() {
    return parseState(port.text ?? serializeState(createEmptyState()));
}

describe("forwarding", () => {
    it("forwards a high notification once after its grace time, under its key", async () => {
        await forwarder.start();
        expect(await enable()).toBe(true);
        const notification = raise();
        raise({ id: "medium", attentionLevel: "medium" });

        await vi.advanceTimersByTimeAsync(59 * SECOND);
        expect(sends).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(2 * SECOND);
        const key = getDeliveryKey(notification.id, notification.raisedAt, CHANNEL);
        expect(sends.map(({ payload, delivery }) => [ payload, delivery.attempt ])).toEqual([ [ {
            key, title: "Pager", category: "general", attentionLevel: "high",
            raisedAt: notification.raisedAt
        }, 1 ] ]);

        await vi.advanceTimersByTimeAsync(HOUR);
        expect(sends).toHaveLength(1);
        expect(deliveries()).toEqual([ { status: "sent", reason: null, channelId: CHANNEL } ]);
        expect(recordState().entries.get(key)?.endedAs).toBe("sent");
        expect(getStatus(CHANNEL)?.counts.sent).toBe(1);
        expect(getStatus(CHANNEL)?.recordHoldsActivation).toBe(true);
    });

    it("skips what was read in its grace time, and forwards it without grace time", async () => {
        await forwarder.start();
        await enable(CHANNEL, { graceTime: 60, protectedNotes: "none" });
        await enable("specHookNoGrace", { graceTime: 0, protectedNotes: "none" });
        const notification = raise();
        cls.init(() => getNotificationService().setState(
            [ { id: notification.id, raisedAt: notification.raisedAt } ], "read"));

        await vi.advanceTimersByTimeAsync(2 * MINUTE);
        expect(sends.map(({ channelId }) => channelId)).toEqual([ "specHookNoGrace" ]);
        expect(deliveries().map(({ status, reason }) => [ status, reason ]).sort()).toEqual([
            [ "sent", null ], [ "skipped", "marked" ]
        ]);
    });

    it("waits for the instance to settle, two minutes at most", async () => {
        await forwarder.start();
        await enable(CHANNEL, { graceTime: 60, protectedNotes: "none" });
        const notification = raise({ id: "pushed" });

        // A push that is not over when the grace time ends: its read mark comes in a later batch.
        lastBatchTime = () => NOW + 55 * SECOND;
        await vi.advanceTimersByTimeAsync(61 * SECOND);
        expect(sends).toHaveLength(0);
        cls.init(() => getNotificationService().setState(
            [ { id: notification.id, raisedAt: notification.raisedAt } ], "read"));
        const batchEndMs = Date.now();
        lastBatchTime = () => batchEndMs;
        await vi.advanceTimersByTimeAsync(11 * SECOND);
        expect(sends).toHaveLength(0);
        expect(deliveries()[0]).toMatchObject({ status: "skipped", reason: "marked" });

        // A push that stalls is not waited for beyond two minutes.
        lastBatchTime = () => Date.now();
        raise({ id: "stalled" });
        await vi.advanceTimersByTimeAsync(61 * SECOND + 2 * MINUTE - 2 * SECOND);
        expect(sends).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(4 * SECOND);
        expect(sends).toHaveLength(1);
    });

    it("sends nothing after an erasure, before the first attempt or before a retry", async () => {
        await forwarder.start();
        await enable(CHANNEL, { graceTime: 0, protectedNotes: "none" });
        const first = raise({ id: "first" });
        cls.init(() => getNotificationService().dismissById(first.id));
        await vi.advanceTimersByTimeAsync(SECOND);
        expect(sends).toHaveLength(0);

        sendImpl = () => Promise.reject(new ChannelSendError("network"));
        const second = raise({ id: "second" });
        await vi.advanceTimersByTimeAsync(SECOND);
        expect(sends).toHaveLength(1);
        cls.init(() => getNotificationService().dismissById(second.id));
        await vi.advanceTimersByTimeAsync(10 * MINUTE);
        expect(sends).toHaveLength(1);
        expect(deliveries().map(({ status, reason }) => [ status, reason ])).toEqual([
            [ "skipped", "erased" ], [ "skipped", "erased" ]
        ]);
    });

    it("retries after 1, 5 and 30 minutes, and waits as Retry-After asks", async () => {
        await forwarder.start();
        await enable(CHANNEL, { graceTime: 0, protectedNotes: "none" });
        sendImpl = () => Promise.reject(new ChannelSendError("http", { httpStatus: 503 }));
        raise({ id: "failing" });

        const times: number[] = [];
        sendImpl = (request) => {
            times.push(Date.now() - NOW);
            return Promise.reject(new ChannelSendError("http", { httpStatus: 503 }));
        };
        await vi.advanceTimersByTimeAsync(2 * HOUR);
        expect(times).toEqual([ 0, MINUTE, 6 * MINUTE, 36 * MINUTE ]);
        expect(deliveries()[0]).toMatchObject({ status: "failed", reason: "http" });
        expect(getStatus(CHANNEL)).toMatchObject({ lastErrorCode: "http", lastHttpStatus: 503 });

        times.length = 0;
        const startMs = Date.now();
        sendImpl = () => {
            times.push(Date.now() - startMs);
            return times.length === 1
                ? Promise.reject(new ChannelSendError("http",
                    { httpStatus: 429, retryAfterMs: 7 * 24 * HOUR }))
                : Promise.resolve();
        };
        raise({ id: "held" });
        await vi.advanceTimersByTimeAsync(2 * HOUR);
        expect(times).toEqual([ 0, HOUR ]);
    });

    it("holds the channel while a send outlives its timeout, until it settles", async () => {
        await forwarder.start();
        await enable(CHANNEL, { graceTime: 0, protectedNotes: "none" });
        let settle: (isSent: boolean) => void = () => undefined;
        sendImpl = () => new Promise((resolve, reject) => {
            settle = (isSent) => (isSent ? resolve() : reject(new Error("late")));
        });
        raise({ id: "slow" });
        raise({ id: "behind" });

        await vi.advanceTimersByTimeAsync(31 * SECOND);
        expect(getStatus(CHANNEL)?.lastErrorCode).toBe("timeout");
        await vi.advanceTimersByTimeAsync(3 * MINUTE);
        expect(sends).toHaveLength(1);

        settle(true);
        await vi.advanceTimersByTimeAsync(SECOND);
        expect(sends).toHaveLength(2);
        expect(deliveries()[0]).toMatchObject({ status: "sent" });

        // The second one rejects past its timeout: its retry waits a minute from then.
        settle(false);
        await vi.advanceTimersByTimeAsync(59 * SECOND);
        expect(sends).toHaveLength(2);
        sendImpl = () => Promise.resolve();
        await vi.advanceTimersByTimeAsync(2 * SECOND);
        expect(sends).toHaveLength(3);
    });

    it("skips a delivery of a disabled or changed channel, or another address", async () => {
        await forwarder.start();
        const settings = { graceTime: 60, protectedNotes: "none" } as const;
        for (const channelId of [ "specDisabled", "specChanged", "specAddress", "specTemplate" ]) {
            await enable(channelId, settings);
        }
        raise();

        await disable("specDisabled");
        cls.init(() => writeDefinition("specChanged", {
            v: 1, type: "spechook", title: "Pager", config: { template: "{}" },
            configurationId: "conf1"
        }));
        const realAddress = address;
        SPEC_TYPE.getAddressState = (channelId) => {
            if (channelId === "specAddress") {
                return realAddress ? { ...realAddress, configurationId: "conf2" } : null;
            }
            return channelId === "specTemplate" && realAddress
                ? { ...realAddress, templateHash: hashTemplate("{\"x\":1}") }
                : realAddress;
        };
        try {
            await vi.advanceTimersByTimeAsync(2 * MINUTE);
        } finally {
            SPEC_TYPE.getAddressState = () => address;
        }
        expect(sends).toHaveLength(0);
        expect(reasonsByChannel()).toEqual({
            specDisabled: "disabled", specChanged: "changed", specAddress: "address",
            specTemplate: "template"
        });
    });
});

describe("protected notes and the delivery record", () => {
    it("sends a sensitive one by the choice of the channel, recorded first", async () => {
        await forwarder.start();
        await enable("specNone", { graceTime: 0, protectedNotes: "none" });
        await enable("specPublic", { graceTime: 0, protectedNotes: "public" });
        const notification = raise({ title: "Public", protectedTitle: "Secret", noteId: "root" });
        const key = getDeliveryKey(notification.id, notification.raisedAt, "specPublic");
        let isPublicRecorded = false;
        sendImpl = async () => {
            isPublicRecorded = recordState().entries.get(key)?.publicAtMs !== undefined;
        };

        await vi.advanceTimersByTimeAsync(SECOND);
        expect(sends.map(({ channelId, payload }) => [ channelId, payload.title, payload.noteId ]))
            .toEqual([ [ "specPublic", "Public", undefined ] ]);
        expect(isPublicRecorded).toBe(true);
        expect(reasonsByChannel()).toEqual({ specNone: "protected", specPublic: null });
    });

    it("leaves out the text of a plain row once a delivery sent the public text", () => {
        const notification = raise({ title: "Bank", description: "Balance", noteId: "root" });
        const row = store.getNotification(notification.notificationId);
        if (!row) {
            throw new Error("Nothing was stored.");
        }
        const key = getDeliveryKey(notification.id, notification.raisedAt, CHANNEL);
        const context = store.getViewContext(Date.now());
        expect(buildPayload(row, key, context, false).payload)
            .toMatchObject({ title: "Bank", description: "Balance", noteId: "root" });
        expect(buildPayload(row, key, context, true)).toEqual({
            payload: {
                key, title: t("notifications.payload-title-general"), category: "general",
                attentionLevel: "high", raisedAt: notification.raisedAt
            },
            isSensitive: true
        });
    });

    it("holds back a public payload whose write failed, and an unrecorded end", async () => {
        await forwarder.start();
        await enable(CHANNEL, { graceTime: 0, protectedNotes: "public" });
        port.isWriteFailing = true;
        raise({ id: "sensitive", title: "Public", protectedTitle: "Secret" });
        await vi.advanceTimersByTimeAsync(SECOND);
        expect(sends).toHaveLength(0);
        expect(getStatus(CHANNEL)?.lastErrorCode).toBe("record");

        port.isWriteFailing = false;
        sendImpl = async () => {
            port.isWriteFailing = true;
        };
        await vi.advanceTimersByTimeAsync(MINUTE);
        expect(sends).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(HOUR);
        expect(sends).toHaveLength(1);
        expect(deliveries()[0].status).toBe("waiting");

        port.isWriteFailing = false;
        await vi.advanceTimersByTimeAsync(HOUR);
        expect(sends).toHaveLength(1);
        expect(deliveries()[0].status).toBe("sent");
    });

    it("delivers nothing while the record cannot be read, and goes on once it can", async () => {
        await enable();
        port.isReadFailing = true;
        await restart();
        raise();
        await vi.advanceTimersByTimeAsync(2 * MINUTE);
        expect(sends).toHaveLength(0);
        expect(deliveries()).toEqual([]);
        expect(notices.shown.has("trilium:forwarding:record")).toBe(true);

        port.isReadFailing = false;
        await vi.advanceTimersByTimeAsync(2 * MINUTE);
        expect(notices.shown.has("trilium:forwarding:record")).toBe(false);
        expect(sends).toHaveLength(1);
    });
});

describe("the pause after a restore, a move or a rollback", () => {
    it("pauses a database older than its record, and sends what is due after", async () => {
        await forwarder.start();
        await enable(CHANNEL, { graceTime: 0, protectedNotes: "none" });
        port.text = serializeState({ ...recordState(), mark: getEntityChangeMark() + 1000 });
        await restart();
        expect(forwarder.getPauseCauses()).toEqual([ "restore" ]);
        raise({ id: "during-pause" });
        await vi.advanceTimersByTimeAsync(MINUTE);
        expect(sends).toHaveLength(0);

        await forwarder.resume(true);
        await vi.advanceTimersByTimeAsync(SECOND);
        expect(sends).toHaveLength(1);
        expect(notices.shown.has("trilium:forwarding:paused")).toBe(false);
    });

    it("skips what was due with the choice to skip, also after a restart", async () => {
        await forwarder.start();
        await enable(CHANNEL, { graceTime: 600, protectedNotes: "none" });
        raise({ id: "waiting" });
        await forwarder.pauseFor("restore");
        raise({ id: "during-pause" });

        await forwarder.resume(false);
        await restart();
        await vi.advanceTimersByTimeAsync(HOUR);
        expect(sends).toHaveLength(0);
        expect(deliveries().map(({ status, reason }) => [ status, reason ])).toEqual([
            [ "skipped", "resume" ], [ "skipped", "resume" ]
        ]);
    });

    it("pauses a database in a place without its record, and takes its activations", async () => {
        await forwarder.start();
        await enable(CHANNEL, { graceTime: 0, protectedNotes: "none" });
        port.text = null;
        await restart();
        expect(forwarder.getPauseCauses()).toEqual([ "move" ]);

        await forwarder.resume(true);
        expect(recordState().channels.get(CHANNEL)?.isLive).toBe(true);
        raise();
        await vi.advanceTimersByTimeAsync(SECOND);
        expect(sends).toHaveLength(1);
    });

    it("pauses at a sync login beyond the newest change, once in 48 hours", async () => {
        await forwarder.start();
        const beyond = getEntityChangeMark() + 100;
        forwarder.onSyncLogin(beyond);
        await vi.advanceTimersByTimeAsync(SECOND);
        expect(forwarder.getPauseCauses()).toEqual([ "rollback" ]);

        await forwarder.resume(true);
        forwarder.onSyncLogin(beyond);
        expect(forwarder.isPaused()).toBe(false);
        vi.setSystemTime(Date.now() + 49 * HOUR);
        forwarder.onSyncLogin(beyond);
        expect(forwarder.isPaused()).toBe(true);
    });
});

describe("switchings in the delivery record", () => {
    it("runs nothing of an enabling whose write failed until a write carries it", async () => {
        await forwarder.start();
        port.isWriteFailing = true;
        expect(await enable(CHANNEL, { graceTime: 0, protectedNotes: "none" })).toBe(false);
        const activationId = getActivation(CHANNEL)?.activationId ?? "";
        expect(forwarder.getRecordHold(CHANNEL, activationId)).toBe("pending");
        raise({ id: "while-pending" });
        await vi.advanceTimersByTimeAsync(SECOND);
        expect(sends).toHaveLength(0);

        // Once a write carries it, the channel comes on and receives what is still due.
        port.isWriteFailing = false;
        await vi.advanceTimersByTimeAsync(MINUTE);
        expect(forwarder.getRecordHold(CHANNEL, activationId)).toBe("live");
        raise({ id: "after" });
        await vi.advanceTimersByTimeAsync(SECOND);
        expect(sends).toHaveLength(2);
    });

    it("takes a pushed activation numbered above its entry, and not a replay", async () => {
        await forwarder.start();
        await enable(CHANNEL, { graceTime: 0, protectedNotes: "none" });
        const own = getActivation(CHANNEL) as ActivationRecord;

        // A peer that had not seen the last switching numbers its own the same, with a later date.
        await pushActivation({ ...own, activationId: "peerOld", sequence: own.sequence },
            formatUtcDateTime(Date.now() + MINUTE));
        expect(getActivation(CHANNEL)?.activationId).toBe("peerOld");
        expect(recordState().channels.get(CHANNEL)?.activationId).toBe(own.activationId);
        raise({ id: "after-replay" });
        await vi.advanceTimersByTimeAsync(SECOND);
        expect(sends).toHaveLength(0);

        // A real switching of the peer, numbered above the record: the channel comes on.
        await pushActivation({ ...own, activationId: "peerNew", sequence: own.sequence + 5 },
            formatUtcDateTime(Date.now() + 2 * MINUTE));
        expect(recordState().channels.get(CHANNEL)).toEqual({
            activationId: "peerNew", isLive: true, sequence: own.sequence + 5
        });
        raise({ id: "after-switch" });
        await vi.advanceTimersByTimeAsync(SECOND);
        expect(sends).toHaveLength(2);
    });

    it("numbers an enabling that overlaps another after it", async () => {
        await forwarder.start();
        port.isWriteHeld = true;
        const first = enable(CHANNEL, { graceTime: 0, protectedNotes: "none" });
        await vi.advanceTimersByTimeAsync(0);
        expect(port.heldWrites).toHaveLength(1);
        const second = enable(CHANNEL, { graceTime: 0, protectedNotes: "none" });
        await vi.advanceTimersByTimeAsync(0);
        port.isWriteHeld = false;
        port.heldWrites[0]();
        expect([ await first, await second ]).toEqual([ true, true ]);

        const activation = getActivation(CHANNEL);
        expect(recordState().channels.get(CHANNEL)).toEqual({
            activationId: activation?.activationId, isLive: true, sequence: activation?.sequence
        });
        raise();
        await vi.advanceTimersByTimeAsync(SECOND);
        expect(sends).toHaveLength(1);
    });
});

describe("budgets, frontend channels and notices", () => {
    it("gives a script ten sends an hour, and a built-in producer its place", async () => {
        await forwarder.start();
        await enable(CHANNEL, { graceTime: 0, protectedNotes: "none" });
        for (let index = 0; index < 12; index++) {
            raise({ id: `flood-${index}` }, SCRIPT);
        }
        raise({ id: "built-in" });
        await vi.advanceTimersByTimeAsync(10 * MINUTE);
        expect(sends).toHaveLength(11);
        expect(sends.some(({ payload }) => payload.key === getDeliveryKey(
            "built-in", formatUtcDateTime(NOW), CHANNEL))).toBe(true);
        expect(getStatus(CHANNEL)?.counts.waitingForBudget).toBe(2);

        await vi.advanceTimersByTimeAsync(HOUR);
        expect(sends).toHaveLength(13);
    });

    it("grants a frontend delivery once per profile, and skips it without a client", async () => {
        await forwarder.start();
        const noteId = createFrontendChannel();
        await enableScript(noteId);
        raise({ id: "frontend" });
        await vi.advanceTimersByTimeAsync(SECOND);
        const announcement = messages.find((message) => message.type === "notification-forward");
        if (announcement?.type !== "notification-forward") {
            throw new Error("Nothing was announced.");
        }
        const { deliveryKey } = announcement;

        const granted = await forwarder.claim(deliveryKey, "profileA");
        expect(granted).toMatchObject({ granted: true, attempt: 1, payload: { title: "Pager" } });
        expect(granted.bundle?.script).toContain("api.delivery");
        expect((await forwarder.claim(deliveryKey, "profileA")).granted).toBe(false);
        expect((await forwarder.claim(deliveryKey, "profileB")).granted).toBe(true);
        expect(recordState().entries.get(deliveryKey)?.grants.map(({ profileId }) => profileId))
            .toEqual([ "profileA", "profileB" ]);

        cls.init(() => forwarder.reportResult(deliveryKey, "profileA"));
        expect(deliveries()[0]).toMatchObject({ status: "sent" });
        expect(() => forwarder.reportResult(deliveryKey, "stranger")).toThrow("not-found");

        clients = 0;
        const unseen = raise({ id: "nobody" });
        await vi.advanceTimersByTimeAsync(SECOND);
        expect(getSql().getRow(
            "SELECT status, reason FROM notification_deliveries WHERE deliveryKey = ?",
            [ getDeliveryKey(unseen.id, unseen.raisedAt, noteId) ]
        )).toEqual({ status: "skipped", reason: "no-client" });
    });

    it("announces a frontend delivery again until a window claims it", async () => {
        await forwarder.start();
        const noteId = createFrontendChannel();
        await enableScript(noteId);
        const notification = raise({ id: "unclaimed" });
        const deliveryKey = getDeliveryKey(notification.id, notification.raisedAt, noteId);
        const countAnnouncements = (key: string) => messages.filter((message) =>
            message.type === "notification-forward" && message.deliveryKey === key).length;
        await vi.advanceTimersByTimeAsync(SECOND);
        expect(countAnnouncements(deliveryKey)).toBe(1);

        // No window claimed it before the backend restarted.
        await restart();
        await vi.advanceTimersByTimeAsync(MINUTE);
        expect(countAnnouncements(deliveryKey)).toBe(2);
        await vi.advanceTimersByTimeAsync(5 * MINUTE);
        expect(countAnnouncements(deliveryKey)).toBe(3);
        expect((await forwarder.claim(deliveryKey, "profileA")).granted).toBe(true);
        await vi.advanceTimersByTimeAsync(HOUR);
        expect(countAnnouncements(deliveryKey)).toBe(3);

        // An announcement with no window connected ends the delivery.
        const unseen = raise({ id: "nobody-left" });
        await vi.advanceTimersByTimeAsync(SECOND);
        clients = 0;
        await vi.advanceTimersByTimeAsync(MINUTE);
        expect(getSql().getRow(
            "SELECT status, reason FROM notification_deliveries WHERE deliveryKey = ?",
            [ getDeliveryKey(unseen.id, unseen.raisedAt, noteId) ]
        )).toEqual({ status: "skipped", reason: "no-client" });
    });

    it("says once that a channel stopped, and takes it back when it runs again", async () => {
        await forwarder.start();
        await enable();
        await disable();
        await disable();
        const noticeId = `trilium:channel:${CHANNEL}:disabled`;
        expect(notices.raised.map(({ id }) => id)).toEqual([ noticeId ]);
        expect(notices.raised[0].link).toBe("#root/_hidden/_options/_optionsNotifications");

        await enable();
        expect(notices.shown.has(noticeId)).toBe(false);
        cls.init(() => writeDefinition(CHANNEL, {
            v: 1, type: "spechook", title: "Pager", config: { template: "{}" },
            configurationId: "conf1"
        }));
        await vi.advanceTimersByTimeAsync(2 * SECOND);
        expect(notices.shown.has(`trilium:channel:${CHANNEL}:changed`)).toBe(true);
    });

    it("fails a backend script channel's delivery as policy with scripting off", async () => {
        const isScriptingEnabled = config.Security.backendScriptingEnabled;
        config.Security.backendScriptingEnabled = false;
        try {
            await forwarder.start();
            const noteId = createScriptChannel("application/javascript;env=backend");
            await enableScript(noteId);
            raise({ id: "policy" });
            await vi.advanceTimersByTimeAsync(SECOND);
            expect(deliveries()[0]).toMatchObject({ status: "failed", reason: "policy" });
        } finally {
            config.Security.backendScriptingEnabled = isScriptingEnabled;
        }
    });

    it("runs no delivery and no test send while the channels are off", async () => {
        await forwarder.start();
        await enable(CHANNEL, { graceTime: 60, protectedNotes: "none" });
        const frontendId = createFrontendChannel();
        await enableScript(frontendId);
        raise({ id: "safe-mode" });
        const platform = getPlatform();
        const getEnv = platform.getEnv.bind(platform);
        vi.spyOn(platform, "getEnv").mockImplementation((key) =>
            (key === "TRILIUM_SAFE_MODE" ? "1" : getEnv(key)));

        await vi.advanceTimersByTimeAsync(2 * MINUTE);
        expect(sends).toHaveLength(0);
        expect(messages.some(({ type }) => type === "notification-forward")).toBe(false);
        expect(reasonsByChannel()).toEqual({ [CHANNEL]: "policy", [frontendId]: "policy" });
        expect(await forwarder.sendTest(CHANNEL)).toEqual({ code: "policy" });
    });

    it("runs a backend channel's deliveries only where it forwards, a test send anywhere",
        async () => {
            await forwarder.start();
            await enable(CHANNEL, { graceTime: 60, protectedNotes: "none" });
            raise({ id: "before-sync" });
            cls.init(() => optionService.setOption("syncServerHost", "https://sync.invalid"));

            await vi.advanceTimersByTimeAsync(2 * MINUTE);
            expect(sends).toHaveLength(0);
            expect(deliveries()).toEqual([
                { status: "failed", reason: "policy", channelId: CHANNEL }
            ]);
            expect(await forwarder.sendTest(CHANNEL)).toEqual({ code: "sent" });
        });
});

/** Applies a peer's `activation` row of the channel through the delivery record and sync. */
async function pushActivation(content: ActivationRecord, utcDateChanged: string) {
    const recordId = getActivationRecordId(CHANNEL);
    const entity = {
        recordId, channelId: CHANNEL, kind: "activation", content: JSON.stringify(content),
        utcDateCreated: AT, utcDateModified: utcDateChanged
    };
    const records = [ {
        entityChange: {
            entityName: "notification_channel_records", entityId: recordId, hash: "peerHash",
            isErased: false, utcDateChanged, isSynced: true, changeId: `peer${content.sequence}`,
            instanceId: "peer"
        },
        entity
    } ] as unknown as EntityChangeRecord[];
    const nowMs = Date.now();
    await forwarder.takeSyncBatch(records, nowMs, () => cls.init(() => getSql().transactional(
        () => syncUpdateService.updateEntities(records, "peer", nowMs))));
}

function createFrontendChannel() {
    return createScriptChannel("application/javascript;env=frontend");
}

function createScriptChannel(mime: string) {
    return cls.init(() => {
        const { note } = noteService.createNewNote({
            parentNoteId: "root",
            title: "Spec channel",
            type: "code",
            mime,
            content: "return api.delivery.key;"
        });
        note.setLabel("notificationChannel");
        return note.noteId;
    });
}

function enableScript(noteId: string) {
    const channel = getChannel(noteId);
    const revision = channel ? getCurrentRevision(channel).revision : null;
    if (!revision) {
        throw new Error("No revision.");
    }
    return forwarder.switchOn(noteId, (activationId, sequence) => writeActivation(noteId, {
        v: 1, activationId, sequence, revision, settings: { graceTime: 0, protectedNotes: "none" }
    }));
}
