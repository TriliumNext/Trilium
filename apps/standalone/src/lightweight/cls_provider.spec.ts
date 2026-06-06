import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BrowserExecutionContext from "./cls_provider.js";

describe("BrowserExecutionContext", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("returns undefined from get() when no context is active", () => {
        const ctx = new BrowserExecutionContext();
        expect(ctx.get("anything")).toBeUndefined();
    });

    it("throws from set() when no context is active", () => {
        const ctx = new BrowserExecutionContext();
        expect(() => ctx.set("k", "v")).toThrow("ExecutionContext not initialized");
    });

    it("exposes get/set within a synchronous init() scope and cleans up after the grace period", () => {
        const ctx = new BrowserExecutionContext();
        const result = ctx.init(() => {
            ctx.set("k", 42);
            expect(ctx.get<number>("k")).toBe(42);
            return "done";
        });
        expect(result).toBe("done");

        // Still readable during the grace period.
        expect(ctx.get<number>("k")).toBe(42);

        // After the grace period the context is popped off the stack.
        vi.advanceTimersByTime(1000);
        expect(ctx.get("k")).toBeUndefined();
    });

    it("cleans up after an async init() resolves", async () => {
        const ctx = new BrowserExecutionContext();
        const promise = ctx.init(async () => {
            ctx.set("async", "yes");
            return "ok";
        });
        await expect(promise).resolves.toBe("ok");

        vi.advanceTimersByTime(1000);
        expect(ctx.get("async")).toBeUndefined();
    });

    it("schedules cleanup and rethrows when the synchronous callback throws", () => {
        const ctx = new BrowserExecutionContext();
        expect(() => ctx.init(() => { throw new Error("kaboom"); })).toThrow("kaboom");

        // The errored context is still cleaned up after the grace period (no throw).
        expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    });

    it("reset() empties the stack, leaving a pending cleanup timer a no-op", () => {
        const ctx = new BrowserExecutionContext();
        ctx.init(() => "x");
        ctx.reset();
        expect(ctx.get("anything")).toBeUndefined();

        // The cleanup timer fires but the context is already gone (index === -1).
        expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    });
});
