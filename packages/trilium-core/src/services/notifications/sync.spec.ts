import type { NotificationMarkKind, NotificationState } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import SyncInstances, { type SyncInstance } from "../../test/sync_instances.js";
import { getSql } from "../sql/index.js";
import { formatUtcDateTime, getTimeOfNotificationId } from "./model.js";
import * as store from "./store.js";

const START = Date.UTC(2026, 10, 27, 12, 0, 0, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SEALED = JSON.stringify({ v: 1, title: "AAAA" });
const TABLES = [
    "notifications", "notification_marks", "notification_private_texts",
    "notification_channel_records"
];
const STATE_RANK: Record<NotificationState, number> = { pending: 0, seen: 1, read: 2 };

let instances: SyncInstances;

beforeEach(() => {
    instances = new SyncInstances(START);
});

afterEach(() => instances.dispose());

describe("notifications that sync", () => {
    it.each([ "the dismissing device", "the device that was away" ])(
        "keep a dismissal against a later write of a device that was away, when %s syncs first",
        (first) => {
            const a = instances.create("a");
            const b = instances.create("b");
            const id = "spec:returned";
            const notificationId = raise(a, id, START);
            instances.run(a, () => {
                store.writeMark(notificationId, "read");
                store.writePrivateText(notificationId, SEALED);
            });
            instances.settle([ a, b ]);
            expect(viewOf(b)).toEqual([ `${id}@${formatUtcDateTime(START)}:read` ]);

            instances.advance(MINUTE);
            dismiss(a, notificationId);
            instances.advance(MINUTE);
            update(b, notificationId, "Changed while away");
            const order = first === "the dismissing device" ? [ a, b ] : [ b, a ];
            for (const client of order) {
                instances.sync(client);
            }
            instances.settle([ a, b ]);

            expectConverged([ a, b ]);
            for (const instance of [ instances.server, a, b ]) {
                expect(viewOf(instance), instance.name).toEqual([]);
                expect(instances.run(instance, () => store.isErased(notificationId))).toBe(true);
            }
            expect(rowCounts(b)).toEqual([ 0, 0, 0, 0 ]);
        }
    );

    it.each([ "the dismissing device", "the device that raises it late" ])(
        "keep a generation dismissed while a clock ran behind, raised late, when %s syncs first",
        (first) => {
            const a = instances.create("a");
            const b = instances.create("b");
            const id = "spec:reminder:abcd:1";
            const notificationId = raise(instances.server, id, START);
            instances.settle([ a ]);

            a.clockOffsetMs = -2 * DAY;
            dismiss(a, notificationId);
            a.clockOffsetMs = 0;
            instances.advance(HOUR);
            expect(raise(b, id, START)).toBe(notificationId);
            const order = first === "the dismissing device" ? [ a, b ] : [ b, a ];
            for (const client of order) {
                instances.sync(client);
            }
            instances.settle([ a, b ]);

            expectConverged([ a, b ]);
            for (const instance of [ instances.server, a, b ]) {
                expect(viewOf(instance), instance.name).toEqual([]);
            }
            expect(instances.run(b, () => store.raise(input(id, START)).outcome)).toBe("erased");
        }
    );

    it("never take a state back: read, cleared elsewhere, then seen and edited on a third", () => {
        const a = instances.create("a");
        const b = instances.create("b");
        const c = instances.create("c");
        const notificationId = raise(instances.server, "spec:states", START);
        instances.settle([ a, b, c ]);

        mark(a, notificationId, "read");
        instances.advance(MINUTE);
        dismiss(b, notificationId);
        instances.advance(MINUTE);
        mark(c, notificationId, "seen");
        update(c, notificationId, "Edited while away");
        const highest = new Map<SyncInstance, number>();
        const check = () => {
            for (const instance of [ instances.server, a, b, c ]) {
                const entry = instances.run(instance, () => store.getView())
                    .find(({ row }) => row.notificationId === notificationId);
                const rank = entry ? STATE_RANK[entry.state] : null;
                if (rank !== null) {
                    expect(rank, instance.name).toBeGreaterThanOrEqual(highest.get(instance) ?? 0);
                    highest.set(instance, rank);
                }
            }
        };
        for (const client of [ a, b, c ]) {
            instances.sync(client);
            check();
        }
        instances.settle([ a, b, c ]);
        check();

        expectConverged([ a, b, c ]);
        expect(viewOf(c)).toEqual([]);
        expect(rowCounts(c)).toEqual([ 0, 0, 0, 0 ]);
    });

    it("hide and erase an older generation that arrives after a newer one was dismissed", () => {
        const a = instances.create("a");
        const b = instances.create("b");
        const id = "spec:refreshed";
        const older = raise(b, id, START - HOUR);
        const newer = raise(a, id, START);
        dismiss(a, newer);
        instances.sync(a);

        instances.sync(b);
        expect(viewOf(instances.server)).toEqual([]);
        expect(viewOf(b)).toEqual([]);
        instances.sync(a);
        expect(viewOf(a)).toEqual([]);

        for (const instance of [ instances.server, a, b ]) {
            instances.run(instance, () => store.runHousekeeping());
        }
        instances.settle([ a, b ]);

        expectConverged([ a, b ]);
        for (const instance of [ instances.server, a, b ]) {
            const erased = instances.run(instance, () => [ older, newer ].map(store.isErased));
            expect(erased, instance.name).toEqual([ true, true ]);
        }
    });

    it("keep a mark that arrives before its notification until the notification comes", () => {
        const a = instances.create("a");
        const notificationId = raise(a, "spec:split", START);
        mark(a, notificationId, "read");
        update(a, notificationId, "Rewritten after the mark");

        instances.push(a, { batchSize: 1, maxBatches: 1 });
        expect(rowCounts(instances.server)).toEqual([ 0, 1, 0, 0 ]);
        expect(viewOf(instances.server)).toEqual([]);

        instances.push(a);
        expect(viewOf(instances.server))
            .toEqual([ `spec:split@${formatUtcDateTime(START)}:read` ]);
    });

    it("leave out generations dated ahead until their time comes, and then agree", () => {
        const a = instances.create("a");
        const b = instances.create("b");
        a.clockOffsetMs = 2 * DAY;
        const erasedAhead = raise(a, "spec:ahead:x");
        dismiss(a, erasedAhead);
        const storedAhead = raise(a, "spec:ahead:y");
        a.clockOffsetMs = 0;
        instances.settle([ a, b ]);
        for (const instance of [ instances.server, a, b ]) {
            expect(viewOf(instance), instance.name).toEqual([]);
        }

        // With every clock right, a raise of the ID shows at once.
        instances.advance(HOUR);
        const raisedAt = START + HOUR;
        expect(raise(b, "spec:ahead:x")).not.toBeNull();
        instances.settle([ a, b ]);
        for (const instance of [ instances.server, a, b ]) {
            expect(viewOf(instance), instance.name)
                .toEqual([ `spec:ahead:x@${formatUtcDateTime(raisedAt)}:pending` ]);
        }

        // Once its time has come, the erasure covers the raise in between, and `y` shows.
        instances.advance(2 * DAY);
        for (const instance of [ instances.server, a, b ]) {
            instances.run(instance, () => store.runHousekeeping());
        }
        instances.settle([ a, b ]);
        expectConverged([ a, b ]);
        const shownAt = instances.run(a, () => becca.getNotification(storedAhead)?.raisedAt);
        for (const instance of [ instances.server, a, b ]) {
            expect(viewOf(instance), instance.name).toEqual([ `spec:ahead:y@${shownAt}:pending` ]);
        }
    });

    it.each([ 1, 2, 3, 4, 5, 6 ])(
        "agree after a random order of raises, marks and dismissals (seed %i)",
        (seed) => {
            const random = mulberry32(seed);
            const pick = <T>(values: T[]) => values[Math.floor(random() * values.length)];
            const clients = [ instances.create("a"), instances.create("b") ];
            const all = [ instances.server, ...clients ];
            const ids = [ "spec:random:1", "spec:random:2", "spec:random:3" ];
            const held = new Map(all.map((instance) => [ instance, new Set<string>() ]));
            const dismissed = new Set<string>();
            /** Every event raised on any instance, which another instance can raise again late. */
            const events: { id: string; timeMs: number }[] = [];

            /** No instance stores a generation again once it has held its erasure. */
            const checkErasures = (instance: SyncInstance) => instances.run(instance, () => {
                const erased = held.get(instance) ?? new Set<string>();
                for (const notificationId of getSql().getColumn<string>(/*sql*/`SELECT entityId
                    FROM entity_changes WHERE entityName = 'notifications' AND isErased = 1`)) {
                    erased.add(notificationId);
                }
                const stored = [ ...erased ].filter((notificationId) =>
                    becca.getNotification(notificationId));
                expect(stored, instance.name).toEqual([]);
            });

            for (let step = 0; step < 40; step++) {
                const instance = pick(all);
                const shown = instances.run(instance, () => store.getView().map(({ row }) => row));
                const action = random();
                if (action < 0.3) {
                    // A new raise, or the same event raised again, late or on another instance.
                    const event = events.length > 0 && random() < 0.4
                        ? pick(events)
                        : { id: pick(ids), timeMs: undefined };
                    const notificationId = raise(instance, event.id, event.timeMs);
                    if (notificationId) {
                        const timeMs = getTimeOfNotificationId(notificationId);
                        events.push({ id: event.id, timeMs });
                    }
                } else if (action < 0.45 && shown.length > 0) {
                    mark(instance, pick(shown).notificationId, pick([ "seen", "read" ] as const));
                } else if (action < 0.6 && shown.length > 0) {
                    const notificationId = pick(shown).notificationId;
                    dismiss(instance, notificationId);
                    dismissed.add(notificationId);
                } else if (action < 0.7 && shown.length > 0) {
                    update(instance, pick(shown).notificationId, `step ${step}`);
                } else if (action < 0.8) {
                    instances.advance(Math.floor(random() * 10 * MINUTE));
                } else if (instance !== instances.server) {
                    // A sync, sometimes cut off between two requests.
                    const options = random() < 0.5 ? { batchSize: 2, maxBatches: 1 } : {};
                    instances.push(instance, options);
                    instances.pull(instance, options);
                    checkErasures(instances.server);
                }
                checkErasures(instance);
            }

            instances.settle(clients);
            for (const instance of all) {
                instances.run(instance, () => store.runHousekeeping());
            }
            instances.settle(clients);

            expectConverged(clients);
            const view = viewOf(instances.server);
            for (const instance of all) {
                checkErasures(instance);
                expect(viewOf(instance), instance.name).toEqual(view);
                expect(instances.run(instance, () => [ ...dismissed ].filter((notificationId) =>
                    !store.isErased(notificationId))), instance.name).toEqual([]);
            }
        }
    );
});

function input(id: string, timeMs: number) {
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
        content: JSON.stringify({ v: 1, title: id })
    } satisfies store.GenerationInput;
}

/** Raises a generation on the instance, at its clock unless a time is given. Returns its key. */
function raise(instance: SyncInstance, id: string, timeMs?: number) {
    return instances.run(instance, () => {
        const raisedAtMs = timeMs ?? Date.parse(store.getDefaultRaisedAt(id).replace(" ", "T"));
        return store.raise(input(id, raisedAtMs)).notification?.notificationId ?? "";
    });
}

function dismiss(instance: SyncInstance, notificationId: string) {
    instances.run(instance, () => store.eraseNotifications([ notificationId ]));
}

function mark(instance: SyncInstance, notificationId: string, kind: NotificationMarkKind) {
    instances.run(instance, () => store.writeMark(notificationId, kind));
}

/** Rewrites the title of a stored generation, as an update does. */
function update(instance: SyncInstance, notificationId: string, title: string) {
    instances.run(instance, () => {
        const notification = becca.getNotification(notificationId);
        if (notification) {
            store.rewrite(notification, { content: JSON.stringify({ v: 1, title }) });
        }
    });
}

function viewOf(instance: SyncInstance) {
    return instances.run(instance, () => store.getView()
        .map(({ row, state }) => `${row.id}@${row.raisedAt}:${state}`));
}

function rowCounts(instance: SyncInstance) {
    return instances.run(instance, () => TABLES.map((table) =>
        getSql().getValue<number>(`SELECT COUNT(*) FROM ${table}`)));
}

/** The rows of the four tables, and their entity changes, as sync and the hash check see them. */
function tablesOf(instance: SyncInstance) {
    return instances.run(instance, () => ({
        rows: TABLES.map((table) => getSql().getRows(`SELECT * FROM ${table} ORDER BY 1`)
            .map((row) => withoutDates(row as Record<string, unknown>))),
        changes: getSql().getManyRows(/*sql*/`SELECT entityName, entityId, hash, isErased
            FROM entity_changes WHERE entityName IN (???) ORDER BY entityName, entityId`, TABLES)
    }));
}

/** A row without its dates, which can differ between instances whose hashes agree. */
function withoutDates(row: Record<string, unknown>) {
    const { utcDateCreated: _created, utcDateModified: _modified, ...rest } = row;
    return rest;
}

function expectConverged(clients: SyncInstance[]) {
    const server = tablesOf(instances.server);
    for (const client of clients) {
        expect(tablesOf(client), client.name).toEqual(server);
    }
}

/** A small seeded random generator, so that a failing seed can be run again. */
function mulberry32(seed: number) {
    let state = seed;
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}
