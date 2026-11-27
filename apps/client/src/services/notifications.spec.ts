import type {
    NotificationCounts, NotificationListResponse, TriliumNotification, WebSocketMessage
} from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EntityChange } from "../server_types.js";

const ws = vi.hoisted(() => ({
    messageHandlers: [] as ((message: WebSocketMessage) => void)[],
    reconnectListeners: [] as (() => void)[],
    waitForMaxKnownEntityChangeId: vi.fn(async () => {}),
    logError: vi.fn()
}));
const alerts = vi.hoisted(() => ({ showAlert: vi.fn(async (_notificationId: string) => {}) }));

vi.mock("./ws.js", () => {
    const subscribeToMessages = (handler: (message: WebSocketMessage) => void) => {
        ws.messageHandlers.push(handler);
    };
    return {
        default: {
            subscribeToMessages,
            waitForMaxKnownEntityChangeId: ws.waitForMaxKnownEntityChangeId
        },
        subscribeToMessages,
        subscribeToReconnect: (listener: () => void) => ws.reconnectListeners.push(listener),
        logError: ws.logError
    };
});
vi.mock("./notification_alerts.js", () => alerts);

import {
    NotificationRequestError, NotificationStore, NotificationView
} from "./notifications.js";
import options from "./options.js";
import server from "./server.js";

const BASE_MS = Date.UTC(2026, 10, 27, 10, 0, 0);

/** A notification as the backend's view gives it, raised `minutes` after a fixed time. */
function makeNotification(
    id: string,
    minutes: number,
    overrides: Partial<TriliumNotification> = {}
): TriliumNotification {
    const timeMs = BASE_MS + minutes * 60_000;
    const raisedAt = new Date(timeMs).toISOString().replace("T", " ");
    return {
        notificationId: id.replace(/[^A-Za-z0-9]/g, "").padEnd(12, "x").slice(0, 12)
            + timeMs.toString(36).padStart(9, "0"),
        id,
        raisedAt,
        updatedAt: raisedAt,
        revision: "r1",
        category: "general",
        type: "standard",
        attentionLevel: "medium",
        state: "pending",
        producer: "trilium:test",
        title: `Title of ${id}`,
        ...overrides
    };
}

function rowChange(notification: TriliumNotification, id: number): EntityChange {
    return {
        id, entityName: "notifications", entityId: notification.notificationId, hash: "h",
        isSynced: true, isErased: false, entity: notification as never
    };
}

function erasure(notification: TriliumNotification, id: number): EntityChange {
    return {
        id, entityName: "notifications", entityId: notification.notificationId, hash: "h",
        isSynced: true, isErased: true
    };
}

function markChange(
    notification: TriliumNotification,
    kind: "seen" | "read" | "sensitive",
    id: number
): EntityChange {
    const { notificationId } = notification;
    return {
        id, entityName: "notification_marks", entityId: `${notificationId}${kind[0]}`, hash: "h",
        isSynced: true, isErased: false,
        entity: { markId: `${notificationId}x`, notificationId, kind, utcDateCreated: "" } as never
    };
}

function countsOf(view: TriliumNotification[]): NotificationCounts {
    return {
        total: view.length,
        pending: view.filter(({ state }) => state === "pending").length,
        unread: view.filter(({ state }) => state !== "read").length,
        live: view.length,
        dailyBudgetReached: []
    };
}

/**
 * Returns the pages of a view, newest first, as the route does. A page waits for `release()` when
 * `isHeld` is set, so a spec can deliver changes between two pages.
 */
function servePages(view: TriliumNotification[], changeId: number, isHeld = false) {
    const held: (() => void)[] = [];
    const get = vi.fn(async (url: string) => {
        const after = new URLSearchParams(url.split("?")[1] ?? "").get("after");
        const index = view.findIndex(({ notificationId }) => notificationId === after);
        const start = after ? index + 1 : 0;
        const notifications = view.slice(start, start + 200);
        const page: NotificationListResponse = { notifications, changeId };
        if (start + notifications.length < view.length) {
            page.next = notifications.at(-1)?.notificationId;
        }
        if (!after) {
            page.counts = countsOf(view);
        }
        if (isHeld) {
            await new Promise<void>((resolve) => held.push(resolve));
        }
        return page;
    });
    server.getWithSilentErrors = get as typeof server.getWithSilentErrors;
    return {
        get,
        /** Lets the oldest page that waits go. */
        release: () => held.shift()?.(),
        get waiting() {
            return held.length;
        }
    };
}

/** Lets the promises that the store awaits settle. */
async function settle() {
    for (let round = 0; round < 5; round++) {
        await Promise.resolve();
    }
}

function newestFirst(view: TriliumNotification[]) {
    return [ ...view ].sort((a, b) => (a.raisedAt < b.raisedAt ? 1 : -1));
}

beforeEach(() => {
    ws.messageHandlers.length = 0;
    ws.reconnectListeners.length = 0;
    ws.logError.mockClear();
    alerts.showAlert.mockClear();
    server.postWithSilentErrors = vi.fn(async () => ({})) as typeof server.postWithSilentErrors;
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("NotificationView", () => {
    it("shows the newest generation of each ID, newest first", () => {
        const view = new NotificationView();
        const older = makeNotification("reminder", 1);
        const newer = makeNotification("reminder", 2, { title: "Again" });
        const other = makeNotification("other", 3);

        view.put(older);
        view.put(other);
        view.put(newer);
        // A late replay of the older generation changes nothing.
        view.put(older);

        expect(view.toArray()).toEqual([ other, newer ]);
        expect(view.getCurrent("reminder")).toBe(newer);
        expect(view.get(older.notificationId)).toBeUndefined();

        view.delete(newer.notificationId);
        expect(view.getCurrent("reminder")).toBeUndefined();
        expect(view.toArray()).toEqual([ other ]);
    });

    it("raises states, takes private texts, and hides public text with a sensitive mark", () => {
        const view = new NotificationView();
        const notification = makeNotification("about-note", 1, {
            description: "Plain", progressLabel: "Half", link: "#root/abc?block=xyz",
            actions: [
                { id: "open", caption: "Open", icon: "bx bx-link" }, { id: "go", caption: "Go" }
            ]
        });
        view.put(notification);

        view.applyMark(notification.notificationId, "read");
        view.applyMark(notification.notificationId, "seen");
        expect(view.get(notification.notificationId)?.state).toBe("read");

        view.applyPrivateText({
            notificationId: notification.notificationId, revision: "r2", protectedTitle: "Secret"
        });
        expect(view.get(notification.notificationId)).toMatchObject({
            revision: "r2", protectedTitle: "Secret"
        });
        view.applyPrivateText({ notificationId: notification.notificationId, revision: "r3" });
        expect(view.get(notification.notificationId)?.protectedTitle).toBeUndefined();

        view.applyMark(notification.notificationId, "sensitive");
        const hidden = view.get(notification.notificationId);
        expect(hidden).toMatchObject({ sensitive: true, link: "#root/abc", state: "read" });
        expect(hidden?.title).toBeUndefined();
        expect(hidden?.description).toBeUndefined();
        expect(hidden?.progressLabel).toBeUndefined();
        expect(hidden?.actions).toEqual([
            { id: "open", caption: "", icon: "bx bx-link" }, { id: "go", caption: "" }
        ]);
        // Each change makes a new object, which a component compares by reference.
        expect(hidden).not.toBe(notification);

        // Changes for a notification that the view does not hold change nothing.
        view.applyMark("missing", "read");
        view.applyPrivateText({ notificationId: "missing", revision: "r" });
        expect(view.toArray()).toHaveLength(1);
    });

    it("applies the changes of the four tables", () => {
        const view = new NotificationView();
        const notification = makeNotification("change", 1);
        view.applyChange(rowChange(notification, 1));
        view.applyChange(markChange(notification, "seen", 2));
        view.applyChange({
            id: 3, entityName: "notification_private_texts", entityId: notification.notificationId,
            hash: "h", isSynced: true, isErased: false,
            entity: { notificationId: notification.notificationId, revision: "r9" } as never
        });
        view.applyChange({
            id: 4, entityName: "notification_channel_records", entityId: "record", hash: "h",
            isSynced: true, isErased: false
        });
        expect(view.toArray()).toEqual([ { ...notification, state: "seen", revision: "r9" } ]);

        // A row that the backend's view does not show arrives without it.
        view.applyChange({ ...rowChange(notification, 5), entity: undefined });
        expect(view.toArray()).toEqual([]);
        view.applyChange(rowChange(notification, 6));
        view.applyChange(erasure(notification, 7));
        expect(view.toArray()).toEqual([]);
    });
});

describe("NotificationStore", () => {
    it("pages down to the oldest of 1,200, with the badge right after the first page", async () => {
        const view = newestFirst(Array.from({ length: 1200 }, (_, index) =>
            makeNotification(`n${index}`, index, { state: index % 3 === 0 ? "read" : "pending" })));
        const pages = servePages(view, 50, true);
        const store = new NotificationStore();

        const loading = store.reload();
        await vi.waitFor(() => expect(pages.waiting).toBe(1));
        pages.release();
        await vi.waitFor(() => expect(store.notifications.value).toHaveLength(200));
        expect(store.isLoaded.value).toBe(false);
        expect(store.pendingCount.value).toBe(800);
        expect(store.unreadCount.value).toBe(800);

        const oldest = store.getById("n0");
        for (let page = 2; page <= 6; page++) {
            await vi.waitFor(() => expect(pages.waiting).toBe(1));
            pages.release();
        }
        await loading;

        expect(await oldest).toMatchObject({ id: "n0", state: "read" });
        expect(store.notifications.value).toHaveLength(1200);
        expect(store.notifications.value[0].id).toBe("n1199");
        expect(store.isLoaded.value).toBe(true);
        expect(store.pendingCount.value).toBe(800);
        expect(pages.get).toHaveBeenCalledTimes(6);
        expect(pages.get).toHaveBeenLastCalledWith(
            `notifications?after=${encodeURIComponent(view[999].notificationId)}`);
    });

    it("keeps what a change told it over a page that was made before the change", async () => {
        const erased = makeNotification("erased", 1);
        const marked = makeNotification("marked", 2);
        const updated = makeNotification("updated", 3);
        const fresh = makeNotification("fresh", 4);
        const first = Array.from({ length: 200 },
            (_, index) => makeNotification(`f${index}`, 100 + index));
        const view = newestFirst([ ...first, erased, marked, updated ]);
        const pages = servePages(view, 20, true);
        const store = new NotificationStore();
        store.start();

        const loading = store.whenLoaded();
        await vi.waitFor(() => expect(pages.waiting).toBe(1));
        pages.release();
        await vi.waitFor(() => expect(pages.waiting).toBe(1));
        // The second page reflects the changes up to 20; these come after it.
        store.applyEntityChanges([
            erasure(erased, 21),
            markChange(marked, "seen", 22),
            rowChange({ ...updated, title: "Newer", revision: "r2" }, 23),
            rowChange(fresh, 24),
            // Older than the page, which already includes it.
            markChange(updated, "read", 19)
        ]);
        pages.release();
        await loading;

        const shown = store.notifications.value;
        expect(shown.find(({ id }) => id === "erased")).toBeUndefined();
        expect(shown.find(({ id }) => id === "marked")?.state).toBe("seen");
        expect(shown.find(({ id }) => id === "updated")).toMatchObject({
            title: "Newer", revision: "r2", state: "pending"
        });
        expect(shown.find(({ id }) => id === "fresh")).toBe(fresh);
        expect(shown).toHaveLength(203);
    });

    it("shows the newest of two generations of one ID, whichever comes first", async () => {
        const older = makeNotification("update-available", 1);
        const newer = makeNotification("update-available", 2, { title: "Version 2" });
        servePages([ older ], 5);
        const store = new NotificationStore();
        store.start();
        await store.whenLoaded();

        store.applyEntityChanges([ rowChange(newer, 6), erasure(older, 7) ]);
        expect(store.notifications.value).toEqual([ newer ]);
        // A replay of the older one arrives late from another device.
        store.applyEntityChanges([ rowChange(older, 8) ]);
        expect(store.notifications.value).toEqual([ newer ]);
        expect(await store.getById("update-available")).toBe(newer);
    });

    it("loads again at notifications-due, a reconnect and a protected session", async () => {
        // Scenario 29: the clock crosses the hour before a generation dated ahead and an erasure
        // dated ahead that covers a shown one, with the panel open.
        const covered = makeNotification("covered", 1);
        const kept = makeNotification("kept", 2, { state: "seen" });
        const due = makeNotification("due", 90, { attentionLevel: "high" });
        servePages([ kept, covered ], 5);
        const store = new NotificationStore();
        store.start();
        await store.whenLoaded();
        expect(store.pendingCount.value).toBe(1);

        const older = Array.from({ length: 200 },
            (_, index) => makeNotification(`older${index}`, -index, { state: "read" }));
        const reloaded = servePages([ due, kept, ...older ], 9, true);
        for (const handler of ws.messageHandlers) {
            handler({ type: "notifications-due" });
        }
        await vi.waitFor(() => expect(reloaded.waiting).toBe(1));
        reloaded.release();
        await vi.waitFor(() => expect(reloaded.waiting).toBe(1));
        // The view shown so far stays until the last page is in.
        expect(store.notifications.value).toEqual([ kept, covered ]);
        reloaded.release();
        await store.whenLoaded();
        expect(store.notifications.value.slice(0, 2)).toEqual([ due, kept ]);
        expect(store.notifications.value).toHaveLength(202);
        expect(store.pendingCount.value).toBe(1);
        expect(store.unreadCount.value).toBe(2);

        servePages([ due ], 10);
        for (const listener of ws.reconnectListeners) {
            listener();
        }
        await store.whenLoaded();
        expect(store.notifications.value).toEqual([ due ]);
        const afterLogin = servePages([ due, kept ], 11);
        for (const handler of ws.messageHandlers) {
            handler({ type: "protectedSessionLogin" });
        }
        await store.whenLoaded();
        expect(afterLogin.get).toHaveBeenCalledOnce();
        expect(store.notifications.value).toEqual([ due, kept ]);
    });

    it("sends seen and read marks in batches of the generations that were shown", async () => {
        vi.useFakeTimers();
        const view = Array.from({ length: 250 },
            (_, index) => makeNotification(`s${index}`, index));
        servePages(newestFirst(view), 1);
        const store = new NotificationStore();
        const loading = store.reload();
        await vi.runAllTimersAsync();
        await loading;
        const post = vi.fn(async (_url: string, _body: { refs: unknown[] }) => ({}));
        server.postWithSilentErrors = post as typeof server.postWithSilentErrors;

        const [ first, second, third ] = store.notifications.value;
        store.markSeen([ first, second ]);
        store.markRead([ second ]);
        store.markSeen([ third ]);
        // The view shows them before the request ends.
        expect(store.notifications.value.slice(0, 3).map(({ state }) => state))
            .toEqual([ "seen", "read", "seen" ]);
        expect(post).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(500);
        expect(post).toHaveBeenCalledTimes(2);
        expect(post).toHaveBeenCalledWith("notifications/state", {
            refs: [ first, third ].map(({ id, raisedAt }) => ({ id, raisedAt })), state: "seen"
        });
        expect(post).toHaveBeenCalledWith("notifications/state", {
            refs: [ { id: second.id, raisedAt: second.raisedAt } ], state: "read"
        });

        // Marking all as read sends pages of 200, without the one already read.
        post.mockClear();
        await store.markAllAsRead();
        expect(post.mock.calls.map(([ , body ]) => body.refs.length)).toEqual([ 200, 49 ]);
        expect(store.unreadCount.value).toBe(0);
    });

    it("takes back the marks it showed when the backend refuses them", async () => {
        servePages([ makeNotification("refused", 1) ], 1);
        const store = new NotificationStore();
        await store.whenLoaded();
        server.postWithSilentErrors = vi.fn(async () => {
            throw JSON.stringify({ code: "invalid-input" });
        }) as typeof server.postWithSilentErrors;

        store.markRead(store.notifications.value);
        expect(store.notifications.value[0].state).toBe("read");
        await store.flushStates();

        expect(store.notifications.value[0].state).toBe("pending");
        expect(ws.logError).toHaveBeenCalledWith(
            "A notification request failed: state, invalid-input.");
    });

    it("clears every standard notification and loads the view again", async () => {
        const standard = makeNotification("standard", 2);
        const persistent = makeNotification("persistent", 1, { type: "persistent" });
        const pages = servePages([ standard, persistent ], 1);
        const store = new NotificationStore();
        await store.whenLoaded();
        const post = vi.fn(async () => ({ refused: 0 }));
        server.postWithSilentErrors = post as typeof server.postWithSilentErrors;

        const clearing = store.clearAll();
        servePages([ persistent ], 3);
        await clearing;

        expect(post).toHaveBeenCalledWith("notifications/dismiss", {
            refs: [ { id: standard.id, raisedAt: standard.raisedAt } ], reason: "user"
        });
        expect(store.notifications.value).toEqual([ persistent ]);
        expect(pages.get).toHaveBeenCalledTimes(1);

        post.mockClear();
        await store.clearAll();
        expect(post).not.toHaveBeenCalled();
    });

    it("implements the notification API over the routes, by their codes", async () => {
        const tagged = makeNotification("tagged", 2, { tag: "trilium:reminder:abc" });
        const other = makeNotification("other", 1, { tag: "other" });
        servePages([ tagged, other ], 1);
        const store = new NotificationStore();
        await store.whenLoaded();
        expect(await store.getByTag("trilium:reminder:abc")).toEqual([ tagged ]);
        expect(await store.getById("missing")).toBeNull();

        const refusals: Record<string, string> = {};
        const answer = (key: string, body: object) => {
            if (refusals[key]) {
                throw JSON.stringify({ code: refusals[key] });
            }
            return body;
        };
        server.postWithSilentErrors = vi.fn(async (url: string) =>
            answer(url, { notification: tagged })) as typeof server.postWithSilentErrors;
        server.patch = vi.fn(async () =>
            answer("patch", { notification: tagged })) as typeof server.patch;

        expect(await store.create({ title: "New" })).toBe(tagged);
        expect(ws.waitForMaxKnownEntityChangeId).toHaveBeenCalled();
        refusals.notifications = "category-off";
        expect(await store.create({ title: "Off" })).toBeNull();
        refusals.notifications = "budget";
        const refused = store.create({ title: "Many" });
        await expect(refused).rejects.toBeInstanceOf(NotificationRequestError);
        await expect(refused).rejects.toMatchObject({ code: "budget", message: "budget" });

        expect(await store.update("tagged", { title: "Patched" })).toBe(tagged);
        expect(server.patch).toHaveBeenLastCalledWith("notifications/tagged",
            { patch: { title: "Patched" }, expected: undefined }, undefined,
            { silentBadRequest: true, silentNotFound: true, silentConflict: true });
        refusals.patch = "stale-revision";
        expect(await store.update(tagged, { title: "Stale" })).toBeNull();
        expect(server.patch).toHaveBeenLastCalledWith("notifications/tagged",
            { patch: { title: "Stale" }, expected: "r1" }, undefined, expect.anything());
        refusals.patch = "not-found";
        expect(await store.update("gone", {})).toBeNull();
        refusals.patch = "too-large";
        await expect(store.update("tagged", {})).rejects.toMatchObject({ code: "too-large" });

        const post = vi.fn(async () => ({ refused: 0 }));
        server.postWithSilentErrors = post as typeof server.postWithSilentErrors;
        await store.dismiss("tagged");
        await store.dismiss({ id: "other", raisedAt: other.raisedAt });
        await store.dismiss("missing");
        expect(post.mock.calls).toEqual([ tagged, other ].map(({ id, raisedAt }) => [
            "notifications/dismiss", { refs: [ { id, raisedAt } ], reason: "handler" }
        ]));

        // Text that is not a refusal of a notification route has no code of its own.
        server.postWithSilentErrors = vi.fn(async () => {
            throw "rejected by browser";
        }) as typeof server.postWithSilentErrors;
        await expect(store.create({ title: "Offline" }))
            .rejects.toMatchObject({ code: "internal" });
    });

    it("alerts unless the device is silent, and ignores changes before it starts", async () => {
        const store = new NotificationStore();
        store.applyEntityChanges([ rowChange(makeNotification("early", 1), 1) ]);
        expect(store.notifications.value).toEqual([]);

        servePages([], 1);
        store.start();
        store.start();
        expect(ws.messageHandlers).toHaveLength(1);

        const isSilent = vi.spyOn(options, "is").mockReturnValue(true);
        ws.messageHandlers[0]({ type: "notification-alert", notificationId: "a" });
        isSilent.mockReturnValue(false);
        ws.messageHandlers[0]({ type: "notification-alert", notificationId: "b" });
        await vi.waitFor(() => expect(alerts.showAlert).toHaveBeenCalledOnce());
        expect(alerts.showAlert).toHaveBeenCalledWith("b");
    });

    it("waits for a notification to reach it, or gives up", async () => {
        vi.useFakeTimers();
        servePages([], 1);
        const store = new NotificationStore();
        store.start();
        await vi.runAllTimersAsync();
        const notification = makeNotification("later", 1);

        const found = store.waitFor(notification.notificationId, 5000);
        const missing = store.waitFor("never", 5000);
        store.applyEntityChanges([ rowChange(notification, 2) ]);
        expect(await found).toBe(notification);
        expect(await store.waitFor(notification.notificationId, 5000)).toBe(notification);

        await vi.advanceTimersByTimeAsync(5000);
        expect(await missing).toBeNull();
    });

    it("logs a failed load by its code and keeps what it showed", async () => {
        servePages([ makeNotification("shown", 1) ], 1);
        const store = new NotificationStore();
        await store.whenLoaded();

        server.getWithSilentErrors = vi.fn(async () => {
            throw JSON.stringify({ code: "not-initialized" });
        }) as typeof server.getWithSilentErrors;
        await store.reload();

        expect(store.notifications.value.map(({ id }) => id)).toEqual([ "shown" ]);
        expect(ws.logError).toHaveBeenCalledWith(
            "A notification request failed: load, not-initialized.");
    });
});
