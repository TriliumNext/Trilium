import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SpacedUpdate from "./spaced_update.js";

describe("SpacedUpdate", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("scheduleUpdate / triggerUpdate", () => {
        it("fires the updater once the interval has elapsed", async () => {
            const updater = vi.fn();
            const spacedUpdate = new SpacedUpdate(updater, 50);

            // Move the clock forward so the very next change is already past the interval
            // relative to the construction time.
            await vi.advanceTimersByTimeAsync(60);

            spacedUpdate.scheduleUpdate();
            await vi.runAllTimersAsync();

            expect(updater).toHaveBeenCalledTimes(1);
        });

        it("reschedules instead of firing while still within the interval, then fires once", async () => {
            const updater = vi.fn();
            const spacedUpdate = new SpacedUpdate(updater, 100);

            // Rapid scheduling well within the interval keeps deferring the update.
            for (let i = 0; i < 5; i++) {
                spacedUpdate.scheduleUpdate();
                await vi.advanceTimersByTimeAsync(10);
            }
            expect(updater).not.toHaveBeenCalled();

            // Once the interval fully elapses the pending change flushes exactly once.
            await vi.advanceTimersByTimeAsync(200);
            expect(updater).toHaveBeenCalledTimes(1);
        });

        it("triggerUpdate is a no-op when nothing changed", () => {
            const updater = vi.fn();
            const spacedUpdate = new SpacedUpdate(updater, 50);

            spacedUpdate.triggerUpdate();

            expect(updater).not.toHaveBeenCalled();
        });

        it("clears the changed flag after a successful flush so a second elapsed trigger does nothing", async () => {
            const updater = vi.fn();
            const spacedUpdate = new SpacedUpdate(updater, 50);

            await vi.advanceTimersByTimeAsync(60);
            spacedUpdate.scheduleUpdate();
            await vi.runAllTimersAsync();
            expect(updater).toHaveBeenCalledTimes(1);

            // No new change scheduled -> even past the interval triggerUpdate stays inert.
            await vi.advanceTimersByTimeAsync(100);
            spacedUpdate.triggerUpdate();
            expect(updater).toHaveBeenCalledTimes(1);
        });
    });

    describe("updateNowIfNecessary", () => {
        it("calls the updater when there are pending changes", async () => {
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50);

            spacedUpdate.scheduleUpdate();
            await spacedUpdate.updateNowIfNecessary();

            expect(updater).toHaveBeenCalledTimes(1);
        });

        it("does nothing when there are no pending changes", async () => {
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50);

            await spacedUpdate.updateNowIfNecessary();

            expect(updater).not.toHaveBeenCalled();
        });

        it("restores the changed flag and rethrows when the updater fails, allowing a retry", async () => {
            let shouldFail = true;
            const updater = vi.fn(async () => {
                if (shouldFail) {
                    throw new Error("boom");
                }
            });
            const spacedUpdate = new SpacedUpdate(updater, 50);

            spacedUpdate.scheduleUpdate();

            await expect(spacedUpdate.updateNowIfNecessary()).rejects.toThrow("boom");

            // changed flag restored -> a subsequent successful flush runs the updater again.
            shouldFail = false;
            await spacedUpdate.updateNowIfNecessary();
            expect(updater).toHaveBeenCalledTimes(2);
        });
    });

    describe("isAllSavedAndTriggerUpdate", () => {
        it("returns false and flushes pending changes when there are changes", async () => {
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50);

            spacedUpdate.scheduleUpdate();

            expect(spacedUpdate.isAllSavedAndTriggerUpdate()).toBe(false);

            await vi.runAllTimersAsync();
            expect(updater).toHaveBeenCalledTimes(1);
        });

        it("returns true and does not call the updater when nothing is pending", () => {
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50);

            expect(spacedUpdate.isAllSavedAndTriggerUpdate()).toBe(true);
            expect(updater).not.toHaveBeenCalled();
        });
    });

    describe("allowUpdateWithoutChange", () => {
        it("suppresses scheduleUpdate while the callback runs and re-enables it afterwards", async () => {
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50);

            await spacedUpdate.allowUpdateWithoutChange(async () => {
                // scheduleUpdate is a no-op while change is forbidden.
                spacedUpdate.scheduleUpdate();
            });

            await vi.runAllTimersAsync();
            expect(updater).not.toHaveBeenCalled();

            // After the callback, scheduling works again.
            await vi.advanceTimersByTimeAsync(60);
            spacedUpdate.scheduleUpdate();
            await vi.runAllTimersAsync();
            expect(updater).toHaveBeenCalledTimes(1);
        });

        it("re-enables scheduling even when the callback throws", async () => {
            const updater = vi.fn(async () => {});
            const spacedUpdate = new SpacedUpdate(updater, 50);

            await expect(
                spacedUpdate.allowUpdateWithoutChange(async () => {
                    throw new Error("callback failed");
                })
            ).rejects.toThrow("callback failed");

            // changeForbidden was reset in finally -> scheduling works again.
            await vi.advanceTimersByTimeAsync(60);
            spacedUpdate.scheduleUpdate();
            await vi.runAllTimersAsync();
            expect(updater).toHaveBeenCalledTimes(1);
        });
    });
});
