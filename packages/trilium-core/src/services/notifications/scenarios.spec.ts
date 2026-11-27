import type { NotificationRow, TriliumNotification } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import BNotification from "../../becca/entities/bnotification.js";
import becca from "../../becca/becca.js";
import SyncInstances, { type SyncInstance } from "../../test/sync_instances.js";
import noteService from "../notes.js";
import protectedSessionService from "../protected_session.js";
import { getSql } from "../sql/index.js";
import { getLastSyncedBatchTime } from "../sync_update.js";
import TaskContext from "../task_context.js";
import { encodeUtf8 } from "../utils/binary.js";
import {
    checkPrivateTextRow,
    formatUtcDateTime,
    getNotificationId,
    NotificationError
} from "./model.js";
import NotificationService, { type NotificationProducer } from "./service.js";
import * as store from "./store.js";

const START = Date.UTC(2026, 10, 27, 12, 0, 0, 0);
const MINUTE = 60 * 1000;
const DATA_KEY = Uint8Array.from({ length: 16 }, (_, index) => 30 + index);
const CLIENT: NotificationProducer = { kind: "client" };
const BUILT_IN: NotificationProducer = { kind: "built-in", name: "trilium:spec" };

let instances: SyncInstances;
let service: NotificationService;

beforeEach(() => {
    instances = new SyncInstances(START,
        [ "Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval" ]);
    service = new NotificationService({
        store,
        transport: { send: () => {} },
        settings: { isCategoryOff: () => false },
        getLastSyncedBatchTime
    });
    instances.run(instances.server, () => service.start());
});

afterEach(() => {
    service.stop();
    protectedSessionService.resetDataKey();
    instances.dispose();
});

/** Runs `fn` on an instance whose protected session is open. */
function inSession<T>(instance: SyncInstance, fn: () => T): T {
    return instances.run(instance, () => {
        protectedSessionService.setDataKey(DATA_KEY);
        try {
            return fn();
        } finally {
            protectedSessionService.resetDataKey();
        }
    });
}

function raise(instance: SyncInstance, input: Record<string, unknown>, producer = CLIENT) {
    return instances.run(instance, () => service.create(input, producer).notification);
}

function listOf(instance: SyncInstance, isSessionOpen = false): TriliumNotification[] {
    const list = () => service.getPage().notifications;
    return isSessionOpen ? inSession(instance, list) : instances.run(instance, list);
}

function privateTextOf(instance: SyncInstance, notificationId: string) {
    return instances.run(instance, () => store.getPrivateText(notificationId)?.content ?? null);
}

function codeOf(run: () => unknown) {
    try {
        run();
        return null;
    } catch (e) {
        return e instanceof NotificationError ? e.code : `thrown: ${e}`;
    }
}

describe("sensitive notifications across instances", () => {
    it.each([ "the server's raise first", "the desktop's raise first" ])(
        "keep the private text of a reminder raised with and without a session, %s",
        (order) => {
            const desktop = instances.create("desktop");
            const third = instances.create("third");
            const noteId = inSession(instances.server, () => noteService.createNewNote({
                parentNoteId: "root", title: "Bank", content: "<p>Body</p>", type: "text",
                isProtected: true
            }).note.noteId);
            instances.settle([ desktop, third ]);

            const reminder = {
                id: `spec:reminder:${noteId}:1`, raisedAt: formatUtcDateTime(START), noteId,
                category: "reminder", title: "Call the bank", description: "At noon"
            };
            const notificationId = getNotificationId(reminder.id, START);
            raise(instances.server, reminder);
            inSession(desktop, () => service.create(reminder, CLIENT));
            expect(privateTextOf(instances.server, notificationId)).toBeNull();
            const sealed = privateTextOf(desktop, notificationId);
            expect(sealed).not.toBeNull();

            // A clock behind the time of the event still counts the generation.
            third.clockOffsetMs = -30 * MINUTE;
            if (order === "the server's raise first") {
                instances.sync(third);
                // An instance without the private text changes the public content.
                instances.run(third,
                    () => service.update(reminder.id, { icon: "bx bx-bell" }, CLIENT));
                instances.sync(desktop);
            } else {
                instances.sync(desktop);
                instances.sync(third);
            }
            expect(privateTextOf(desktop, notificationId)).toBe(sealed);
            instances.settle([ desktop, third ]);

            for (const instance of [ instances.server, desktop, third ]) {
                expect(privateTextOf(instance, notificationId), instance.name).toBe(sealed);
            }
            const [ onServer ] = listOf(instances.server);
            expect(onServer).toMatchObject({ sensitive: true });
            expect(JSON.stringify(onServer)).not.toContain("bank");
            expect(listOf(desktop, true)[0]).toMatchObject({
                protectedTitle: "Call the bank", protectedDescription: "At noon"
            });
            expect(listOf(third, true)[0].protectedTitle).toBe("Call the bank");
            expect(listOf(desktop)[0].protectedTitle).toBeUndefined();
        }
    );

    it.each([ "the marking device", "the device that was away" ])(
        "keep the text of a plain version out once the mark arrives, when %s syncs first",
        (first) => {
            const a = instances.create("a");
            const b = instances.create("b");
            const id = "spec:plain";
            raise(instances.server, { id, title: "Plain title", description: "Old plan" });
            instances.settle([ a, b ]);

            instances.advance(MINUTE);
            instances.run(a, () => service.update(id, { sensitive: true }, CLIENT));
            instances.advance(MINUTE);
            instances.run(b, () => service.update(id, { description: "Secret plan v2" }, CLIENT));

            const [ firstClient, secondClient ] =
                first === "the marking device" ? [ a, b ] : [ b, a ];
            instances.sync(firstClient);
            // The forwarding instance restarts in between.
            instances.run(instances.server, () => {
                service.stop();
                service.start();
            });
            instances.sync(secondClient);
            expect(JSON.stringify(listOf(instances.server))).not.toContain("plan");
            instances.settle([ a, b ]);

            for (const instance of [ instances.server, a, b ]) {
                const [ shown ] = listOf(instance);
                expect(shown, instance.name).toMatchObject({ id, sensitive: true });
                expect(JSON.stringify(shown), instance.name).not.toMatch(/plan|Plain title/);
                const notificationId = shown.notificationId;
                instances.run(instance, () => {
                    expect(store.getNotification(notificationId)?.isSensitive).toBe(true);
                    expect(store.hasMark(notificationId, "sensitive")).toBe(true);
                    expect(JSON.stringify(service.getClientEntity("notifications", notificationId)))
                        .not.toContain("plan");
                });
            }
        }
    );

    it("move a notification at the size limit into a private text another instance opens", () => {
        const a = instances.create("a");
        const b = instances.create("b");
        const overhead = JSON.stringify({ v: 1, title: "T", description: "" }).length;
        const description = "d".repeat(8192 - overhead);
        const note = inSession(a, () => {
            const created = noteService.createNewNote({
                parentNoteId: "root", title: "Plain note", content: "<p>Body</p>", type: "text"
            }).note;
            const notification = service.create({ id: "spec:large", noteId: created.noteId,
                title: "T", description }, CLIENT).notification;
            expect(notification?.description).toBe(description);
            return created;
        });

        inSession(a, () => noteService.protectNoteRecursively(note, true, false,
            new TaskContext("spec-protect", "protectNotes", { protect: true })));
        instances.settle([ a, b ]);

        const notificationId = getNotificationId("spec:large", START);
        const row = instances.run(b, () => getSql().getRow<Record<string, unknown>>(
            "SELECT * FROM notification_private_texts WHERE notificationId = ?",
            [ notificationId ]));
        expect(checkPrivateTextRow(row)).toBeNull();
        expect(encodeUtf8(String(row.content)).byteLength).toBeLessThanOrEqual(11 * 1024);
        expect(listOf(b, true)[0]).toMatchObject({ protectedTitle: "T",
            protectedDescription: description });
        expect(listOf(b)[0].description).toBeUndefined();
    });
});

describe("the limit on what an instance admits, across instances", () => {
    function raisePersistent(instance: SyncInstance, prefix: string, count: number) {
        instances.run(instance, () => getSql().transactional(() => {
            for (let index = 0; index < count; index++) {
                const id = `${prefix}:${index}`;
                const timeMs = START - index;
                const at = formatUtcDateTime(timeMs);
                new BNotification({
                    notificationId: getNotificationId(id, timeMs), id, raisedAt: at, tag: null,
                    noteId: null, category: "general", type: "persistent", attentionLevel: "low",
                    isSensitive: false, producer: "client",
                    content: JSON.stringify({ v: 1, title: id }),
                    utcDateCreated: at, utcDateModified: at
                } satisfies NotificationRow).save();
            }
        }));
    }

    function dismissSome(instance: SyncInstance, count: number) {
        instances.run(instance, () => {
            const refs = Object.values(becca.notifications).slice(0, count);
            service.dismiss(refs, "force");
        });
    }

    it("keeps whatever sync brings, and admits again only under the limit", () => {
        const a = instances.create("a");
        const b = instances.create("b");
        raisePersistent(a, "spec:a", 600);
        raisePersistent(b, "spec:b", 600);
        instances.settle([ a, b ]);

        for (const instance of [ a, b ]) {
            instances.run(instance, () => {
                expect(store.getStoredNotifications(), instance.name).toHaveLength(1200);
                expect(codeOf(() => service.create({ title: "New" }, CLIENT))).toBe("full");
                expect(codeOf(() => service.create({ id: "trilium:spec:new", title: "New" },
                    BUILT_IN))).toBe("full");
            });
        }

        dismissSome(a, 1);
        instances.settle([ a, b ]);
        instances.run(b, () => {
            expect(store.getStoredNotifications()).toHaveLength(1199);
            expect(codeOf(() => service.create({ id: "trilium:spec:new", title: "New" },
                BUILT_IN))).toBe("full");
        });

        dismissSome(b, 200);
        instances.run(b, () => {
            expect(service.create({ id: "trilium:spec:new", title: "New" }, BUILT_IN).outcome)
                .toBe("new");
            expect(codeOf(() => service.create({ title: "New" }, CLIENT))).toBe("full");
        });
        dismissSome(b, 201);
        instances.run(b, () => {
            expect(service.create({ title: "New" }, CLIENT).outcome).toBe("new");
        });
    });
});
