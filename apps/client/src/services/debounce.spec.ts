import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import debounce from "./debounce.js";

// The source types the returned function with no declared params (it forwards `arguments`),
// so widen it to a variadic callable for the tests.
type Debounced = ((...args: any[]) => any) & { clear(): void; flush(): void };

describe("debounce", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("defers a trailing call until the wait elapses after the last invocation", () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100) as Debounced;

        debounced("a");
        // Re-invoking before the wait elapses keeps deferring (reschedule branch in `later`).
        vi.advanceTimersByTime(60);
        debounced("b");
        vi.advanceTimersByTime(60);
        expect(fn).not.toHaveBeenCalled();

        // Now let the full wait elapse from the last invocation.
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith("b");
    });

    it("preserves `this` context and returns the previous trailing result", () => {
        const ctx = { value: 42 };
        const fn = vi.fn(function (this: typeof ctx, n: number) {
            return this.value + n;
        });
        const debounced = debounce(fn, 100) as Debounced;

        // First trailing invocation: nothing computed yet, returns undefined.
        expect(debounced.call(ctx, 1)).toBeUndefined();
        vi.advanceTimersByTime(100);
        expect(fn).toHaveLastReturnedWith(43);
        expect(fn.mock.contexts[0]).toBe(ctx);

        // Subsequent invocation returns the previously stored result.
        expect(debounced.call(ctx, 10)).toBe(43);
        vi.advanceTimersByTime(100);
        expect(fn).toHaveLastReturnedWith(52);
    });

    it("invokes on the leading edge when `immediate` is true and does not re-fire on trailing", () => {
        const fn = vi.fn((x: string) => x.toUpperCase());
        const debounced = debounce(fn, 100, true) as Debounced;

        // Leading call fires synchronously (callNow branch) and returns the result.
        expect(debounced("hi")).toBe("HI");
        expect(fn).toHaveBeenCalledTimes(1);

        // While the timer is pending, further calls do not fire (callNow=false because timeout set).
        debounced("again");
        expect(fn).toHaveBeenCalledTimes(1);

        // Trailing `later` clears the timeout but does NOT call func because immediate is true.
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(1);

        // After the timer cleared, a new call fires on the leading edge again.
        expect(debounced("third")).toBe("THIRD");
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it("defaults the wait to 100ms when called with a nullish wait", () => {
        const fn = vi.fn();
        // Force the `null == waitMs` branch (the type says number, but runtime guards null/undefined).
        const debounced = debounce(fn, null as unknown as number) as Debounced;

        debounced();
        vi.advanceTimersByTime(99);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("clear() cancels a pending trailing call and is a no-op when nothing is pending", () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100) as Debounced;

        debounced();
        debounced.clear();
        vi.advanceTimersByTime(100);
        expect(fn).not.toHaveBeenCalled();

        // No pending timer -> clear() takes the falsy branch and does nothing.
        expect(() => debounced.clear()).not.toThrow();
        expect(fn).not.toHaveBeenCalled();
    });

    it("flush() invokes immediately with the latest args and is a no-op when nothing is pending", () => {
        const fn = vi.fn((x: number) => x * 2);
        const debounced = debounce(fn, 100) as Debounced;

        debounced(5);
        expect(debounced.flush()).toBeUndefined(); // flush returns nothing
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith(5);

        // Timer was cleared by flush, so advancing does not re-fire.
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(1);

        // Nothing pending -> flush() falsy branch, no-op.
        debounced.flush();
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("flush() does not re-fire after a leading-edge call when `immediate` is true", () => {
        const fn = vi.fn((x: string) => x.toUpperCase());
        const debounced = debounce(fn, 100, true) as Debounced;

        // Leading-edge call fires once and nulls `args` while the trailing timer stays live.
        expect(debounced("hi")).toBe("HI");
        expect(fn).toHaveBeenCalledTimes(1);

        // Flushing now must NOT re-invoke func: there is no pending trailing call,
        // and it must never call func with an empty arg list.
        debounced.flush();
        expect(fn).toHaveBeenCalledTimes(1);

        // The pending trailing timer was cleared by flush, so advancing does nothing.
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("reschedules in `later` when the system clock jumps backwards (last < 0)", () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100) as Debounced;

        const nowSpy = vi.spyOn(Date, "now");
        // timestamp recorded at invocation time = 1000.
        nowSpy.mockReturnValue(1000);
        debounced("x");

        // When `later` runs, Date.now() returns an earlier value -> last = -500 (< 0),
        // which fails the `last >= 0` check, so func still fires (else branch).
        nowSpy.mockReturnValue(500);
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith("x");

        nowSpy.mockRestore();
    });

    it("exposes itself as `.debounce` for ES module interop", () => {
        expect(debounce.debounce).toBe(debounce);
    });
});
