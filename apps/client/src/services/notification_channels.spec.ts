import type {
    NotificationChannelBundle, NotificationChannelPayload, NotificationDeliveryClaimResponse
} from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logError = vi.hoisted(() => vi.fn());

vi.mock("./ws.js", () => {
    const ignore = () => {};
    const waitForMaxKnownEntityChangeId = async () => {};
    return {
        default: { subscribeToMessages: ignore, waitForMaxKnownEntityChangeId },
        subscribeToMessages: ignore,
        unsubscribeToMessage: ignore,
        subscribeToReconnect: ignore,
        waitForMaxKnownEntityChangeId,
        logError
    };
});

import { buildNote } from "../test/easy-froca.js";
import {
    DELIVERY_TIMEOUT_MS, FALLBACK_PROFILE_ID, readProfileId, runForwardedDelivery
} from "./notification_channels.js";
import server from "./server.js";

const PAYLOAD: NotificationChannelPayload = {
    key: "k1",
    title: "Backup done",
    category: "general",
    attentionLevel: "high",
    raisedAt: "2026-11-27 10:00:00.000Z"
};

/** What a channel script saw of its API, which the scripts below write to `window.seenApi`. */
interface SeenApi {
    title?: string;
    key?: string;
    attempt?: number;
    isSignal?: boolean;
    settings?: Record<string, string>;
}

let posts: [ string, unknown ][];
let claim: NotificationDeliveryClaimResponse;

beforeEach(() => {
    posts = [];
    claim = { granted: false };
    logError.mockClear();
    vi.spyOn(server, "postWithSilentErrors").mockImplementation(async (url, data) => {
        posts.push([ url, data ]);
        return (url.endsWith("/claim") ? claim : undefined) as never;
    });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("runForwardedDelivery", () => {
    it("claims what was announced, and runs nothing for a claim that is refused", async () => {
        await runForwardedDelivery(forward("k1"));
        expect(posts).toEqual([ [
            "notification-channels/deliveries/claim",
            // The test page has no document ID hash, so the tab uses the fixed ID.
            { deliveryKey: "k1", profileId: FALLBACK_PROFILE_ID }
        ] ]);

        // A grant without a bundle to run counts as refused.
        claim = { granted: true, payload: PAYLOAD };
        await runForwardedDelivery(forward("k1"));
        expect(posts.map(([ url ]) => url))
            .not.toContain("notification-channels/deliveries/result");
    });

    it("runs a granted bundle with the notification, the attempt and the settings", async () => {
        claim = {
            granted: true,
            payload: PAYLOAD,
            attempt: 2,
            channelSettings: { topic: "alerts" },
            bundle: channelBundle(`window.seenApi = {
                title: api.notification.title,
                key: api.delivery.key,
                attempt: api.delivery.attempt,
                isSignal: api.delivery.signal instanceof AbortSignal,
                settings: api.channelSettings
            };`)
        };
        await runForwardedDelivery(forward("k1"));

        expect(seenApi()).toEqual({
            title: "Backup done", key: "k1", attempt: 2, isSignal: true,
            settings: { topic: "alerts" }
        });
        const [ url, result ] = posts[1];
        expect(url).toBe("notification-channels/deliveries/result");
        expect(result).toEqual({
            deliveryKey: "k1", profileId: FALLBACK_PROFILE_ID, durationMs: expect.any(Number)
        });
        expect(Number.isInteger((result as { durationMs: number }).durationMs)).toBe(true);
    });

    it("reports a script that throws by its code, and logs nothing of its message", async () => {
        claim = {
            granted: true,
            payload: PAYLOAD,
            bundle: channelBundle(`throw new Error("The token abc123 was refused");`)
        };
        await runForwardedDelivery(forward("k1"));

        expect(posts[1][1]).toMatchObject({ errorCode: "script-error" });
        expect(JSON.stringify(logError.mock.calls)).not.toContain("abc123");
    });

    it("reports a script that fails after its signal aborted as a timeout", async () => {
        vi.useFakeTimers();
        claim = {
            granted: true,
            payload: PAYLOAD,
            bundle: channelBundle(`await new Promise((resolve, reject) => {
                api.delivery.signal.addEventListener("abort", () => reject(new Error("aborted")));
            });`)
        };
        const run = runForwardedDelivery(forward("k1"));
        await vi.advanceTimersByTimeAsync(DELIVERY_TIMEOUT_MS - 1);
        expect(posts).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(1);
        await run;
        expect(posts[1][1]).toMatchObject({ errorCode: "timeout" });
    });

    it("counts a script that finishes after its signal aborted as sent", async () => {
        vi.useFakeTimers();
        const delayMs = DELIVERY_TIMEOUT_MS + 1000;
        claim = {
            granted: true,
            payload: PAYLOAD,
            bundle: channelBundle(
                `await new Promise((resolve) => setTimeout(resolve, ${delayMs}));`)
        };
        const run = runForwardedDelivery(forward("k1"));
        await vi.advanceTimersByTimeAsync(delayMs);
        await run;
        expect(posts[1][1]).not.toHaveProperty("errorCode");
    });

    it("logs a failed claim by its code only", async () => {
        vi.mocked(server.postWithSilentErrors).mockRejectedValueOnce(
            JSON.stringify({ code: "internal", deliveryKey: "k1" }));
        await runForwardedDelivery(forward("k1"));

        expect(logError).toHaveBeenCalledWith(
            "A notification channel request failed: claim, internal.");
        expect(posts).toHaveLength(0);
    });
});

describe("readProfileId", () => {
    it("gives tabs that start together one ID, and keeps it", async () => {
        const indexedDb = new FakeIndexedDb();
        const factory = indexedDb as unknown as IDBFactory;
        const [ first, second ] = await Promise.all([
            readProfileId(factory, "doc1"), readProfileId(factory, "doc1")
        ]);

        expect(first).toMatch(/^[A-Za-z0-9]{20}$/);
        expect(second).toBe(first);
        expect(await readProfileId(factory, "doc1")).toBe(first);
        // Another database behind the same origin has a profile ID of its own.
        const other = await readProfileId(factory, "doc2");
        expect(other).not.toBe(first);
        expect(indexedDb.stored()).toEqual({ "profile-doc1": first, "profile-doc2": other });
    });

    it("uses the fixed ID where IndexedDB does not open", async () => {
        const failing = {
            open() {
                const opening: { onerror?: () => void } = {};
                setTimeout(() => opening.onerror?.());
                return opening;
            }
        } as unknown as IDBFactory;
        const throwing = {
            open() {
                throw new DOMException("The operation is insecure.", "SecurityError");
            }
        } as unknown as IDBFactory;

        expect(await readProfileId(undefined, "doc1")).toBe(FALLBACK_PROFILE_ID);
        expect(await readProfileId(failing, "doc1")).toBe(FALLBACK_PROFILE_ID);
        expect(await readProfileId(throwing, "doc1")).toBe(FALLBACK_PROFILE_ID);
        expect(await readProfileId(new FakeIndexedDb() as unknown as IDBFactory, undefined))
            .toBe(FALLBACK_PROFILE_ID);
    });
});

function forward(deliveryKey: string) {
    return { type: "notification-forward", deliveryKey, channelId: "c1" } as const;
}

function seenApi() {
    return (window as Window & { seenApi?: SeenApi }).seenApi;
}

/** A bundle as the backend builds it for a channel note, here a note made for the test. */
function channelBundle(script: string): NotificationChannelBundle {
    const noteId = buildNote({
        title: "Channel", type: "code", mime: "application/javascript;env=frontend"
    }).noteId;
    return {
        script: `apiContext.modules["${noteId}"] = { exports: {} };
return await ((async function(exports, module, require, api) {
${script}
return module.exports;
}).call({}, {}, apiContext.modules["${noteId}"], apiContext.require([]),
    apiContext.apis["${noteId}"]));`,
        html: "",
        noteId,
        allNoteIds: [ noteId ]
    };
}

/**
 * The part of IndexedDB that the profile ID uses. The result of each request arrives in a later
 * task, and the transactions of a database run one after another, as a browser runs the readwrite
 * transactions of one store.
 */
class FakeIndexedDb {

    private readonly databases = new Map<string, FakeDatabase>();

    open(name: string) {
        const opening: {
            result?: ReturnType<FakeDatabase["connect"]>;
            onupgradeneeded?: () => void;
            onsuccess?: () => void;
        } = {};
        setTimeout(() => {
            const existing = this.databases.get(name);
            const database = existing ?? new FakeDatabase();
            this.databases.set(name, database);
            opening.result = database.connect();
            if (!existing) {
                opening.onupgradeneeded?.();
            }
            opening.onsuccess?.();
        });
        return opening;
    }

    /** The entries of every store, by key. */
    stored() {
        const entries: Record<string, unknown> = {};
        for (const database of this.databases.values()) {
            for (const store of database.stores.values()) {
                Object.assign(entries, Object.fromEntries(store));
            }
        }
        return entries;
    }

}

class FakeDatabase {

    readonly stores = new Map<string, Map<string, unknown>>();
    private readonly queue: FakeTransaction[] = [];

    connect() {
        return {
            createObjectStore: (name: string) => this.stores.set(name, new Map()),
            transaction: (name: string) => {
                const store = this.stores.get(name) ?? new Map<string, unknown>();
                const transaction = new FakeTransaction(store, () => this.next());
                this.queue.push(transaction);
                if (this.queue.length === 1) {
                    transaction.start();
                }
                return transaction;
            },
            close: () => {}
        };
    }

    private next() {
        this.queue.shift();
        this.queue[0]?.start();
    }

}

class FakeTransaction {

    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    error: DOMException | null = null;
    private pending = 0;
    private isStarted = false;
    private isFinished = false;
    private readonly waiting: (() => void)[] = [];

    constructor(
        private readonly data: Map<string, unknown>,
        private readonly onFinish: () => void
    ) {}

    objectStore() {
        return {
            get: (key: string) => this.request(() => this.data.get(key)),
            add: (value: unknown, key: string) => this.request(() => {
                if (this.data.has(key)) {
                    throw new DOMException("The key exists.", "ConstraintError");
                }
                this.data.set(key, value);
                return key;
            })
        };
    }

    start() {
        this.isStarted = true;
        for (const run of this.waiting.splice(0)) {
            run();
        }
        setTimeout(() => this.settle());
    }

    private request(step: () => unknown) {
        const request: { result?: unknown; onsuccess?: () => void } = {};
        this.pending++;
        const run = () => setTimeout(() => {
            try {
                request.result = step();
            } catch (e) {
                this.error = e as DOMException;
                this.finish(this.onabort);
                return;
            }
            request.onsuccess?.();
            this.pending--;
            this.settle();
        });
        if (this.isStarted) {
            run();
        } else {
            this.waiting.push(run);
        }
        return request;
    }

    private settle() {
        if (this.pending === 0) {
            this.finish(this.oncomplete);
        }
    }

    private finish(callback: (() => void) | null) {
        if (this.isFinished) {
            return;
        }
        this.isFinished = true;
        callback?.();
        this.onFinish();
    }

}
