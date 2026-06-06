import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Debouncer from "./debouncer";

describe("Debouncer", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("fires the callback with the value once the interval elapses", () => {
        const callback = vi.fn();
        const debouncer = new Debouncer<string>(100, callback);

        debouncer.updateValue("hello");
        expect(callback).not.toHaveBeenCalled();

        vi.advanceTimersByTime(99);
        expect(callback).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith("hello");
    });

    it("collapses rapid successive updates into a single call with the last value", () => {
        const callback = vi.fn();
        const debouncer = new Debouncer<string>(100, callback);

        // The second and third updates hit the clearTimeout branch (timeoutId !== null).
        debouncer.updateValue("first");
        vi.advanceTimersByTime(50);
        debouncer.updateValue("second");
        vi.advanceTimersByTime(50);
        debouncer.updateValue("third");

        vi.advanceTimersByTime(100);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith("third");
    });

    it("destroy() flushes a pending update immediately", () => {
        const callback = vi.fn();
        const debouncer = new Debouncer<string>(100, callback);

        debouncer.updateValue("pending");
        expect(callback).not.toHaveBeenCalled();

        debouncer.destroy();
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith("pending");

        // The pending timer was cleared, so no further call fires.
        vi.advanceTimersByTime(200);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it("destroy() with no pending update does nothing (timeoutId === null)", () => {
        const callback = vi.fn();
        const debouncer = new Debouncer<string>(100, callback);

        // Never scheduled anything, and after a flush the next destroy is a no-op too.
        debouncer.destroy();
        expect(callback).not.toHaveBeenCalled();

        debouncer.updateValue("x");
        vi.advanceTimersByTime(100);
        expect(callback).toHaveBeenCalledTimes(1);

        // timeoutId is still set after a natural fire (it is not reset to null), but the
        // flushed value remains "x"; a second destroy flushes the same last value again.
        debouncer.destroy();
        expect(callback).toHaveBeenCalledTimes(2);
        expect(callback).toHaveBeenLastCalledWith("x");
    });
});
