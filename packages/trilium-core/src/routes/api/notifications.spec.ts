import type {
    NotificationCreateResponse,
    NotificationErrorBody,
    NotificationListResponse,
    TriliumNotification
} from "@triliumnext/commons";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca";
import { getContext } from "../../services/context";
import { getLog } from "../../services/log";
import { getNotificationService } from "../../services/notifications/index";
import {
    deriveKey,
    NOTIFICATION_KEY_LABEL,
    NOTIFICATION_MAC_LABEL
} from "../../services/notifications/protected_text";
import optionService from "../../services/options";
import protectedSessionService from "../../services/protected_session";
import { getSql } from "../../services/sql/index";
import sqlInit from "../../services/sql_init";
import { encodeBase64 } from "../../services/utils/binary";
import { CoreApiTester } from "../../test/api_tester";

const DATA_KEY = Uint8Array.from({ length: 16 }, (_, index) => 50 + index);
const MARKER = "Recognizable-7f3a";
const TABLES = [
    "notifications", "notification_marks", "notification_private_texts",
    "notification_channel_records"
];

let api: CoreApiTester;

beforeAll(() => {
    api = CoreApiTester.build();
});

beforeEach(() => {
    getContext().init(() => getSql().transactional(() => {
        for (const table of TABLES) {
            getSql().execute(`DELETE FROM ${table}`);
            getSql().execute("DELETE FROM entity_changes WHERE entityName = ?", [ table ]);
        }
    }));
    becca.notifications = {};
    becca.notificationMarks = {};
    becca.notificationPrivateTexts = {};
});

afterEach(() => {
    getNotificationService().stop();
    protectedSessionService.resetDataKey();
    getContext().init(() => optionService.setOption("notificationDisabledCategories", "[]"));
    vi.restoreAllMocks();
});

async function create(body: Record<string, unknown>) {
    const response = await api.post<NotificationCreateResponse>("/api/notifications", { body });
    const notification = response.body.notification;
    if (response.status !== 200 || !notification) {
        throw new Error(`Not created: ${response.status}`);
    }
    return notification;
}

function list(after?: string) {
    return api.get<NotificationListResponse>("/api/notifications", { query: { after } });
}

describe("notification routes", () => {
    it("create a notification and list it on the first page, with the counts", async () => {
        const notification = await create({ id: "spec:route", title: "Title", tag: "spec:tag" });
        expect(notification).toMatchObject({
            id: "spec:route", title: "Title", producer: "client", state: "pending"
        });

        const { status, body } = await list();
        expect(status).toBe(200);
        expect(body.notifications).toEqual([ notification ]);
        expect(body.counts).toMatchObject({ total: 1, pending: 1, unread: 1, live: 1 });
        expect(body.changeId).toBeGreaterThan(0);
        expect(body.next).toBeUndefined();
        expect((await list(notification.notificationId)).body.notifications).toEqual([]);
    });

    it("answer a refusal with its code alone", async () => {
        const consoleCalls = [ "log", "warn", "error", "debug" ].map((method) =>
            vi.spyOn(console, method as "log").mockImplementation(() => {}));
        const logCalls = [ vi.spyOn(getLog(), "info"), vi.spyOn(getLog(), "error") ];
        const refusals: [ string, Promise<{ status: number; body: unknown }>, number, string ][] = [
            [ "a control character", api.post("/api/notifications",
                { body: { title: `${MARKER}\u0007` } }), 400, "invalid-input" ],
            [ "a built-in ID", api.post("/api/notifications",
                { body: { id: "trilium:x", title: MARKER } }), 400, "reserved-name" ],
            [ "a cursor that is no key", list("x"), 400, "invalid-input" ],
            [ "an unknown ID", api.patch("/api/notifications/spec:missing",
                { body: { patch: { title: MARKER } } }), 404, "not-found" ],
            [ "a patch of a built-in ID", api.patch("/api/notifications/trilium:x",
                { body: { patch: { title: MARKER } } }), 400, "reserved-name" ],
            [ "501 refs", api.post("/api/notifications/state", {
                body: { refs: Array(501).fill({ id: "a", raisedAt: MARKER }), state: "seen" }
            }), 400, "invalid-input" ]
        ];
        for (const [ label, request, status, code ] of refusals) {
            const response = await request;
            expect(response.status, label).toBe(status);
            expect(response.body, label).toEqual({ code });
        }

        await create({ id: "spec:stale", title: "Title" });
        const stale = await api.patch<NotificationErrorBody>("/api/notifications/spec:stale",
            { body: { patch: { title: MARKER }, expected: "another revision" } });
        expect(stale).toMatchObject({ status: 409, body: { code: "stale-revision" } });

        getContext().init(() => optionService.setOption("notificationDisabledCategories",
            JSON.stringify([ "general" ])));
        const off = await api.post("/api/notifications", { body: { title: "Off" } });
        expect(off).toMatchObject({ status: 409, body: { code: "category-off" } });
        const printed = JSON.stringify([ ...consoleCalls, ...logCalls ]
            .map((spy) => spy.mock.calls));
        expect(printed).not.toContain(MARKER);
    });

    it("update, mark and dismiss through their routes", async () => {
        const notification = await create({ id: "spec:flow", title: "Title" });
        const updated = await api.patch<NotificationCreateResponse>(
            "/api/notifications/spec:flow",
            { body: { patch: { title: "Changed" }, expected: notification.revision } });
        expect(updated.status).toBe(200);
        expect(updated.body.notification?.title).toBe("Changed");

        const ref = { id: notification.id, raisedAt: notification.raisedAt };
        expect((await api.post("/api/notifications/state",
            { body: { refs: [ ref ], state: "read" } })).status).toBe(204);
        expect((await list()).body.notifications[0].state).toBe("read");

        const persistent = await create(
            { id: "spec:persistent", title: "Kept", type: "persistent" });
        const dismissed = await api.post("/api/notifications/dismiss", { body: {
            refs: [ ref, { id: persistent.id, raisedAt: persistent.raisedAt } ], reason: "user"
        } });
        expect(dismissed).toMatchObject({ status: 200, body: { refused: 1 } });
        expect((await list()).body.notifications.map(({ id }) => id))
            .toEqual([ "spec:persistent" ]);
    });

    it("give the private text only in a protected session, and never a key", async () => {
        protectedSessionService.setDataKey(DATA_KEY);
        const notification = await create({
            id: "spec:private", title: "A reminder is due", protectedTitle: MARKER
        });
        expect(notification.protectedTitle).toBe(MARKER);
        expect((await list()).body.notifications[0].protectedTitle).toBe(MARKER);

        protectedSessionService.resetDataKey();
        const responses = [
            await list(),
            await api.patch("/api/notifications/spec:private", { body: { patch: { icon: "bx" } } })
        ];
        const keys = [ NOTIFICATION_KEY_LABEL, NOTIFICATION_MAC_LABEL ]
            .map((label) => encodeBase64(deriveKey(DATA_KEY, label)));
        for (const response of responses) {
            const text = JSON.stringify(response.body);
            expect(text).not.toContain(MARKER);
            expect(text).not.toContain("protectedTitle");
            for (const key of keys) {
                expect(text).not.toContain(key);
            }
        }
        const { notifications } = (await list()).body;
        expect(notifications[0] satisfies TriliumNotification).toMatchObject({
            title: "A reminder is due", sensitive: true
        });
    });

    it("refuse every route on a database that has not opened", async () => {
        vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
        for (const response of [
            await list(),
            await api.post("/api/notifications", { body: { title: "Title" } }),
            await api.patch("/api/notifications/spec:x", { body: { patch: {} } }),
            await api.post("/api/notifications/state", { body: { refs: [], state: "seen" } }),
            await api.post("/api/notifications/dismiss", { body: { refs: [], reason: "user" } })
        ]) {
            expect(response).toMatchObject({ status: 409, body: { code: "not-initialized" } });
        }
    });

    it("answer an error that is no refusal without its message, also in the log", async () => {
        const logError = vi.spyOn(getLog(), "error");
        vi.spyOn(getNotificationService(), "getPage").mockImplementation(() => {
            throw new TypeError(`Unexpected ${MARKER}`);
        });

        const response = await list();
        expect(response.status).toBe(500);
        expect(JSON.stringify(response.body)).not.toContain(MARKER);
        expect(logError).toHaveBeenCalledWith(expect.stringContaining("failed: internal."));
        expect(JSON.stringify(logError.mock.calls)).not.toContain(MARKER);
    });
});
