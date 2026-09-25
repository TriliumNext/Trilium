import { beforeEach, describe, expect, it, vi } from "vitest";

import BrowserExecutionContext from "./cls_provider.js";

/**
 * The browser has no `AsyncLocalStorage`, so scopes are tracked on a stack. That model is sound
 * as long as one scope is live at a time, which `dbLock` gives the worker: a synchronous scope
 * cannot be interleaved, and an asynchronous one holds the connection exclusively. What the stack
 * still owes is LIFO discipline — a scope ends when its callback does, and ending it uncovers the
 * one it was opened inside.
 *
 * Isolating scopes that genuinely overlap is not something a stack can do, so that is asserted
 * where it is enforced instead: `browser_router.spec.ts`.
 */
describe("BrowserExecutionContext", () => {
    beforeEach(() => {
        // Nothing here is timer-driven. Faked so a stray cleanup timer cannot outlive its test.
        vi.useFakeTimers({ shouldAdvanceTime: false });
    });

    it("returns undefined from get() outside a scope, and throws from set()", () => {
        const ctx = new BrowserExecutionContext();

        expect(ctx.get("anything")).toBeUndefined();
        expect(() => ctx.set("k", "v")).toThrow("ExecutionContext not initialized");
    });

    it("ends a synchronous scope as soon as its callback returns", () => {
        const ctx = new BrowserExecutionContext();

        const returned = ctx.init(() => {
            ctx.set("k", 42);
            return ctx.get<number>("k");
        });

        expect(returned).toBe(42);
        expect(ctx.get("k")).toBeUndefined();
    });

    it("keeps an async scope across its awaits and ends it once the promise settles", async () => {
        const ctx = new BrowserExecutionContext();
        let release = () => {};
        const paused = new Promise<void>((resolve) => { release = resolve; });

        const running = ctx.init(async () => {
            ctx.set("k", "async");
            await paused;
            return ctx.get<string>("k");
        });

        release();

        await expect(running).resolves.toBe("async");
        expect(ctx.get("k")).toBeUndefined();
    });

    // Matches the server context, which routes/api/llm.ts depends on: it opens a nested scope
    // while its request is still on the stack and reads the request's componentId through it.
    it("inherits the enclosing scope, and uncovers it when the nested one ends", () => {
        const ctx = new BrowserExecutionContext();

        ctx.init(() => {
            ctx.set("componentId", "outer");
            ctx.set("hoistedNoteId", "noteABC");

            const inner = ctx.init(() => {
                expect(ctx.get<string>("componentId")).toBe("outer");
                ctx.set("componentId", "inner");
                return ctx.get<string>("componentId");
            });

            expect(inner).toBe("inner");
            expect(ctx.get<string>("componentId")).toBe("outer");
            expect(ctx.get<string>("hoistedNoteId")).toBe("noteABC");
        });
    });

    it("ends a scope whose callback throws, leaving the enclosing one readable", () => {
        const ctx = new BrowserExecutionContext();

        ctx.init(() => {
            ctx.set("componentId", "outer");

            expect(() => ctx.init(() => { throw new Error("kaboom"); })).toThrow("kaboom");

            expect(ctx.get<string>("componentId")).toBe("outer");
        });

        expect(ctx.get("componentId")).toBeUndefined();
    });

    it("ends an async scope whose promise rejects", async () => {
        const ctx = new BrowserExecutionContext();

        const running = ctx.init(async () => {
            ctx.set("k", "doomed");
            throw new Error("kaboom");
        });

        await expect(running).rejects.toThrow("kaboom");
        expect(ctx.get("k")).toBeUndefined();
    });

    it("drops every scope on reset()", () => {
        const ctx = new BrowserExecutionContext();

        ctx.init(() => {
            ctx.set("k", 1);
            ctx.reset();
            expect(ctx.get("k")).toBeUndefined();
        });
    });
});
