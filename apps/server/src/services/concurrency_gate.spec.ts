import { describe, expect, it } from "vitest";

import { createConcurrencyGate } from "./concurrency_gate.js";

/**
 * The gate exists for work that arrives rather than work that is scheduled — images on their way
 * into the database, handed over one call at a time by callers that know nothing of each other.
 * What matters is that the count it keeps is exactly the number running, whoever is looking, and
 * that nothing put into it is ever left there.
 */
describe("a concurrency gate", () => {
    it("runs up to the limit at once and holds the rest back, in the order they arrived", async () => {
        const gate = createConcurrencyGate(() => 2);
        const started: number[] = [];
        const finish: (() => void)[] = [];
        const done = Array.from({ length: 5 }, (_, index) => gate.run(async () => {
            started.push(index);
            await new Promise<void>((resolve) => finish.push(resolve));

            return index;
        }));

        await flush();
        // Two in, three waiting — and the waiting three have not so much as begun.
        expect(started).toEqual([ 0, 1 ]);
        expect(gate.running()).toBe(2);

        // Each one that finishes lets exactly one more through, in turn.
        finish[0]();
        await flush();
        expect(started).toEqual([ 0, 1, 2 ]);
        expect(gate.running()).toBe(2);

        finish.forEach((release) => release());
        await flush();
        finish.forEach((release) => release());

        await expect(Promise.all(done)).resolves.toEqual([ 0, 1, 2, 3, 4 ]);
        // Nothing left holding a place once the work is over.
        expect(gate.running()).toBe(0);
    });

    it("gives up the place of work that threw, rather than closing a little further each time", async () => {
        const gate = createConcurrencyGate(() => 1);

        for (let attempt = 0; attempt < 3; attempt++) {
            await expect(gate.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
        }

        expect(gate.running()).toBe(0);
        // Still lets work through after all that: a gate that leaked on failure would be shut by now.
        await expect(gate.run(async () => "through")).resolves.toBe("through");
    });

    it("follows a limit that changes, and never narrows to nothing", async () => {
        let limit = 1;
        const gate = createConcurrencyGate(() => limit);
        const finish: (() => void)[] = [];
        const start = () => gate.run(() => new Promise<void>((resolve) => finish.push(resolve)));

        void start();
        void start();
        await flush();
        expect(gate.running()).toBe(1);

        // Widened between admissions: the next one in takes the room that has just appeared.
        limit = 3;
        finish[0]();
        await flush();
        expect(gate.running()).toBe(1);
        void start();
        await flush();
        expect(gate.running()).toBe(2);

        // A limit of none would admit nothing at all and stall every image behind it, so one is
        // the floor — the same floor the pool applies to its own worker count.
        limit = 0;
        finish.forEach((release) => release());
        await flush();
        await expect(gate.run(async () => "through")).resolves.toBe("through");
    });
});

/** Lets the admissions released in this turn actually start. */
async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}
