import { beforeEach, describe, expect, it, vi } from "vitest";

import getInstanceId from "./instance_id.js";

describe("instance_id", () => {
    it("returns a 12-character string id", () => {
        const id = getInstanceId();

        expect(typeof id).toBe("string");
        expect(id).toHaveLength(12);
    });

    it("memoizes the id so repeated calls return the same value", () => {
        // The module caches the generated id in module-level state, so every
        // subsequent call within the process must yield the identical string.
        const first = getInstanceId();
        const second = getInstanceId();
        const third = getInstanceId();

        expect(second).toBe(first);
        expect(third).toBe(first);
    });

    describe("lazy generation (isolated module)", () => {
        beforeEach(() => {
            vi.resetModules();
            vi.doUnmock("./utils");
        });

        it("generates the id exactly once via randomString(12) and caches it", async () => {
            // Mock the underlying random source so we can both assert the
            // requested length and verify the value is generated lazily, only
            // on the first call, then reused from the cache.
            const randomString = vi.fn((length: number) => "X".repeat(length));
            vi.doMock("./utils", () => ({ randomString }));

            const freshGetInstanceId = (await import("./instance_id.js")).default;

            // Not generated until first access.
            expect(randomString).not.toHaveBeenCalled();

            const a = freshGetInstanceId();
            const b = freshGetInstanceId();

            expect(randomString).toHaveBeenCalledTimes(1);
            expect(randomString).toHaveBeenCalledWith(12);
            expect(a).toBe("XXXXXXXXXXXX");
            expect(b).toBe(a);
        });
    });
});
