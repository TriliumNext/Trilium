import type { NotificationRow } from "@triliumnext/commons";
import { beforeEach, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import BNotification from "../../becca/entities/bnotification.js";
import * as cls from "../context.js";
import noteService from "../notes.js";
import { getSql } from "../sql/index.js";
import {
    formatUtcDateTime,
    getMarkId,
    getNotificationId,
    HISTORY_LIMIT,
    NotificationError
} from "./model.js";
import * as store from "./store.js";

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SEALED = JSON.stringify({ v: 1, title: "AAAA" });
const TABLES = [
    "notifications", "notification_marks", "notification_private_texts",
    "notification_channel_records"
];

let counter = 0;

/** A new ID for each test, so that no test meets the generations of another. */
function newId() {
    return `spec:store:${++counter}`;
}

function input(id: string, timeMs: number, overrides: Partial<store.GenerationInput> = {}) {
    return {
        id,
        raisedAt: formatUtcDateTime(timeMs),
        tag: null,
        noteId: null,
        category: "general",
        type: "standard",
        attentionLevel: "low",
        isSensitive: false,
        producer: "client",
        content: JSON.stringify({ v: 1, title: "Title" }),
        ...overrides
    } satisfies store.GenerationInput;
}

function raise(id: string, timeMs: number, options: store.RaiseOptions = {}) {
    return cls.init(() => store.raise(input(id, timeMs), { nowMs: NOW, ...options }));
}

/** Stores a generation as sync stores it, without the rules of a raise. */
function storeRow(id: string, timeMs: number, overrides: Partial<NotificationRow> = {}) {
    const at = formatUtcDateTime(timeMs);
    const row: NotificationRow = {
        ...input(id, timeMs),
        notificationId: getNotificationId(id, timeMs),
        utcDateCreated: at,
        utcDateModified: at,
        ...overrides
    };
    return cls.init(() => new BNotification(row).save());
}

function erase(notificationId: string, nowMs = NOW) {
    cls.init(() => store.eraseNotifications([ notificationId ], nowMs));
}

interface StoredChange {
    id: number;
    hash: string;
    isErased: number;
    utcDateChanged: string;
}

function entityChange(entityName: string, entityId: string) {
    return getSql().getRowOrNull<StoredChange>(
        /*sql*/`SELECT id, hash, isErased, utcDateChanged FROM entity_changes
            WHERE entityName = ? AND entityId = ?`, [ entityName, entityId ]);
}

function viewOf(nowMs = NOW) {
    return cls.init(() => store.getView(nowMs))
        .map(({ row, state }) => `${row.id}@${row.raisedAt}:${state}`);
}

beforeEach(() => {
    cls.init(() => {
        for (const table of TABLES) {
            getSql().execute(`DELETE FROM ${table}`);
        }
        getSql().executeMany("DELETE FROM entity_changes WHERE entityName IN (???)", TABLES);
    });
    becca.notifications = {};
    becca.notificationMarks = {};
    becca.notificationPrivateTexts = {};
    becca.notificationChannelRecords = {};
});

describe("raise", () => {
    it("stores a new generation with both dates at its time", () => {
        const id = newId();
        const { outcome, notification } = raise(id, NOW - HOUR);

        expect(outcome).toBe("new");
        const at = formatUtcDateTime(NOW - HOUR);
        expect(notification).toMatchObject({
            notificationId: getNotificationId(id, NOW - HOUR),
            utcDateCreated: at,
            utcDateModified: at
        });
        expect(becca.getNotification(notification?.notificationId ?? "")).toBe(notification);
        expect(entityChange("notifications", notification?.notificationId ?? "")).toMatchObject({
            hash: notification?.generateHash(), isErased: 0, utcDateChanged: at
        });
    });

    it("gives the stored generation back for the same event, and writes nothing", () => {
        const id = newId();
        const first = raise(id, NOW).notification;
        const before = entityChange("notifications", first?.notificationId ?? "");

        expect(raise(id, NOW)).toEqual({ outcome: "stored", notification: first });
        expect(entityChange("notifications", first?.notificationId ?? "")).toEqual(before);
    });

    it("erases the older generations of the ID with their marks and private text", () => {
        const id = newId();
        const older = getNotificationId(id, NOW - 2 * HOUR);
        raise(id, NOW - 2 * HOUR);
        cls.init(() => {
            store.writeMark(older, "read", NOW);
            store.writePrivateText(older, SEALED, NOW);
        });

        expect(raise(id, NOW - HOUR).outcome).toBe("new");

        expect(becca.getNotification(older)).toBeNull();
        expect(becca.getNotificationMark(getMarkId(older, "read"))).toBeNull();
        expect(becca.getNotificationPrivateText(older)).toBeNull();
        expect(getSql().getValue("SELECT COUNT(*) FROM notification_marks")).toBe(0);
        expect(getSql().getValue("SELECT COUNT(*) FROM notification_private_texts")).toBe(0);
        expect(entityChange("notifications", older)).toMatchObject({
            isErased: 1, utcDateChanged: formatUtcDateTime(NOW)
        });
        expect(entityChange("notification_marks", getMarkId(older, "read"))).toBeNull();
        expect(entityChange("notification_private_texts", older)).toBeNull();
        expect(viewOf()).toEqual([ `${id}@${formatUtcDateTime(NOW - HOUR)}:pending` ]);
    });

    it("refuses a late replay and a raise of an erased or covered generation", () => {
        const id = newId();
        const newer = raise(id, NOW).notification?.notificationId ?? "";

        expect(raise(id, NOW - HOUR)).toEqual({ outcome: "late", notification: null });
        erase(newer);
        expect(raise(id, NOW).outcome).toBe("erased");
        expect(raise(id, NOW - HOUR).outcome).toBe("erased");
        expect(raise(id, NOW + 1).outcome).toBe("new");
    });

    it("stores nothing for a category that is off", () => {
        const id = newId();
        expect(raise(id, NOW, { isCategoryOff: true }))
            .toEqual({ outcome: "categoryOff", notification: null });
        expect(store.getGenerations(id)).toEqual([]);
    });

    it("counts no generation and no erasure that is dated ahead", () => {
        const id = newId();
        const ahead = raise(id, NOW + 2 * DAY, { nowMs: NOW + 2 * DAY }).notification;
        const otherId = newId();
        raise(otherId, NOW + 2 * DAY, { nowMs: NOW + 2 * DAY });
        erase(getNotificationId(otherId, NOW + 2 * DAY), NOW + 2 * DAY);

        expect(raise(id, NOW).outcome).toBe("new");
        expect(raise(otherId, NOW).outcome).toBe("new");
        // The newer generation dated ahead is not older, so the raise leaves it.
        expect(becca.getNotification(ahead?.notificationId ?? "")).toBe(ahead);
        expect(viewOf().sort()).toEqual([
            `${id}@${formatUtcDateTime(NOW)}:pending`,
            `${otherId}@${formatUtcDateTime(NOW)}:pending`
        ].sort());
    });

    it("refuses a time more than an hour ahead and a row that fails its checks", () => {
        const id = newId();
        const codeOf = (fn: () => unknown) => {
            try {
                cls.init(fn);
            } catch (e) {
                return e instanceof NotificationError ? e.code : e;
            }
            return null;
        };

        expect(codeOf(() => store.raise(input(id, NOW + 2 * HOUR), { nowMs: NOW })))
            .toBe("raised-ahead");
        expect(codeOf(() => store.raise({ ...input(id, NOW), raisedAt: "now" }, { nowMs: NOW })))
            .toBe("invalid-row");
        expect(codeOf(() => store.raise(input("spec store", NOW), { nowMs: NOW })))
            .toBe("invalid-row");
        expect(codeOf(() => store.raise(input(id, NOW, { content: "{}" }), { nowMs: NOW })))
            .toBe("invalid-content");
        expect(getSql().getValue("SELECT COUNT(*) FROM notifications")).toBe(0);
    });

    it("trims the history to its limit, read ones first", () => {
        const ids = Array.from({ length: HISTORY_LIMIT }, () => newId());
        for (const [ index, id ] of ids.entries()) {
            storeRow(id, NOW - DAY - index);
        }
        const oldestRead = getNotificationId(ids[1], NOW - DAY - 1);
        cls.init(() => store.writeMark(oldestRead, "read", NOW));

        raise(newId(), NOW);

        expect(becca.getNotification(oldestRead)).toBeNull();
        expect(Object.keys(becca.notifications)).toHaveLength(HISTORY_LIMIT);
    });
});

describe("the time of a raise without one", () => {
    it("is now, or a millisecond after the newest known generation that is not dated ahead", () => {
        const id = newId();
        expect(store.getDefaultRaisedAt(id, NOW)).toBe(formatUtcDateTime(NOW));

        storeRow(id, NOW + 10);
        expect(store.getDefaultRaisedAt(id, NOW)).toBe(formatUtcDateTime(NOW + 11));

        storeRow(id, NOW + 20);
        erase(getNotificationId(id, NOW + 20));
        expect(store.getDefaultRaisedAt(id, NOW)).toBe(formatUtcDateTime(NOW + 21));

        storeRow(id, NOW + 2 * DAY);
        expect(store.getDefaultRaisedAt(id, NOW)).toBe(formatUtcDateTime(NOW + 21));
        expect(store.getErasedTimes(id)).toEqual([ NOW + 20 ]);
    });
});

describe("rewrite", () => {
    it("dates a rewrite now, or one millisecond after the stored date", () => {
        const notification = storeRow(newId(), NOW - DAY);
        const content = JSON.stringify({ v: 1, title: "Changed" });

        cls.init(() => store.rewrite(notification, { content }, NOW));
        expect(notification.utcDateModified).toBe(formatUtcDateTime(NOW));
        cls.init(() => store.rewrite(notification, { isSensitive: true }, NOW));
        expect(notification.utcDateModified).toBe(formatUtcDateTime(NOW + 1));

        expect(getSql().getRow(/*sql*/`SELECT content, isSensitive, utcDateCreated
            FROM notifications WHERE notificationId = ?`, [ notification.notificationId ]))
            .toEqual({ content, isSensitive: 1, utcDateCreated: formatUtcDateTime(NOW - DAY) });
        expect(entityChange("notifications", notification.notificationId)?.utcDateChanged)
            .toBe(formatUtcDateTime(NOW + 1));
    });

    it("refuses content that fails its checks and leaves the row", () => {
        const notification = storeRow(newId(), NOW);
        expect(() => cls.init(() => store.rewrite(notification, { content: "[]" }, NOW)))
            .toThrow("invalid-content");
        expect(notification.content).toBe(JSON.stringify({ v: 1, title: "Title" }));
    });
});

describe("marks and private texts", () => {
    it("writes a mark once, and only for a stored generation", () => {
        const notificationId = storeRow(newId(), NOW).notificationId;

        expect(cls.init(() => store.writeMark(notificationId, "seen", NOW))).toBe(true);
        expect(cls.init(() => store.writeMark(notificationId, "seen", NOW + 1))).toBe(false);
        expect(cls.init(() => store.writeMark(notificationId, "read", NOW))).toBe(true);
        expect(cls.init(() => store.writeMark(getNotificationId(newId(), NOW), "read", NOW)))
            .toBe(false);

        expect(store.getMarkKinds(notificationId)).toEqual([ "seen", "read" ]);
        expect(entityChange("notification_marks", getMarkId(notificationId, "seen"))
            ?.utcDateChanged).toBe(formatUtcDateTime(NOW));
    });

    it("writes the private text of a stored generation, and replaces it dated after itself", () => {
        const notificationId = storeRow(newId(), NOW).notificationId;
        expect(cls.init(() => store.writePrivateText(getNotificationId(newId(), NOW), SEALED, NOW)))
            .toBeNull();

        const first = cls.init(() => store.writePrivateText(notificationId, SEALED, NOW));
        const replaced = JSON.stringify({ v: 1, description: "QUJD" });
        const second = cls.init(() => store.writePrivateText(notificationId, replaced, NOW));

        expect(second).toBe(first);
        expect(second?.getPojo()).toEqual({
            notificationId,
            content: replaced,
            utcDateCreated: formatUtcDateTime(NOW),
            utcDateModified: formatUtcDateTime(NOW + 1)
        });
        expect(() => cls.init(() => store.writePrivateText(notificationId, "{}", NOW)))
            .toThrow("invalid-content");
    });
});

describe("erasure", () => {
    it("erases only stored generations, and deletes the parts of any", () => {
        const notificationId = storeRow(newId(), NOW).notificationId;
        const absent = getNotificationId(newId(), NOW);
        cls.init(() => store.writeMark(notificationId, "read", NOW));

        cls.init(() => store.deleteParts([ notificationId ]));
        expect(getSql().getValue("SELECT COUNT(*) FROM notification_marks")).toBe(0);
        expect(becca.getNotification(notificationId)).not.toBeNull();

        erase(absent);
        expect(entityChange("notifications", absent)).toBeNull();
        expect(store.isErased(absent)).toBe(false);
        erase(notificationId);
        expect(store.isErased(notificationId)).toBe(true);
    });

    it("covers the older generations of an ID by an erasure that is not dated ahead", () => {
        const id = newId();
        const older = getNotificationId(id, NOW - HOUR);
        const newer = storeRow(id, NOW).notificationId;
        erase(newer);

        expect(store.isCovered(older, NOW)).toBe(true);
        expect(store.isCovered(newer, NOW)).toBe(false);

        const aheadId = newId();
        storeRow(aheadId, NOW + 2 * DAY);
        erase(getNotificationId(aheadId, NOW + 2 * DAY));
        expect(store.isCovered(getNotificationId(aheadId, NOW), NOW)).toBe(false);
        expect(store.isCovered(getNotificationId(aheadId, NOW), NOW + 2 * DAY)).toBe(true);
    });
});

describe("housekeeping", () => {
    it("erases what a newer or an erased generation covers, and leaves what is dated ahead", () => {
        const id = newId();
        storeRow(id, NOW - 2 * HOUR);
        storeRow(id, NOW - HOUR);
        const ahead = storeRow(id, NOW + 2 * DAY).notificationId;
        const coveredId = newId();
        const covered = storeRow(coveredId, NOW - HOUR).notificationId;
        storeRow(coveredId, NOW);
        erase(getNotificationId(coveredId, NOW));

        cls.init(() => store.runHousekeeping(NOW));

        expect(store.getGenerations(id).map(({ notificationId }) => notificationId).sort())
            .toEqual([ getNotificationId(id, NOW - HOUR), ahead ].sort());
        expect(store.isErased(getNotificationId(id, NOW - 2 * HOUR))).toBe(true);
        expect(store.isErased(covered)).toBe(true);
    });

    it("erases the notifications whose note is deleted, by noteId and by link", () => {
        const note = cls.init(() => noteService.createNewNote({
            parentNoteId: "root", title: "spec note", content: "", type: "text"
        }).note);
        const keptNote = cls.init(() => noteService.createNewNote({
            parentNoteId: "root", title: "spec note kept", content: "", type: "text"
        }).note);
        const byNoteId = storeRow(newId(), NOW, { noteId: note.noteId }).notificationId;
        const byLink = storeRow(newId(), NOW, {
            content: JSON.stringify({ v: 1, link: `#root/${note.noteId}` })
        }).notificationId;
        const kept = storeRow(newId(), NOW, { noteId: keptNote.noteId }).notificationId;
        const notHeld = storeRow(newId(), NOW, { noteId: "noteNotHeldHere" }).notificationId;
        cls.init(() => note.deleteNote());

        cls.init(() => store.runHousekeeping(NOW));

        expect([ byNoteId, byLink, kept, notHeld ].map(store.isErased))
            .toEqual([ true, true, false, false ]);
    });

    it("deletes the marks and private texts of erased notifications, but not waiting ones", () => {
        const erased = storeRow(newId(), NOW).notificationId;
        cls.init(() => {
            store.writeMark(erased, "seen", NOW);
            store.writePrivateText(erased, SEALED, NOW);
        });
        // Rows that an erasure missed, as a consistency check can leave them.
        cls.init(() => getSql().execute("DELETE FROM notifications"));
        cls.init(() => getSql().execute(/*sql*/`UPDATE entity_changes SET isErased = 1
            WHERE entityName = 'notifications' AND entityId = ?`, [ erased ]));
        delete becca.notifications[erased];
        const waiting = getNotificationId(newId(), NOW);
        cls.init(() => getSql().execute(/*sql*/`INSERT INTO notification_marks
            VALUES (?, ?, 'read', ?)`,
        [ getMarkId(waiting, "read"), waiting, formatUtcDateTime(NOW) ]));

        cls.init(() => store.runHousekeeping(NOW));

        expect(getSql().getColumn("SELECT notificationId FROM notification_marks"))
            .toEqual([ waiting ]);
        expect(getSql().getValue("SELECT COUNT(*) FROM notification_private_texts")).toBe(0);
        expect(becca.getNotificationMark(getMarkId(erased, "seen"))).toBeNull();
        expect(becca.getNotificationPrivateText(erased)).toBeNull();
    });
});
