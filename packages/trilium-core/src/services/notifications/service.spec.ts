import type { NotificationRow, WebSocketMessage } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca.js";
import BNotification from "../../becca/entities/bnotification.js";
import type BNote from "../../becca/entities/bnote.js";
import * as cls from "../context.js";
import { addDeviceRecordEntries, readDeviceRecord } from "../device_records.js";
import { getLog } from "../log.js";
import noteService from "../notes.js";
import optionService from "../options.js";
import protectedSessionService from "../protected_session.js";
import { getSql } from "../sql/index.js";
import syncUpdateService, { getLastSyncedBatchTime } from "../sync_update.js";
import TaskContext from "../task_context.js";
import { randomString } from "../utils/index.js";
import { getNotificationService, raiseWrongCodeNotice } from "./index.js";
import { formatUtcDateTime, getMarkId, getNotificationId, NotificationError } from "./model.js";
import {
    deriveKey,
    NOTIFICATION_KEY_LABEL,
    NOTIFICATION_MAC_LABEL,
    sealPrivateText
} from "./protected_text.js";
import NotificationService, {
    type NotificationProducer,
    type NotificationStore,
    RaiseBudgets
} from "./service.js";
import * as store from "./store.js";

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const AT = formatUtcDateTime(NOW);
const DATA_KEY = Uint8Array.from({ length: 16 }, (_, index) => 100 + index);
const OTHER_DATA_KEY = Uint8Array.from({ length: 16 }, (_, index) => 200 + index);
const CLIENT: NotificationProducer = { kind: "client", sessionId: "session-a" };
const SCRIPT: NotificationProducer = { kind: "script", noteId: "spec0script" };
const BUILT_IN: NotificationProducer = { kind: "built-in", name: "trilium:spec" };
const TABLES = [
    "notifications", "notification_marks", "notification_private_texts",
    "notification_channel_records"
];

let service: NotificationService;
let sent: WebSocketMessage[];
let disabledCategories: string[];

beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    clearNotifications();
    sent = [];
    disabledCategories = [];
    service = makeService();
});

/** A service on the spec's database whose store functions can be replaced. */
function makeService(overrides: Partial<NotificationStore> = {}) {
    return new NotificationService({
        store: { ...store, ...overrides },
        transport: { send: (message) => sent.push(message) },
        settings: { isCategoryOff: (category) => disabledCategories.includes(category) },
        getLastSyncedBatchTime
    });
}

/** A service whose store counts how often the timer of rows dated ahead is armed. */
function makeCountingService() {
    const counter = { armings: 0 };
    const counted = makeService({
        getEarliestTimeAhead: (nowMs?: number) => {
            counter.armings++;
            return store.getEarliestTimeAhead(nowMs);
        }
    });
    return { counted, counter };
}

afterEach(() => {
    service.stop();
    protectedSessionService.resetDataKey();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function clearNotifications() {
    cls.init(() => getSql().transactional(() => {
        for (const table of TABLES) {
            getSql().execute(`DELETE FROM ${table}`);
            getSql().execute("DELETE FROM entity_changes WHERE entityName = ?", [ table ]);
        }
    }));
    becca.notifications = {};
    becca.notificationMarks = {};
    becca.notificationPrivateTexts = {};
    becca.notificationChannelRecords = {};
}

function create(input: Record<string, unknown>, producer: NotificationProducer = CLIENT) {
    return cls.init(() => service.create({ title: "Title", ...input }, producer));
}

function createStored(input: Record<string, unknown>, producer: NotificationProducer = CLIENT) {
    const { notification } = create(input, producer);
    if (!notification) {
        throw new Error("Nothing was stored.");
    }
    return notification;
}

function update(id: string, patch: unknown, expected?: string, producer = CLIENT) {
    return cls.init(() => service.update(id, patch, producer, expected));
}

function codeOf(run: () => unknown) {
    try {
        run();
        return null;
    } catch (e) {
        return e instanceof NotificationError ? e.code : `thrown: ${e}`;
    }
}

function getById(id: string) {
    return cls.init(() => service.getById(id));
}

/** A row of `notifications` as the database stores it. */
function rowOf(id: string, timeMs: number, overrides: Record<string, unknown> = {}) {
    const at = formatUtcDateTime(timeMs);
    const row: Record<string, unknown> = {
        id,
        raisedAt: at,
        tag: null,
        noteId: null,
        category: "general",
        type: "standard",
        attentionLevel: "medium",
        isSensitive: 0,
        producer: "client",
        content: JSON.stringify({ v: 1, title: "Stored title" }),
        utcDateCreated: at,
        utcDateModified: at,
        ...overrides
    };
    return { ...row, notificationId: getNotificationId(id, timeMs) };
}

/** Stores a generation without the rules of a raise, as sync stores what it brings. */
function storeRow(id: string, timeMs: number, overrides: Partial<NotificationRow> = {}) {
    const row = { ...rowOf(id, timeMs), isSensitive: false, ...overrides } as NotificationRow;
    return cls.init(() => new BNotification(row).save());
}

/** Applies a change of another instance through `updateEntities()`, as a push or a pull does. */
function syncIn(entityName: string, entityId: string, row: Record<string, unknown>) {
    const utcDateChanged = String(row.utcDateModified ?? row.utcDateCreated);
    cls.init(() => getSql().transactional(() => syncUpdateService.updateEntities([ {
        entityChange: {
            entityName, entityId, hash: randomString(10), isErased: false, isSynced: true,
            utcDateChanged, changeId: randomString(12), componentId: null, instanceId: "peer"
        },
        entity: row
    } ], "peer")));
}

function syncInMark(notificationId: string, kind: "seen" | "read" | "sensitive") {
    syncIn("notification_marks", getMarkId(notificationId, kind), {
        markId: getMarkId(notificationId, kind), notificationId, kind,
        utcDateCreated: formatUtcDateTime(Date.now())
    });
}

function createNote(title: string, isProtected = false): BNote {
    return cls.init(() => noteService.createNewNote({
        parentNoteId: "root", title, content: "<p>Body</p>", type: "text", isProtected
    }).note);
}

function protect(note: BNote) {
    cls.init(() => noteService.protectNoteRecursively(note, true, false,
        new TaskContext("spec-protect", "protectNotes", { protect: true })));
}

function alerts() {
    return sent.flatMap((message) =>
        message.type === "notification-alert" ? [ message.notificationId ] : []);
}

function countOf(type: WebSocketMessage["type"]) {
    return sent.filter((message) => message.type === type).length;
}

function storedRow(notificationId: string) {
    return getSql().getRowOrNull<{ isSensitive: number; content: string }>(
        "SELECT isSensitive, content FROM notifications WHERE notificationId = ?",
        [ notificationId ]);
}

describe("create", () => {
    it.each([
        [ "a new generation", () => {}, "new", true ],
        [ "the same generation again", (id: string) => create({ id, raisedAt: AT }), "stored",
            true ],
        [ "a dismissed generation", (id: string) => dismiss(id, NOW), "erased", false ],
        [ "a generation older than a stored one",
            (id: string) => create({ id, raisedAt: formatUtcDateTime(NOW + 1) }), "late", false ],
        [ "a generation older than a dismissed one", (id: string) => dismiss(id, NOW + 1),
            "erased", false ],
        [ "a category that is off", () => disabledCategories.push("general"), "categoryOff",
            false ]
    ])("decides %s", (_label, setUp, outcome, isStored) => {
        const id = "spec:outcome";
        setUp(id);
        const result = create({ id, raisedAt: AT });
        expect(result.outcome).toBe(outcome);
        expect(!!result.notification).toBe(isStored);
        expect(!!store.getNotification(getNotificationId(id, NOW))).toBe(isStored);
    });

    function dismiss(id: string, timeMs: number) {
        const notification = createStored({ id, raisedAt: formatUtcDateTime(timeMs) });
        cls.init(() => service.dismiss([ notification ], "user"));
    }

    it("generates an ID, and dates a raise without a time after the newest of its ID", () => {
        const first = createStored({});
        expect(first.id).toMatch(/^[A-Za-z0-9]{16}$/);
        expect(first.raisedAt).toBe(AT);
        expect(createStored({}).id).not.toBe(first.id);

        const again = createStored({ id: first.id });
        expect(again.raisedAt).toBe(formatUtcDateTime(NOW + 1));
        expect(store.getNotification(first.notificationId)).toBeNull();
    });

    it("writes the producer and keeps the built-in names for built-in producers", () => {
        expect(createStored({ id: "spec:client" }).producer).toBe("client");
        expect(createStored({ id: "spec:script" }, SCRIPT).producer).toBe("script:spec0script");
        const builtIn = createStored(
            { id: "trilium:spec:a", tag: "trilium:spec", handler: "trilium:spec" }, BUILT_IN);
        expect(builtIn).toMatchObject({ producer: "trilium:spec", tag: "trilium:spec" });

        for (const producer of [ CLIENT, SCRIPT ]) {
            expect(codeOf(() => create({ id: "trilium:x" }, producer))).toBe("reserved-name");
            expect(codeOf(() => create({ tag: "trilium:x" }, producer))).toBe("reserved-name");
            expect(codeOf(() => create({ handler: "trilium:x" }, producer)))
                .toBe("reserved-name");
            expect(codeOf(() => update("trilium:spec:a", { title: "x" }, undefined, producer)))
                .toBe("reserved-name");
        }
        expect(update("trilium:spec:a", { title: "Changed" }, undefined, BUILT_IN).title)
            .toBe("Changed");
    });

    it("gives the view of a notification, without the fields it does not have", () => {
        const notification = createStored({
            id: "spec:view", description: "Description", icon: "bx bx-bell", tag: "spec:tag",
            attentionLevel: "high", type: "persistent", progress: 0.5,
            actions: [ { id: "done", caption: "Done" } ], handler: "spec:handler"
        });
        expect(notification).toEqual({
            notificationId: getNotificationId("spec:view", NOW),
            id: "spec:view",
            raisedAt: AT,
            updatedAt: AT,
            revision: expect.any(String),
            category: "general",
            type: "persistent",
            attentionLevel: "high",
            state: "pending",
            producer: "client",
            tag: "spec:tag",
            title: "Title",
            description: "Description",
            icon: "bx bx-bell",
            progress: 0.5,
            actions: [ { id: "done", caption: "Done" } ],
            handler: "spec:handler"
        });
        expect(cls.init(() => service.getByTag("spec:tag"))).toEqual([ notification ]);
    });
});

describe("update", () => {
    it("rewrites the current generation, after its stored date, and checks the revision", () => {
        const notification = createStored({ id: "spec:update", description: "Old" });
        vi.advanceTimersByTime(SECOND);

        const updated = update("spec:update", { title: "New", description: "" },
            notification.revision);
        expect(updated).toMatchObject({ title: "New", updatedAt: formatUtcDateTime(NOW + SECOND) });
        expect(updated.description).toBeUndefined();
        expect(updated.revision).not.toBe(notification.revision);

        expect(codeOf(() => update("spec:update", { title: "Stale" }, notification.revision)))
            .toBe("stale-revision");
        expect(codeOf(() => update("spec:missing", { title: "x" }))).toBe("not-found");
        expect(codeOf(() => update("spec:update", { title: "a\nb" }))).toBe("invalid-input");
        expect(codeOf(() => update("spec:update", {}, 12 as never))).toBe("invalid-input");
        expect(getById("spec:update")?.title).toBe("New");
    });
});

describe("state and dismissal", () => {
    it("marks generations, and never lowers a state", () => {
        const notification = createStored({ id: "spec:state" });
        cls.init(() => service.setState([ notification ], "read"));
        cls.init(() => service.setState([ notification ], "seen"));
        expect(getById("spec:state")?.state).toBe("read");
        expect(codeOf(() => service.setState([ notification ], "pending"))).toBe("invalid-input");
        expect(codeOf(() => service.setState(Array(501).fill(notification), "seen")))
            .toBe("invalid-input");
    });

    it("leaves a persistent notification to a dismissal by the user, and erases the rest", () => {
        const persistent = createStored({ id: "spec:persistent", type: "persistent" });
        const standard = createStored({ id: "spec:standard" });

        expect(cls.init(() => service.dismiss([ persistent, standard ], "user")))
            .toEqual({ refused: 1 });
        expect(getById("spec:standard")).toBeNull();
        expect(getById("spec:persistent")).not.toBeNull();
        expect(codeOf(() => service.dismiss([ persistent ], "other"))).toBe("invalid-input");

        cls.init(() => service.dismiss([ persistent ], "force"));
        expect(getById("spec:persistent")).toBeNull();
        expect(store.isErased(persistent.notificationId)).toBe(true);

        createStored({ id: "spec:by-id" });
        cls.init(() => service.dismissById("spec:by-id"));
        expect(getById("spec:by-id")).toBeNull();
    });
});

describe("what the result of a handler applies to", () => {
    it("leaves a generation raised again, and drops an update once the content changed", () => {
        const given = createStored({ id: "spec:handler" });
        vi.advanceTimersByTime(MINUTE);
        const again = createStored({ id: "spec:handler" });
        expect(again.notificationId).not.toBe(given.notificationId);

        // The dismissal of the generation that the handler was given leaves the newer one.
        cls.init(() => service.dismiss([ given ], "handler"));
        expect(getById("spec:handler")?.notificationId).toBe(again.notificationId);

        update("spec:handler", { description: "Edited elsewhere" });
        expect(codeOf(() => update("spec:handler", { description: "From the handler" },
            again.revision))).toBe("stale-revision");
        expect(getById("spec:handler")?.description).toBe("Edited elsewhere");
    });

    it("drops an update once the private text alone changed, and keeps the newer one", () => {
        protectedSessionService.setDataKey(DATA_KEY);
        const given = createStored({ id: "spec:handler:private", title: "A reminder is due",
            protectedDescription: "First plan" });
        const contentBefore = storedRow(given.notificationId)?.content;
        vi.advanceTimersByTime(SECOND);

        update("spec:handler:private", { protectedDescription: "Second plan" });
        expect(storedRow(given.notificationId)?.content).toBe(contentBefore);
        expect(codeOf(() => update("spec:handler:private",
            { protectedDescription: "From the handler" }, given.revision))).toBe("stale-revision");
        expect(getById("spec:handler:private")?.protectedDescription).toBe("Second plan");
    });
});

describe("transient notifications", () => {
    it("are on the first page with their counter, and a client's end after a minute", () => {
        const token = service.putTransient("spec-client", { title: "Import" }, CLIENT);
        service.putTransient("spec-script", { title: "Script" }, SCRIPT);
        expect(service.putTransient("spec-client", { title: "Import", progress: 0.5 }, CLIENT,
            token)).toBe(token);

        const first = service.getPage();
        expect(first.transients?.map(({ id, producer }) => [ id, producer ])).toEqual([
            [ "spec-client", "client" ], [ "spec-script", "script:spec0script" ]
        ]);
        expect(first.transientSeq).toBe(0);
        vi.advanceTimersByTime(300);
        expect(service.getPage().transientSeq).toBe(1);
        expect(countOf("transient-notifications")).toBe(1);

        vi.advanceTimersByTime(MINUTE);
        expect(service.getPage().transients?.map(({ id }) => id)).toEqual([ "spec-script" ]);
        expect(codeOf(() => service.dismissTransient("spec-script", token))).toBe("not-owner");
    });

    it("count the limit of 10 per session of a client", () => {
        const other: NotificationProducer = { kind: "client", sessionId: "session-b" };
        for (let index = 0; index < 10; index++) {
            service.putTransient(`spec-a-${index}`, { title: "A" }, CLIENT);
        }
        expect(codeOf(() => service.putTransient("spec-a-10", { title: "A" }, CLIENT)))
            .toBe("transient-limit");
        expect(codeOf(() => service.putTransient("spec-b", { title: "B" }, other))).toBeNull();
        expect(codeOf(() => service.putTransient("trilium:spec", { title: "B" }, other)))
            .toBe("reserved-name");
        expect(codeOf(() => service.putTransient("trilium:spec", { title: "B" }, BUILT_IN)))
            .toBeNull();
    });
});

describe("the list in pages", () => {
    it("pages the view newest first, with the counts on the first page", () => {
        cls.init(() => getSql().transactional(() => {
            for (let index = 0; index < 450; index++) {
                storeRow(`spec:page:${index}`, NOW - index * SECOND, { type: "persistent" });
            }
        }));
        const read = createStored({ id: "spec:page:read", raisedAt: formatUtcDateTime(NOW - DAY) });
        const seen = createStored({ id: "spec:page:seen", raisedAt: formatUtcDateTime(NOW - DAY) });
        cls.init(() => service.setState([ read ], "read"));
        cls.init(() => service.setState([ seen ], "seen"));

        const first = service.getPage();
        expect(first.notifications).toHaveLength(200);
        expect(first.notifications[0].id).toBe("spec:page:0");
        expect(first.next).toBe(first.notifications[199].notificationId);
        expect(first.changeId).toBe(store.getMaxEntityChangeId());
        expect(first.counts).toEqual({
            total: 452, pending: 450, unread: 451, live: 452, dailyBudgetReached: []
        });

        const second = service.getPage(first.next);
        expect(second.notifications[0].id).toBe("spec:page:200");
        expect(second.counts).toBeUndefined();
        const third = service.getPage(second.next);
        const lastIds = third.notifications.map(({ id }) => id).slice(-3);
        expect(lastIds[0]).toBe("spec:page:449");
        expect(lastIds.slice(1).sort()).toEqual([ "spec:page:read", "spec:page:seen" ]);
        expect(third.notifications).toHaveLength(52);
        expect(third.next).toBeUndefined();
        expect(codeOf(() => service.getPage("not a key"))).toBe("invalid-input");
    });
});

describe("the limit on what an instance admits", () => {
    function fill(count: number) {
        cls.init(() => getSql().transactional(() => {
            for (let index = 0; index < count; index++) {
                storeRow(`spec:fill:${index}`, NOW - DAY - index, { type: "persistent" });
            }
        }));
    }

    it("refuses a new raise of a script or a client from 800, and of a built-in from 1,000", () => {
        const logError = vi.spyOn(getLog(), "error");
        fill(799);
        const last = createStored({ id: "spec:limit:last" });

        expect(codeOf(() => create({ id: "spec:limit:client" }))).toBe("full");
        expect(codeOf(() => create({ id: "spec:limit:script" }, SCRIPT))).toBe("full");
        expect(create({ id: "spec:limit:last", raisedAt: last.raisedAt }).outcome).toBe("stored");
        expect(create({ id: "trilium:spec:built-in" }, BUILT_IN).outcome).toBe("new");
        expect(countOf("toast")).toBe(1);
        expect(logError).toHaveBeenCalledTimes(1);

        fill(1000);
        expect(codeOf(() => create({ id: "trilium:spec:refused" }, BUILT_IN))).toBe("full");
        cls.init(() => service.dismissById("spec:fill:0"));
        expect(codeOf(() => create({ id: "trilium:spec:refused" }, BUILT_IN))).toBe("full");
        expect(store.getStoredNotifications()).toHaveLength(1001);
    });
});

describe("budgets", () => {
    it("counts 30 a minute per producer, 120 for those not built in, and 500 a day", () => {
        const budgets = new RaiseBudgets();
        const drawMany = (key: string, count: number, isBuiltIn = false, atMs = NOW) => {
            for (let index = 0; index < count; index++) {
                budgets.draw(key, key.split(":")[0], isBuiltIn, atMs);
            }
        };

        drawMany("client:a", 30);
        expect(budgets.check("client:a", false, NOW)).toBe("budget");
        expect(budgets.check("client:a", false, NOW + MINUTE)).toBeNull();
        drawMany("client:b", 30);
        drawMany("script:c", 30);
        drawMany("script:d", 29);
        expect(budgets.check("script:e", false, NOW)).toBeNull();
        drawMany("script:d", 1);
        expect(budgets.check("script:e", false, NOW)).toBe("budget");
        expect(budgets.check("trilium:x", true, NOW)).toBeNull();
        drawMany("trilium:x", 30, true);
        expect(budgets.check("trilium:x", true, NOW)).toBe("budget");
        expect(budgets.getWait("trilium:x", NOW + 10 * SECOND)).toBe(50 * SECOND);

        for (let minute = 1; minute < 17; minute++) {
            drawMany("script:c", 30, false, NOW + minute * MINUTE);
        }
        expect(budgets.check("script:c", false, NOW + 17 * MINUTE)).toBe("daily-budget");
        expect(budgets.getDailyBudgetReached(NOW + 17 * MINUTE)).toEqual([ "script" ]);
        expect(budgets.check("script:c", false, NOW + DAY + MINUTE)).toBeNull();
    });

    it("drops a raise over the budget, with one log line and one toast a minute", () => {
        const logError = vi.spyOn(getLog(), "error");
        for (let index = 0; index < 30; index++) {
            create({ id: `spec:budget:${index}` });
        }

        expect(codeOf(() => create({ id: "spec:budget:over" }))).toBe("budget");
        expect(codeOf(() => create({ id: "spec:budget:over2" }))).toBe("budget");
        expect(codeOf(() => update("spec:budget:0", { title: "x" }))).toBe("budget");
        expect(countOf("toast")).toBe(1);
        expect(logError).toHaveBeenCalledTimes(1);
        expect(create({ id: "spec:other-session" }, { kind: "client", sessionId: "b" }).outcome)
            .toBe("new");

        vi.advanceTimersByTime(MINUTE);
        expect(create({ id: "spec:budget:later" }).outcome).toBe("new");
    });

    it("queues a built-in raise over its budget, and writes it once the budget allows", () => {
        for (let index = 0; index < 30; index++) {
            create({ id: `trilium:spec:${index}` }, BUILT_IN);
        }
        expect(create({ id: "trilium:spec:queued-1" }, BUILT_IN).outcome).toBe("queued");
        expect(create({ id: "trilium:spec:queued-2" }, BUILT_IN).outcome).toBe("queued");
        expect(getById("trilium:spec:queued-1")).toBeNull();

        vi.advanceTimersByTime(MINUTE);
        const first = getById("trilium:spec:queued-1");
        const second = getById("trilium:spec:queued-2");
        expect(first && second && first.raisedAt <= second.raisedAt).toBe(true);
    });
});

describe("alerts", () => {
    it("alerts once for a fresh pending raise of level medium or high, after its write", () => {
        const notification = createStored({ id: "spec:alert", attentionLevel: "high" });
        expect(alerts()).toEqual([]);
        vi.advanceTimersByTime(0);
        expect(alerts()).toEqual([ notification.notificationId ]);

        create({ id: "spec:alert", raisedAt: notification.raisedAt });
        create({ id: "spec:alert:low", attentionLevel: "low" });
        create({ id: "spec:alert:old", raisedAt: formatUtcDateTime(NOW - 11 * MINUTE) });
        const read = createStored({ id: "spec:alert:read" });
        cls.init(() => service.setState([ read ], "read"));
        vi.advanceTimersByTime(0);
        expect(alerts()).toEqual([ notification.notificationId ]);
    });

    it("alerts for a synced generation once the instance has settled, if still pending", () => {
        service.start();
        const row = rowOf("spec:synced", NOW);
        syncIn("notifications", row.notificationId, row);
        vi.advanceTimersByTime(9 * SECOND);
        expect(alerts()).toEqual([]);
        vi.advanceTimersByTime(2 * SECOND);
        expect(alerts()).toEqual([ row.notificationId ]);

        syncIn("notifications", row.notificationId,
            { ...row, utcDateModified: formatUtcDateTime(Date.now()) });
        vi.advanceTimersByTime(MINUTE);
        expect(alerts()).toEqual([ row.notificationId ]);
    });

    it("sends no alert between the two requests of a push, the row first and its mark next", () => {
        service.start();
        const row = rowOf("spec:split", NOW);
        syncIn("notifications", row.notificationId, row);
        vi.advanceTimersByTime(5 * SECOND);
        syncInMark(row.notificationId, "read");
        vi.advanceTimersByTime(MINUTE);
        expect(alerts()).toEqual([]);
    });

    it("waits for a settled instance two minutes at most", () => {
        service.start();
        const row = rowOf("spec:busy", NOW);
        syncIn("notifications", row.notificationId, row);
        for (let step = 0; step < 23; step++) {
            vi.advanceTimersByTime(5 * SECOND);
            const other = rowOf(`spec:busy:${step}`, NOW - HOUR, { attentionLevel: "low" });
            syncIn("notifications", other.notificationId, other);
        }
        expect(alerts()).toEqual([]);
        vi.advanceTimersByTime(6 * SECOND);
        expect(alerts()).toEqual([ row.notificationId ]);
    });
});

describe("sensitive notifications", () => {
    it("keeps the text of a sensitive raise private: moved in a session, else dropped", () => {
        const dropped = createStored(
            { id: "spec:sens:closed", description: "Real", sensitive: true });
        expect(dropped).toMatchObject({ sensitive: true });
        expect(dropped.title).toBeUndefined();
        expect(dropped.description).toBeUndefined();
        expect(store.hasMark(dropped.notificationId, "sensitive")).toBe(true);
        expect(store.getPrivateText(dropped.notificationId)).toBeNull();

        protectedSessionService.setDataKey(DATA_KEY);
        const moved = createStored({ id: "spec:sens:open", description: "Real", sensitive: true,
            progressLabel: "Label", actions: [ { id: "a", caption: "Caption" } ] });
        expect(moved).toMatchObject({
            sensitive: true, protectedTitle: "Title", protectedDescription: "Real",
            actions: [ { id: "a", caption: "" } ]
        });
        expect(moved.title).toBeUndefined();
        expect(moved.progressLabel).toBeUndefined();
        expect(storedRow(moved.notificationId)?.isSensitive).toBe(1);
        expect(storedRow(moved.notificationId)?.content).not.toContain("Real");

        protectedSessionService.resetDataKey();
        expect(getById("spec:sens:open")?.protectedTitle).toBeUndefined();
    });

    it("stores the root text that comes with private text as public text", () => {
        protectedSessionService.setDataKey(DATA_KEY);
        const notification = createStored({ id: "spec:sens:explicit", title: "A reminder is due",
            protectedTitle: "Call the bank", protectedDescription: "At noon" });
        expect(notification).toMatchObject({
            sensitive: true, title: "A reminder is due", protectedTitle: "Call the bank",
            protectedDescription: "At noon"
        });
        expect(storedRow(notification.notificationId)?.content).not.toContain("bank");
    });

    it("clears only the private text with the empty root text of a patch", () => {
        protectedSessionService.setDataKey(DATA_KEY);
        createStored({ id: "spec:sens:clear", title: "A reminder is due",
            description: "Open the app", protectedTitle: "Call the bank",
            protectedDescription: "At noon" });

        const { title, description, protectedTitle, protectedDescription } =
            update("spec:sens:clear", { title: "", description: "" });
        expect({ title, description, protectedTitle, protectedDescription }).toEqual({
            title: "A reminder is due", description: "Open the app",
            protectedTitle: undefined, protectedDescription: undefined
        });
    });

    it("takes a notification about a protected note, or one it lacks, as sensitive", () => {
        protectedSessionService.setDataKey(DATA_KEY);
        const note = createNote("Secret note", true);
        protectedSessionService.resetDataKey();

        const aboutProtected = createStored({ id: "spec:sens:note", noteId: note.noteId,
            title: "About the secret" });
        expect(aboutProtected.sensitive).toBe(true);
        expect(aboutProtected.title).toBeUndefined();
        const aboutMissing = createStored({ id: "spec:sens:missing", link: "#root/missing0note" });
        expect(aboutMissing.sensitive).toBe(true);
        expect(createStored({ id: "spec:sens:plain", link: "#root" }).sensitive).toBeUndefined();
    });

    it("adds the private text to a stored generation that has none that opens", () => {
        const input = { id: "spec:sens:late", raisedAt: AT, sensitive: true, title: "Real title" };
        create(input);
        const notificationId = getNotificationId("spec:sens:late", NOW);
        expect(store.getPrivateText(notificationId)).toBeNull();

        protectedSessionService.setDataKey(DATA_KEY);
        expect(create(input).notification?.protectedTitle).toBe("Real title");
        expect(create({ ...input, title: "Other title" }).notification?.protectedTitle)
            .toBe("Real title");

        // A field sealed under another key counts as absent and is written again.
        cls.init(() => store.writePrivateText(notificationId, sealPrivateText({
            encryptionKey: deriveKey(OTHER_DATA_KEY, NOTIFICATION_KEY_LABEL),
            macKey: deriveKey(OTHER_DATA_KEY, NOTIFICATION_MAC_LABEL)
        }, notificationId, { title: "Planted" })));
        expect(getById("spec:sens:late")?.protectedTitle).toBeUndefined();
        expect(create({ ...input, title: "Raised again" }).notification?.protectedTitle)
            .toBe("Raised again");
    });

    it("makes a plain notification sensitive through a patch, never plain again", () => {
        createStored({ id: "spec:sens:patch", description: "Plain description" });
        protectedSessionService.setDataKey(DATA_KEY);

        const patched = update("spec:sens:patch", { sensitive: true });
        expect(patched).toMatchObject({
            sensitive: true, protectedTitle: "Title", protectedDescription: "Plain description"
        });
        expect(patched.title).toBeUndefined();

        expect(update("spec:sens:patch", { title: "New private title", sensitive: false }))
            .toMatchObject({ sensitive: true, protectedTitle: "New private title" });
        expect(update("spec:sens:patch", { protectedDescription: "" }).protectedDescription)
            .toBeUndefined();

        protectedSessionService.resetDataKey();
        const withoutSession = update("spec:sens:patch", { protectedTitle: "Not stored" });
        expect(withoutSession.protectedTitle).toBeUndefined();
        protectedSessionService.setDataKey(DATA_KEY);
        expect(getById("spec:sens:patch")?.protectedTitle).toBe("New private title");
    });

    it("moves the text of a note's notifications to their private text at protection", () => {
        protectedSessionService.setDataKey(DATA_KEY);
        const note = createNote("Plain note");
        const notification = createStored({ id: "spec:sens:protect", noteId: note.noteId,
            title: "About the plain note", description: "Details" });
        expect(notification.sensitive).toBeUndefined();

        protect(note);
        expect(getById("spec:sens:protect")).toMatchObject({
            sensitive: true, protectedTitle: "About the plain note", protectedDescription: "Details"
        });
        expect(storedRow(notification.notificationId)?.content).not.toContain("Details");
        expect(store.hasMark(notification.notificationId, "sensitive")).toBe(true);
    });

    it("refuses a private text over 8 KiB before anything is written", () => {
        protectedSessionService.setDataKey(DATA_KEY);
        createStored({ id: "spec:sens:size", protectedDescription: "d".repeat(4000) });
        expect(codeOf(() => update("spec:sens:size", { protectedTitle: "t".repeat(5000) })))
            .toBe("too-large");
        expect(getById("spec:sens:size")?.protectedTitle).toBeUndefined();
    });
});

describe("versions that meet the fact that they are sensitive", () => {
    it("drops the text of a synced plain version where the mark or the protection is held", () => {
        service.start();
        protectedSessionService.setDataKey(DATA_KEY);
        const note = createNote("Secret note", true);

        const aboutNote = rowOf("spec:arrive:note", NOW, { noteId: note.noteId });
        syncIn("notifications", aboutNote.notificationId, aboutNote);
        expect(storedRow(aboutNote.notificationId)).toMatchObject({ isSensitive: 1 });
        expect(store.getPrivateText(aboutNote.notificationId)).toBeNull();

        const marked = rowOf("spec:arrive:mark", NOW);
        syncInMark(marked.notificationId, "sensitive");
        syncIn("notifications", marked.notificationId, marked);
        expect(storedRow(marked.notificationId)?.content).not.toContain("Stored title");

        const flagged = rowOf("spec:arrive:flag", NOW, { isSensitive: 1 });
        syncIn("notifications", flagged.notificationId, flagged);
        expect(store.hasMark(flagged.notificationId, "sensitive")).toBe(true);
        expect(storedRow(flagged.notificationId)?.content).toContain("Stored title");

        const later = storeRow("spec:arrive:later-mark", NOW);
        syncInMark(later.notificationId, "sensitive");
        expect(storedRow(later.notificationId)?.content).not.toContain("Stored title");
    });

    it.each([
        [ "row", "mark", "protection" ], [ "row", "protection", "mark" ],
        [ "mark", "row", "protection" ], [ "mark", "protection", "row" ],
        [ "protection", "row", "mark" ], [ "protection", "mark", "row" ]
    ] as const)("ends flagged and without text when the %s, %s and %s arrive in that order",
        (...order) => {
            service.start();
            const note = createNote("Note protected elsewhere");
            const noteRow = getSql().getRow<Record<string, unknown>>(
                "SELECT * FROM notes WHERE noteId = ?", [ note.noteId ]);
            const id = `spec:order:${order.join("-")}`;
            const row = rowOf(id, NOW, {
                noteId: note.noteId, content: JSON.stringify({ v: 1, title: "Order title" })
            });
            const arrive = {
                row: () => syncIn("notifications", row.notificationId, row),
                mark: () => syncInMark(row.notificationId, "sensitive"),
                protection: () => syncIn("notes", note.noteId, {
                    ...noteRow, isProtected: 1, utcDateModified: formatUtcDateTime(NOW + SECOND)
                })
            };

            for (const [ index, step ] of order.entries()) {
                arrive[step]();
                const isFactHeld = order.slice(0, index + 1).some((each) => each !== "row");
                const shown = getById(id);
                if (shown && isFactHeld) {
                    expect(shown.title, step).toBeUndefined();
                }
            }
            expect(storedRow(row.notificationId)).toMatchObject({ isSensitive: 1 });
            expect(storedRow(row.notificationId)?.content).not.toContain("Order title");
            expect(store.hasMark(row.notificationId, "sensitive")).toBe(true);
        });

    it("logs a synced row whose content does not parse by its key, without its text", () => {
        service.start();
        const logError = vi.spyOn(getLog(), "error");
        const row = rowOf("spec:unparsed", NOW, { content: "{\"v\":1,\"title\":\"Unparsed title" });
        syncIn("notifications", row.notificationId, row);

        expect(store.getNotification(row.notificationId)).toBeNull();
        expect(logError).toHaveBeenCalledWith(expect.stringContaining("invalid-content"));
        expect(JSON.stringify(logError.mock.calls)).not.toContain("Unparsed title");
    });

    it("drops the text of the notifications of a note whose protection sync brings", () => {
        service.start();
        const note = createNote("Note protected elsewhere");
        const notification = storeRow("spec:arrive:protection", NOW, { noteId: note.noteId });
        const noteRow = getSql().getRow<Record<string, unknown>>(
            "SELECT * FROM notes WHERE noteId = ?", [ note.noteId ]);
        syncIn("notes", note.noteId, {
            ...noteRow, isProtected: 1, utcDateModified: formatUtcDateTime(NOW + SECOND)
        });
        expect(storedRow(notification.notificationId)).toMatchObject({ isSensitive: 1 });
        expect(store.hasMark(notification.notificationId, "sensitive")).toBe(true);
    });

    it("shows nothing of a plain version beside the mark when the rewrite fails", () => {
        service = makeService({
            rewrite: () => {
                throw new NotificationError("internal");
            }
        });
        service.start();
        const logError = vi.spyOn(getLog(), "error");
        const row = rowOf("spec:arrive:failed", NOW,
            { content: JSON.stringify({ v: 1, title: "Recognizable title" }) });
        syncInMark(row.notificationId, "sensitive");
        syncIn("notifications", row.notificationId, row);

        expect(storedRow(row.notificationId)?.content).toContain("Recognizable title");
        const shown = getById("spec:arrive:failed");
        expect(shown?.sensitive).toBe(true);
        expect(shown?.title).toBeUndefined();
        expect(JSON.stringify(service.getPage())).not.toContain("Recognizable title");
        expect(JSON.stringify(logError.mock.calls)).not.toContain("Recognizable title");
        expect(logError).toHaveBeenCalledWith(expect.stringContaining(": internal."));
    });

    it("rewrites what was left at housekeeping, and erases notifications of deleted notes", () => {
        service.start();
        const plain = storeRow("spec:house:plain", NOW);
        cls.init(() => store.writeMark(plain.notificationId, "sensitive"));
        const flagged = storeRow("spec:house:flagged", NOW, { isSensitive: true });
        cls.init(() => service.runHousekeeping());
        expect(storedRow(plain.notificationId)).toMatchObject({ isSensitive: 1 });
        expect(store.hasMark(flagged.notificationId, "sensitive")).toBe(true);

        const note = createNote("Note to delete");
        const about = createStored({ id: "spec:house:deleted", noteId: note.noteId });
        cls.init(() => note.deleteNote());
        expect(store.isErased(about.notificationId)).toBe(true);
    });
});

describe("rows dated ahead", () => {
    it("acts when a generation dated ahead comes within the hour, and not before", () => {
        storeRow("spec:ahead", NOW + 2 * DAY, { attentionLevel: "high" });
        const { counted, counter } = makeCountingService();
        service = counted;
        service.start();

        vi.advanceTimersByTime(2 * DAY - HOUR - SECOND);
        expect(countOf("notifications-due")).toBe(0);
        expect(getById("spec:ahead")).toBeNull();
        expect(counter.armings).toBeLessThanOrEqual(3);

        vi.advanceTimersByTime(SECOND);
        expect(countOf("notifications-due")).toBe(1);
        expect(getById("spec:ahead")?.raisedAt).toBe(formatUtcDateTime(NOW + 2 * DAY));
        vi.advanceTimersByTime(SECOND);
        expect(alerts()).toEqual([ getNotificationId("spec:ahead", NOW + 2 * DAY) ]);
    });

    it("erases what an erasure dated ahead covers once its time has come", () => {
        const shown = createStored({ id: "spec:covered", raisedAt: formatUtcDateTime(NOW - HOUR) });
        const ahead = storeRow("spec:covered", NOW + DAY);
        cls.init(() => store.eraseNotifications([ ahead.notificationId ]));
        service.start();
        expect(getById("spec:covered")?.notificationId).toBe(shown.notificationId);

        vi.advanceTimersByTime(DAY - HOUR);
        expect(countOf("notifications-due")).toBe(1);
        expect(getById("spec:covered")).toBeNull();
        expect(store.isErased(shown.notificationId)).toBe(true);
    });

    it("wakes once a day for a row a month ahead, and handles rows a second apart together", () => {
        storeRow("spec:month", NOW + 30 * DAY);
        cls.init(() => getSql().transactional(() => {
            for (let index = 0; index < 100; index++) {
                storeRow(`spec:second:${index}`, NOW + DAY + index * SECOND);
            }
        }));
        const { counted, counter } = makeCountingService();
        service = counted;
        service.start();

        vi.advanceTimersByTime(DAY - HOUR + 3 * MINUTE);
        expect(countOf("notifications-due")).toBeGreaterThanOrEqual(1);
        expect(countOf("notifications-due")).toBeLessThanOrEqual(3);
        expect(service.getPage().counts?.total).toBe(100);

        sent = [];
        vi.advanceTimersByTime(28 * DAY);
        expect(countOf("notifications-due")).toBe(0);
        expect(counter.armings).toBeLessThan(40);
        vi.advanceTimersByTime(DAY);
        expect(countOf("notifications-due")).toBe(1);
    });
});

describe("what clients receive", () => {
    it("attaches a generation as the view gives it, a mark as its row, and a private text", () => {
        protectedSessionService.setDataKey(DATA_KEY);
        const notification = createStored({ id: "spec:client", protectedTitle: "Private" });
        const markId = getMarkId(notification.notificationId, "sensitive");

        expect(service.getClientEntity("notifications", notification.notificationId))
            .toEqual(notification);
        expect(service.getClientEntity("notification_marks", markId)).toMatchObject({
            markId, notificationId: notification.notificationId, kind: "sensitive"
        });
        expect(service.getClientEntity("notification_private_texts", notification.notificationId))
            .toEqual({
                notificationId: notification.notificationId, revision: notification.revision,
                protectedTitle: "Private"
            });

        protectedSessionService.resetDataKey();
        expect(service.getClientEntity("notification_private_texts", notification.notificationId))
            .toEqual({ notificationId: notification.notificationId,
                revision: notification.revision });
        expect(service.getClientEntity("notification_channel_records", "abcd")).toBeNull();
        const ahead = storeRow("spec:client:ahead", NOW + DAY);
        expect(service.getClientEntity("notifications", ahead.notificationId)).toBeNull();
    });
});

describe("the notices of the security records", () => {
    afterEach(() => {
        cls.init(() => optionService.setOption("startupRepairRecord", ""));
    });

    it("names what a start put back, and the record stays when the notice is erased", () => {
        cls.init(() => addDeviceRecordEntries("startupRepairRecord",
            [ "mfaMethod", "syncServerHost" ]));
        const notice = cls.init(() =>
            getNotificationService().getById("trilium:security:startup-repair"));
        expect(notice).toMatchObject({
            attentionLevel: "high", producer: "trilium:security", category: "general",
            link: "#root/_hidden/_options/_optionsPassword"
        });
        expect(notice?.description).toContain("mfaMethod, syncServerHost");

        cls.init(() => getNotificationService().dismissById("trilium:security:startup-repair"));
        expect(readDeviceRecord("startupRepairRecord").map(({ name }) => name))
            .toEqual([ "mfaMethod", "syncServerHost" ]);
    });

    it("names wrong codes at most once an hour", () => {
        const noticeOf = () => cls.init(() =>
            getNotificationService().getById("trilium:security:wrong-codes"));
        cls.init(() => raiseWrongCodeNotice(5));
        const first = noticeOf();
        expect(first?.description).toContain("5");

        vi.advanceTimersByTime(30 * MINUTE);
        cls.init(() => raiseWrongCodeNotice(6));
        expect(noticeOf()?.raisedAt).toBe(first?.raisedAt);
        cls.init(() => getNotificationService().dismissById("trilium:security:wrong-codes"));
        cls.init(() => raiseWrongCodeNotice(7));
        expect(noticeOf()).toBeNull();

        vi.advanceTimersByTime(30 * MINUTE);
        cls.init(() => raiseWrongCodeNotice(8));
        expect(noticeOf()?.description).toContain("8");
    });
});
