import { describe, expect, it } from "vitest";

import events from "./events.js";

/**
 * The events service is a pure in-memory pub/sub over a module-level listener
 * map. Each test uses a unique event name so listeners don't leak across tests.
 */
describe("events service", () => {
    it("subscribes to a single (non-array) event and delivers the payload", () => {
        const received: unknown[] = [];
        events.subscribe("TEST_SINGLE", (data) => received.push(data));

        events.emit("TEST_SINGLE", { a: 1 });

        expect(received).toEqual([ { a: 1 } ]);
    });

    it("subscribes to an array of events", () => {
        const calls: string[] = [];
        events.subscribe([ "TEST_A", "TEST_B" ], () => calls.push("hit"));

        events.emit("TEST_A");
        events.emit("TEST_B");

        expect(calls).toHaveLength(2);
    });

    it("emitting an event with no listeners is a no-op", () => {
        expect(() => events.emit("TEST_NO_LISTENERS")).not.toThrow();
    });

    it("runs the becca-loader listener before regular listeners", () => {
        const order: string[] = [];
        events.subscribe("TEST_ORDER", () => order.push("regular"));
        events.subscribeBeccaLoader("TEST_ORDER", () => order.push("becca"));

        events.emit("TEST_ORDER");

        expect(order).toEqual([ "becca", "regular" ]);
    });

    it("subscribeBeccaLoader accepts an array of events", () => {
        const calls: string[] = [];
        events.subscribeBeccaLoader([ "TEST_BL_A", "TEST_BL_B" ], () => calls.push("hit"));

        events.emit("TEST_BL_A");
        events.emit("TEST_BL_B");

        expect(calls).toHaveLength(2);
    });

    it("isolates a throwing listener so the others still run", () => {
        const calls: string[] = [];
        events.subscribe("TEST_THROW", () => {
            throw new Error("boom");
        });
        events.subscribe("TEST_THROW", () => calls.push("second"));

        expect(() => events.emit("TEST_THROW")).not.toThrow();
        expect(calls).toEqual([ "second" ]);
    });
});
