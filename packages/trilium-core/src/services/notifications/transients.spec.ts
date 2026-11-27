import type { TransientNotification, WebSocketMessage } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationError } from "./model.js";
import TransientNotifications, { type TransientProducer } from "./transients.js";

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0, 0);
const SECOND = 1000;
const CLIENT_A: TransientProducer = {
    name: "client", key: "client:a", isBuiltIn: false, expires: true
};
const CLIENT_B: TransientProducer = {
    name: "client", key: "client:b", isBuiltIn: false, expires: true
};
const SCRIPT: TransientProducer = {
    name: "script:spec0script", key: "script:spec0script", isBuiltIn: false, expires: false
};
const BUILT_IN: TransientProducer = {
    name: "trilium:spec", key: "trilium:spec", isBuiltIn: true, expires: false
};

type TransientMessage = Extract<WebSocketMessage, { type: "transient-notifications" }>;

let registry: TransientNotifications;
let messages: TransientMessage[];
let protectedNoteIds: Set<string>;
let isSessionOpen: boolean;

beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    messages = [];
    protectedNoteIds = new Set();
    isSessionOpen = false;
    registry = new TransientNotifications({
        transport: {
            send: (message) => {
                if (message.type === "transient-notifications") {
                    messages.push(message);
                }
            }
        },
        isNoteSensitive: (noteId) => protectedNoteIds.has(noteId),
        isProtectedSessionOpen: () => isSessionOpen
    });
});

afterEach(() => {
    registry.stop();
    vi.useRealTimers();
});

function codeOf(run: () => unknown) {
    try {
        run();
        return null;
    } catch (e) {
        return e instanceof NotificationError ? e.code : `thrown: ${e}`;
    }
}

function byId(id: string): TransientNotification | undefined {
    return registry.list().find((transient) => transient.id === id);
}

describe("transient notifications", () => {
    it("are changed, kept alive and dismissed only with their owner token", () => {
        const token = registry.put("spec-a", { title: "Import", progress: 0.1 }, CLIENT_A);
        expect(token).toMatch(/^[A-Za-z0-9]{32}$/);
        expect(byId("spec-a")).toEqual({
            id: "spec-a", type: "transient", producer: "client",
            createdAt: "2026-11-27 12:00:00.000Z", title: "Import", progress: 0.1
        });

        // Another client cannot change, replace or dismiss it, with no token or a wrong one.
        expect(codeOf(() => registry.put("spec-a", { title: "Mine now" }, CLIENT_B)))
            .toBe("not-owner");
        expect(codeOf(() => registry.put("spec-a", { title: "Mine now" }, CLIENT_B,
            "x".repeat(32)))).toBe("not-owner");
        expect(codeOf(() => registry.dismiss("spec-a", "x".repeat(32)))).toBe("not-owner");
        expect(codeOf(() => registry.dismiss("spec-a", undefined))).toBe("invalid-input");
        expect(byId("spec-a")?.title).toBe("Import");

        vi.advanceTimersByTime(SECOND);
        expect(registry.put("spec-a", { title: "Import", progress: 0.5 }, CLIENT_B, token))
            .toBe(token);
        // A replacement keeps the producer and the time of the creation.
        expect(byId("spec-a")).toMatchObject({
            progress: 0.5, createdAt: "2026-11-27 12:00:00.000Z"
        });

        registry.dismiss("spec-a", token);
        expect(byId("spec-a")).toBeUndefined();
        // Dismissing what no longer exists does nothing.
        expect(codeOf(() => registry.dismiss("spec-a", token))).toBeNull();
    });

    it("checks their input, the reserved names and the size of 2 KiB", () => {
        expect(codeOf(() => registry.put("bad id", { title: "T" }, CLIENT_A)))
            .toBe("invalid-input");
        expect(codeOf(() => registry.put("spec", null, CLIENT_A))).toBe("invalid-input");
        expect(codeOf(() => registry.put("spec", {}, CLIENT_A))).toBe("invalid-input");
        expect(codeOf(() => registry.put("spec", { title: "a\nb" }, CLIENT_A)))
            .toBe("invalid-input");
        expect(codeOf(() => registry.put("spec", { title: "T", progress: 2 }, CLIENT_A)))
            .toBe("invalid-input");
        expect(codeOf(() => registry.put("spec", { title: "T" }, CLIENT_A, 5)))
            .toBe("invalid-input");
        expect(codeOf(() => registry.put("trilium:spec", { title: "T" }, CLIENT_A)))
            .toBe("reserved-name");
        expect(codeOf(() => registry.put("spec", { title: "T", handler: "trilium:x" }, SCRIPT)))
            .toBe("reserved-name");
        expect(codeOf(() => registry.put("trilium:spec", { title: "T", handler: "trilium:x" },
            BUILT_IN))).toBeNull();

        const overhead = JSON.stringify({
            content: { v: 1, title: "T", description: "" }, privateText: null
        }).length;
        expect(codeOf(() => registry.put("spec-large", {
            title: "T", description: "d".repeat(2048 - overhead + 1)
        }, CLIENT_A))).toBe("too-large");
        expect(codeOf(() => registry.put("spec-large", {
            title: "T", description: "d".repeat(2048 - overhead)
        }, CLIENT_A))).toBeNull();
    });

    it("holds 20 at most, 10 of one producer, and keeps the existing ones working", () => {
        const tokens: string[] = [];
        for (let index = 0; index < 10; index++) {
            tokens.push(registry.put(`spec-a-${index}`, { title: "A" }, CLIENT_A));
        }
        expect(codeOf(() => registry.put("spec-a-10", { title: "A" }, CLIENT_A)))
            .toBe("transient-limit");
        for (let index = 0; index < 10; index++) {
            registry.put(`spec-b-${index}`, { title: "B" }, CLIENT_B);
        }
        expect(codeOf(() => registry.put("spec-script", { title: "S" }, SCRIPT)))
            .toBe("transient-limit");

        expect(codeOf(() => registry.put("spec-a-0", { title: "Changed" }, CLIENT_A, tokens[0])))
            .toBeNull();
        registry.dismiss("spec-a-1", tokens[1]);
        expect(codeOf(() => registry.put("spec-script", { title: "S" }, SCRIPT))).toBeNull();
    });

    it("send the changes in one message per 300 ms, counted, and only what changed", () => {
        const token = registry.put("spec-a", { title: "One" }, CLIENT_A);
        vi.advanceTimersByTime(0);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({ seq: 1, removed: [] });
        expect(messages[0].changed.map(({ id }) => id)).toEqual([ "spec-a" ]);

        registry.put("spec-a", { title: "Two" }, CLIENT_A, token);
        registry.put("spec-a", { title: "Three" }, CLIENT_A, token);
        const other = registry.put("spec-b", { title: "Other" }, CLIENT_A);
        vi.advanceTimersByTime(299);
        expect(messages).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(messages).toHaveLength(2);
        expect(messages[1].seq).toBe(2);
        expect(messages[1].changed.map(({ title }) => title)).toEqual([ "Three", "Other" ]);

        // A notification that changes and ends in one window is only removed.
        registry.put("spec-b", { title: "Last" }, CLIENT_A, other);
        registry.dismiss("spec-b", other);
        vi.advanceTimersByTime(300);
        expect(messages[2]).toMatchObject({ seq: 3, changed: [], removed: [ "spec-b" ] });
        expect(registry.getSeq()).toBe(3);

        // No token, nor any part of it, reaches a client.
        expect(JSON.stringify(messages)).not.toContain(token);
        expect(JSON.stringify(registry.list())).not.toContain(token);
    });

    it("end a minute after the last change of a client, and last for backend code", () => {
        const token = registry.put("spec-client", { title: "Client" }, CLIENT_A);
        registry.put("spec-script", { title: "Script" }, SCRIPT);

        vi.advanceTimersByTime(40 * SECOND);
        registry.put("spec-client", { title: "Client" }, CLIENT_A, token);
        vi.advanceTimersByTime(59 * SECOND);
        expect(byId("spec-client")).toBeDefined();

        vi.advanceTimersByTime(SECOND);
        // The fake clock runs a zero delay set inside a timer only on a later tick.
        vi.advanceTimersByTime(1);
        expect(messages.at(-1)?.removed).toEqual([ "spec-client" ]);
        expect(byId("spec-client")).toBeUndefined();

        vi.advanceTimersByTime(24 * 60 * 60 * SECOND);
        expect(byId("spec-script")).toBeDefined();

        // A create with the token of one that ended keeps that token; another one is refused.
        expect(registry.put("spec-client", { title: "Again" }, CLIENT_A, token)).toBe(token);
        expect(codeOf(() => registry.put("spec-client", { title: "x" }, CLIENT_A,
            "x".repeat(32)))).toBe("not-owner");
    });

    it("keep the owner token that a create brings, so that the create can be repeated", () => {
        const token = "a1".repeat(16);
        expect(registry.put("spec-own", { title: "Import" }, CLIENT_A, token)).toBe(token);
        vi.advanceTimersByTime(SECOND);
        expect(registry.put("spec-own", { title: "Import" }, CLIENT_A, token)).toBe(token);
        expect(byId("spec-own")?.createdAt).toBe("2026-11-27 12:00:00.000Z");
        expect(codeOf(() => registry.put("spec-own", { title: "x" }, CLIENT_B))).toBe("not-owner");

        for (const malformed of [ "short", "x".repeat(33), `${"x".repeat(31)}-` ]) {
            expect(codeOf(() => registry.put("spec-bad", { title: "T" }, CLIENT_A, malformed)),
                malformed).toBe("invalid-input");
        }
        expect(byId("spec-bad")).toBeUndefined();
    });

    it("keep the text of a sensitive one private, and give it only in a protected session", () => {
        protectedNoteIds.add("spec0note01");
        registry.put("spec-note", { noteId: "spec0note01", title: "Bank", progress: -1 },
            CLIENT_A);
        const token = registry.put("spec-named", {
            title: "Public", protectedTitle: "Secret", sensitive: true
        }, CLIENT_A);

        expect(byId("spec-note")).toEqual({
            id: "spec-note", type: "transient", producer: "client",
            createdAt: "2026-11-27 12:00:00.000Z", noteId: "spec0note01", progress: -1,
            sensitive: true
        });
        expect(byId("spec-named")).toMatchObject({ title: "Public", sensitive: true });
        expect(byId("spec-named")?.protectedTitle).toBeUndefined();
        vi.advanceTimersByTime(0);
        expect(JSON.stringify(messages)).not.toMatch(/Bank|Secret/);

        isSessionOpen = true;
        expect(byId("spec-note")).toMatchObject({ protectedTitle: "Bank" });
        expect(byId("spec-named")).toMatchObject({ title: "Public", protectedTitle: "Secret" });

        // Nothing makes it plain again: the root text of a replacement is private as well.
        registry.put("spec-named", { title: "Plain now" }, CLIENT_A, token);
        expect(byId("spec-named")).toMatchObject({ sensitive: true, protectedTitle: "Plain now" });
        expect(byId("spec-named")?.title).toBeUndefined();
    });
});
