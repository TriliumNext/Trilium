import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import oneTimeTimer from "./one_time_timer.js";

describe("oneTimeTimer", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("scheduleExecution", () => {
        it("runs the callback only after the delay has elapsed", () => {
            const cb = vi.fn();

            oneTimeTimer.scheduleExecution("after-delay", 100, cb);

            vi.advanceTimersByTime(99);
            expect(cb).not.toHaveBeenCalled();

            vi.advanceTimersByTime(1);
            expect(cb).toHaveBeenCalledTimes(1);
        });

        it("ignores subsequent calls with the same name and keeps the first scheduled time", () => {
            const first = vi.fn();
            const second = vi.fn();

            oneTimeTimer.scheduleExecution("same-name", 100, first);
            // A later call must not move the timer to the future nor replace the callback.
            oneTimeTimer.scheduleExecution("same-name", 1000, second);

            vi.advanceTimersByTime(100);

            expect(first).toHaveBeenCalledTimes(1);
            expect(second).not.toHaveBeenCalled();
        });

        it("frees the name after execution so it can be scheduled again", () => {
            const first = vi.fn();
            const second = vi.fn();

            oneTimeTimer.scheduleExecution("reusable", 100, first);
            vi.advanceTimersByTime(100);
            expect(first).toHaveBeenCalledTimes(1);

            // After the first execution the slot is released, so a new schedule is honored.
            oneTimeTimer.scheduleExecution("reusable", 100, second);
            vi.advanceTimersByTime(100);
            expect(second).toHaveBeenCalledTimes(1);
        });

        it("schedules independent timers for different names", () => {
            const cbA = vi.fn();
            const cbB = vi.fn();

            oneTimeTimer.scheduleExecution("name-a", 100, cbA);
            oneTimeTimer.scheduleExecution("name-b", 200, cbB);

            vi.advanceTimersByTime(100);
            expect(cbA).toHaveBeenCalledTimes(1);
            expect(cbB).not.toHaveBeenCalled();

            vi.advanceTimersByTime(100);
            expect(cbB).toHaveBeenCalledTimes(1);
        });

        it("contains a throwing callback and frees the name for rescheduling", () => {
            const boom = vi.fn(() => {
                throw new Error("callback failure");
            });
            const next = vi.fn();

            oneTimeTimer.scheduleExecution("throwing", 100, boom);

            // The throw must not escape the timer callback — an uncaught exception here
            // would crash the whole process (#10549).
            expect(() => vi.advanceTimersByTime(100)).not.toThrow();
            expect(boom).toHaveBeenCalledTimes(1);

            // The failure still releases the slot so the task can run again later.
            oneTimeTimer.scheduleExecution("throwing", 100, next);
            vi.advanceTimersByTime(100);
            expect(next).toHaveBeenCalledTimes(1);
        });

        it("allows re-scheduling the same name from within the callback", () => {
            const inner = vi.fn();
            const outer = vi.fn(() => {
                // The slot is freed before the callback runs, so this re-schedule takes effect.
                oneTimeTimer.scheduleExecution("self-reschedule", 50, inner);
            });

            oneTimeTimer.scheduleExecution("self-reschedule", 50, outer);

            vi.advanceTimersByTime(50);
            expect(outer).toHaveBeenCalledTimes(1);
            expect(inner).not.toHaveBeenCalled();

            vi.advanceTimersByTime(50);
            expect(inner).toHaveBeenCalledTimes(1);
        });
    });
});
