import { describe, expect, it } from "vitest";

import Mutex from "./mutex";

describe("Mutex", () => {
    it("runExclusively returns the callback's resolved value", async () => {
        const mutex = new Mutex();
        const result = await mutex.runExclusively(async () => 42);
        expect(result).toBe(42);
    });

    it("serializes overlapping runExclusively calls in order", async () => {
        const mutex = new Mutex();
        const events: string[] = [];

        let releaseFirst: () => void = () => {};
        const allowFirstToFinish = new Promise<void>((resolve) => (releaseFirst = resolve));

        let signalFirstStarted: () => void = () => {};
        const firstStarted = new Promise<void>((resolve) => (signalFirstStarted = resolve));

        const first = mutex.runExclusively(async () => {
            events.push("first-start");
            signalFirstStarted();
            // Hold the lock until the test allows it to finish.
            await allowFirstToFinish;
            events.push("first-end");
        });

        const second = mutex.runExclusively(async () => {
            events.push("second-start");
            events.push("second-end");
        });

        // The first has the lock; the second must be waiting behind it.
        await firstStarted;
        expect(events).toEqual(["first-start"]);

        releaseFirst();
        await Promise.all([first, second]);

        expect(events).toEqual(["first-start", "first-end", "second-start", "second-end"]);
    });

    it("releases the lock even when the callback throws", async () => {
        const mutex = new Mutex();

        await expect(
            mutex.runExclusively(async () => {
                throw new Error("boom");
            })
        ).rejects.toThrow("boom");

        // The mutex must have released, so a subsequent call proceeds normally.
        const result = await mutex.runExclusively(async () => "recovered");
        expect(result).toBe("recovered");
    });

    it("lock() resolves to an unlock function that gates the next lock", async () => {
        const mutex = new Mutex();

        const unlockFirst = await mutex.lock();
        let secondAcquired = false;
        const secondLock = mutex.lock().then((unlock) => {
            secondAcquired = true;
            return unlock;
        });

        await Promise.resolve();
        expect(secondAcquired).toBe(false);

        unlockFirst();
        const unlockSecond = await secondLock;
        expect(secondAcquired).toBe(true);
        unlockSecond();
    });
});
