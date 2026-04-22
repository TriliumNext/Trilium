import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SpacedUpdate from "./spaced_update";

// Mock logError which is a global in Trilium
vi.stubGlobal("logError", vi.fn());

describe("SpacedUpdate", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("should only call updater once per interval even with multiple pending callbacks", async () => {
        const updater = vi.fn(async () => {
            // Simulate a slow network request - this is where the race condition occurs
            await new Promise((resolve) => setTimeout(resolve, 100));
        });

        const spacedUpdate = new SpacedUpdate(updater, 50);

        // Simulate rapid typing - each keystroke calls scheduleUpdate()
        // This queues multiple setTimeout callbacks due to recursive scheduleUpdate() calls
        for (let i = 0; i < 10; i++) {
            spacedUpdate.scheduleUpdate();
            // Small delay between keystrokes
            await vi.advanceTimersByTimeAsync(5);
        }

        // Advance time past the update interval to trigger the update
        await vi.advanceTimersByTimeAsync(100);

        // Let the "network request" complete and any pending callbacks run
        await vi.advanceTimersByTimeAsync(200);

        // The updater should have been called only ONCE, not multiple times
        // With the bug, multiple pending setTimeout callbacks would all pass the time check
        // during the async updater call and trigger multiple concurrent requests
        expect(updater).toHaveBeenCalledTimes(1);
    });

    it("should call updater again if changes occur during the update", async () => {
        const updater = vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        const spacedUpdate = new SpacedUpdate(updater, 30);

        // First update
        spacedUpdate.scheduleUpdate();
        await vi.advanceTimersByTimeAsync(40);

        // Schedule another update while the first one is in progress
        spacedUpdate.scheduleUpdate();

        // Let first update complete
        await vi.advanceTimersByTimeAsync(60);

        // Advance past the interval again for the second update
        await vi.advanceTimersByTimeAsync(100);

        // Should have been called twice - once for each distinct change period
        expect(updater).toHaveBeenCalledTimes(2);
    });

    it("should restore changed flag on error so retry can happen", async () => {
        const updater = vi.fn()
            .mockRejectedValueOnce(new Error("Network error"))
            .mockResolvedValue(undefined);

        const spacedUpdate = new SpacedUpdate(updater, 50);

        spacedUpdate.scheduleUpdate();

        // Advance to trigger first update (which will fail)
        await vi.advanceTimersByTimeAsync(60);

        // The error should have restored the changed flag, so scheduling again should work
        spacedUpdate.scheduleUpdate();
        await vi.advanceTimersByTimeAsync(60);

        expect(updater).toHaveBeenCalledTimes(2);
    });
});
