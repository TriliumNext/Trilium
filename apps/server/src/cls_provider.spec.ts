import { EventEmitter } from "events";
import { describe, expect, it } from "vitest";

import AsyncLocalStorageExecutionContext, { bindEmitter } from "./cls_provider.js";

/**
 * The contract every `ExecutionContext` on the Node side has to satisfy. `route_api`, `etapi_utils`
 * and `custom` all rely on it, and `putEntityChange()` writes through it on every entity save, so a
 * gap here surfaces as lost entity changes rather than as a thrown error.
 */
describe("AsyncLocalStorageExecutionContext", () => {
    const ctx = new AsyncLocalStorageExecutionContext();

    describe("value storage", () => {
        it("round-trips values inside init() and returns the callback's value", () => {
            const returned = ctx.init(() => {
                ctx.set("alpha", 42);
                return ctx.get<number>("alpha");
            });

            expect(returned).toBe(42);
        });

        it("returns undefined from get() outside a context, and throws from set()", () => {
            expect(ctx.get("never-set")).toBeUndefined();
            expect(() => ctx.set("alpha", 1)).toThrow(/No context available/);
        });

        it("isolates sibling scopes", () => {
            ctx.init(() => ctx.set("shared", "first"));

            expect(ctx.init(() => ctx.get<string>("shared"))).toBeUndefined();
        });

        // `llm.ts` opens a nested init() while the request that started it is still on the stack,
        // and relies on inheriting its componentId and hoistedNoteId — an empty child context would
        // stamp the entity changes its tool calls produce with "NA" instead of the request's id.
        it("inherits the enclosing context, and shadows rather than overwrites it", () => {
            ctx.init(() => {
                ctx.set("componentId", "request");
                ctx.set("hoistedNoteId", "noteABC");

                const inner = ctx.init(() => {
                    expect(ctx.get<string>("componentId")).toBe("request");
                    ctx.set("componentId", "nested");
                    return ctx.get<string>("componentId");
                });

                expect(inner).toBe("nested");
                expect(ctx.get<string>("componentId")).toBe("request");
                expect(ctx.get<string>("hoistedNoteId")).toBe("noteABC");
            });
        });

        it("propagates a throw out of init()", () => {
            expect(() => ctx.init(() => { throw new Error("kaboom"); })).toThrow("kaboom");
            expect(ctx.get("shared")).toBeUndefined();
        });
    });

    describe("async propagation", () => {
        it("keeps the context across await, timers, nextTick and promise chains", async () => {
            const seen: Record<string, string | undefined> = {};

            await ctx.init(async () => {
                ctx.set("id", "X");

                await Promise.resolve();
                seen.afterAwait = ctx.get<string>("id");

                await new Promise<void>((resolve) => setTimeout(() => {
                    seen.inTimer = ctx.get<string>("id");
                    resolve();
                }, 1));

                await new Promise<void>((resolve) => process.nextTick(() => {
                    seen.inNextTick = ctx.get<string>("id");
                    resolve();
                }));

                seen.inChain = await Promise.resolve().then(() => ctx.get<string>("id"));
            });

            expect(seen).toEqual({ afterAwait: "X", inTimer: "X", inNextTick: "X", inChain: "X" });
        });

        it("keeps concurrent contexts separate while they interleave", async () => {
            const request = (id: string, delayMs: number) => ctx.init(async () => {
                ctx.set("componentId", id);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                return ctx.get<string>("componentId");
            });

            // The slow one starts first and finishes last, so the two overlap.
            const seen = await Promise.all([request("slow", 20), request("fast", 1)]);

            expect(seen).toEqual(["slow", "fast"]);
            expect(ctx.get("componentId")).toBeUndefined();
        });
    });

    describe("bindEmitter", () => {
        it("runs a listener in its add-time context, even when emitted from outside", async () => {
            const emitter = new EventEmitter();
            bindEmitter(emitter);
            let seen: string | undefined;

            ctx.init(() => {
                ctx.set("componentId", "handler");
                emitter.on("close", () => { seen = ctx.get<string>("componentId"); });
            });

            // Emit from a later macrotask, so nothing is active — as when a client aborts a request
            // long after the route handler returned.
            await new Promise((resolve) => setImmediate(resolve));
            expect(ctx.get("componentId")).toBeUndefined();

            emitter.emit("close");

            expect(seen).toBe("handler");
        });

        it("gives a listener added outside any context a fresh one, so set() works", () => {
            const emitter = new EventEmitter();
            bindEmitter(emitter);
            const seen: Array<string | undefined> = [];

            emitter.on("close", () => {
                seen.push(ctx.get<string>("mark"));
                ctx.set("mark", "written");
            });

            // Each emit gets its own context: the second must not see the first one's write.
            expect(() => { emitter.emit("close"); emitter.emit("close"); }).not.toThrow();
            expect(seen).toEqual([undefined, undefined]);
        });

        it("leaves the emitter's own mechanics untouched", () => {
            const emitter = new EventEmitter();
            bindEmitter(emitter);
            let thisArg: unknown;
            function listener(this: unknown) { thisArg = this; }

            emitter.on("close", listener);
            expect(emitter.listenerCount("close")).toBe(1);
            expect(emitter.listeners("close")).toContain(listener);

            emitter.emit("close");
            expect(thisArg).toBe(emitter);

            emitter.off("close", listener);
            expect(emitter.listenerCount("close")).toBe(0);

            let onceCount = 0;
            emitter.once("finish", () => { onceCount += 1; });
            emitter.emit("finish");
            emitter.emit("finish");
            expect(onceCount).toBe(1);
            expect(emitter.listenerCount("finish")).toBe(0);
        });
    });

    it("drops the active context on reset(), and starts clean on the next init()", () => {
        ctx.init(() => {
            ctx.set("alpha", 1);
            ctx.reset();
            expect(ctx.get("alpha")).toBeUndefined();
        });

        const afterReset = ctx.init(() => {
            ctx.set("alpha", 2);
            return ctx.get<number>("alpha");
        });

        expect(afterReset).toBe(2);
    });
});
