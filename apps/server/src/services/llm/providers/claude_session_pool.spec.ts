import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClaudeSession } from "./claude_session_pool.js";

const infoLogMock = vi.hoisted(() => vi.fn());
vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ info: infoLogMock })
}));

const {
    closeSession, IDLE_TIMEOUT_MS, Pushable, releaseSession, rememberSession, resetClaudeSessionPoolForTests, takeWarmSession
} = await import("./claude_session_pool.js");

describe("Pushable", () => {
    it("queues pushes until consumed and hands a push straight to a waiting consumer", async () => {
        const pushable = new Pushable<string>();
        const iterator = pushable[Symbol.asyncIterator]();

        pushable.push("queued");
        expect(pushable.pending).toEqual(["queued"]);
        expect(await iterator.next()).toEqual({ value: "queued", done: false });

        const waiting = iterator.next();
        pushable.push("direct");
        expect(await waiting).toEqual({ value: "direct", done: false });
        expect(pushable.pending).toEqual([]);
    });

    it("settles every waiting consumer on end() and ignores later pushes", async () => {
        const pushable = new Pushable<string>();
        const iterator = pushable[Symbol.asyncIterator]();
        const waiters = [iterator.next(), iterator.next()];

        pushable.end();
        expect(await Promise.all(waiters)).toEqual([
            { value: undefined, done: true },
            { value: undefined, done: true }
        ]);

        pushable.push("too late");
        expect(pushable.pending).toEqual([]);
        expect(await iterator.next()).toEqual({ value: undefined, done: true });
    });
});

describe("Claude session pool", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        infoLogMock.mockClear();
    });

    afterEach(() => {
        resetClaudeSessionPoolForTests();
        vi.useRealTimers();
    });

    it("hands a released session back on a matching fingerprint and marks it busy", () => {
        const session = fakeSession("fp");
        rememberSession("chat", session);
        releaseSession("chat", session);

        expect(takeWarmSession("unknown", "fp")).toBeUndefined();
        expect(takeWarmSession("chat", "fp")).toBe(session);
        expect(session.busy).toBe(true);
        expect(session.idleTimer).toBeUndefined();
    });

    it.each([
        [ "busy", (session: ClaudeSession) => { session.busy = true; }, "fp" ],
        [ "closed", (session: ClaudeSession) => { session.closed = true; }, "fp" ],
        [ "built with other options", () => {}, "other-fp" ]
    ])("retires a session that is %s instead of handing it out", (_state, mutate, fingerprint) => {
        const session = fakeSession("fp");
        rememberSession("chat", session);
        releaseSession("chat", session);
        mutate(session);

        expect(takeWarmSession("chat", fingerprint)).toBeUndefined();
        // Retired sessions leave the map, so the next lookup finds nothing.
        session.closed = false;
        session.busy = false;
        expect(takeWarmSession("chat", "fp")).toBeUndefined();
    });

    it("closes the previous session when a chat registers a new one", () => {
        const previous = fakeSession();
        const next = fakeSession();
        rememberSession("chat", previous);
        rememberSession("chat", previous);
        expect(previous.closed).toBe(false);

        rememberSession("chat", next);
        expect(previous.closed).toBe(true);
        expect(previous.query.close).toHaveBeenCalledOnce();
        expect(next.closed).toBe(false);
    });

    it("forgets a session released after its stream closed", () => {
        const session = fakeSession("fp");
        rememberSession("chat", session);
        session.closed = true;
        releaseSession("chat", session);

        expect(session.idleTimer).toBeUndefined();
        session.closed = false;
        expect(takeWarmSession("chat", "fp")).toBeUndefined();
    });

    it("reaps an idle session after the timeout, but spares one a turn picked up again", () => {
        const idle = fakeSession();
        rememberSession("idle", idle);
        releaseSession("idle", idle);

        const reused = fakeSession();
        rememberSession("reused", reused);
        releaseSession("reused", reused);
        // A turn that claims the session without going through the pool.
        reused.busy = true;

        vi.advanceTimersByTime(IDLE_TIMEOUT_MS);

        expect(idle.closed).toBe(true);
        expect(idle.idleTimer).toBeUndefined();
        expect(infoLogMock).toHaveBeenCalledWith(expect.stringContaining("chat idle"));
        expect(reused.closed).toBe(false);
    });

    it("closes a session only once and logs a failing close instead of throwing", () => {
        const session = fakeSession();
        vi.mocked(session.query.close).mockImplementation(() => {
            throw new Error("already dead");
        });

        closeSession("chat", session);
        closeSession("chat", session);

        expect(session.query.close).toHaveBeenCalledOnce();
        expect(infoLogMock).toHaveBeenCalledWith(expect.stringContaining("(already dead)"));

        const other = fakeSession();
        vi.mocked(other.query.close).mockImplementation(() => {
            throw "plain string";
        });
        closeSession("chat", other);
        expect(infoLogMock).toHaveBeenCalledWith(expect.stringContaining("(plain string)"));
    });
});

function fakeSession(fingerprint = ""): ClaudeSession {
    return {
        query: { close: vi.fn() } as unknown as ClaudeSession["query"],
        input: new Pushable(),
        fingerprint,
        closed: false,
        busy: false
    };
}
