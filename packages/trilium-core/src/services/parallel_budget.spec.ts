import { describe, expect, it } from "vitest";

import { type BudgetedTask, runWithinBudget } from "./parallel_budget";

const MB = 1024 * 1024;

/**
 * A task that records when it starts and stops, and finishes only when told to. Nothing here waits
 * on a timer: the schedule is driven by resolving these by hand, so what the tests assert is the
 * order the scheduler chose rather than one a delay happened to produce.
 */
function task(name: string, cost: number | null, log: string[]) {
    let release = () => {};
    const finished = new Promise<void>((resolve) => { release = resolve; });

    const entry: BudgetedTask<string> & { release: () => void; reservation?: number } = {
        cost,
        async run(reservation: number) {
            entry.reservation = reservation;
            log.push(`start ${name}`);
            await finished;
            log.push(`end ${name}`);

            return name;
        },
        release
    };

    return entry;
}

/** Lets every microtask settle, so anything the scheduler was free to start has started. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("runWithinBudget", () => {
    it("runs what fits at once and answers in the order it was given", async () => {
        const log: string[] = [];
        const tasks = [ task("a", 100 * MB, log), task("b", 100 * MB, log), task("c", 100 * MB, log) ];

        const run = runWithinBudget(tasks, { totalBytes: 300 * MB, maxConcurrent: 4 });
        await settle();

        expect(log).toEqual([ "start a", "start b", "start c" ]);

        // Finished out of order on purpose: the answer follows the list, not the finishing.
        tasks[2].release();
        tasks[0].release();
        tasks[1].release();
        await expect(run).resolves.toEqual([ "a", "b", "c" ]);
    });

    it("holds a task back until the budget it needs has been handed back", async () => {
        const log: string[] = [];
        const tasks = [ task("first", 700 * MB, log), task("second", 700 * MB, log) ];

        const run = runWithinBudget(tasks, { totalBytes: 1024 * MB, maxConcurrent: 4 });
        await settle();

        // Two of these would be 1400 MB against a 1024 MB ceiling, so the second waits — which is
        // the whole point: the cap is on what is held at once, not on how many are held.
        expect(log).toEqual([ "start first" ]);

        tasks[0].release();
        await settle();
        expect(log).toEqual([ "start first", "end first", "start second" ]);

        tasks[1].release();
        await run;
    });

    it("steps over a task too large to fit and keeps the smaller ones behind it moving", async () => {
        const log: string[] = [];
        // The second photograph is what makes this a test: it sits at the front of the queue and
        // cannot fit beside the first, so taking the queue strictly in order would idle every core
        // but one. The screenshot behind it fits in what is left and must be reached.
        const tasks = [
            task("photo-1", 900 * MB, log),
            task("photo-2", 900 * MB, log),
            task("shot", 30 * MB, log)
        ];

        const run = runWithinBudget(tasks, { totalBytes: 1024 * MB, maxConcurrent: 4 });
        await settle();

        expect(log).toEqual([ "start photo-1", "start shot" ]);

        // And the one that was stepped over goes as soon as the room it needed comes back.
        tasks[0].release();
        await settle();
        expect(log).toContain("start photo-2");

        tasks[1].release();
        tasks[2].release();
        await expect(run).resolves.toEqual([ "photo-1", "photo-2", "shot" ]);
    });

    it("admits a queued task the moment enough has been handed back, without waiting for the rest", async () => {
        const log: string[] = [];
        const tasks = [ task("big", 800 * MB, log), task("small", 100 * MB, log), task("mid", 500 * MB, log) ];

        const run = runWithinBudget(tasks, { totalBytes: 1024 * MB, maxConcurrent: 4 });
        await settle();
        expect(log).toEqual([ "start big", "start small" ]);

        // 800 back leaves room for the 500 that would not fit before, while the 100 runs on.
        tasks[0].release();
        await settle();
        expect(log).toEqual([ "start big", "start small", "end big", "start mid" ]);

        tasks[1].release();
        tasks[2].release();
        await run;
    });

    it("runs a task larger than the whole budget on its own rather than deadlocking", async () => {
        const log: string[] = [];
        const tasks = [ task("enormous", 4096 * MB, log), task("after", 10 * MB, log) ];

        const run = runWithinBudget(tasks, { totalBytes: 1024 * MB, maxConcurrent: 4 });
        await settle();

        // It cannot fit and never will, so it goes alone with the whole budget set aside for it —
        // and is told so, which is what the decoder downstream is given as its own ceiling.
        expect(log).toEqual([ "start enormous" ]);
        expect(tasks[0].reservation).toBe(1024 * MB);

        tasks[0].release();
        await settle();
        expect(log).toContain("start after");

        tasks[1].release();
        await expect(run).resolves.toEqual([ "enormous", "after" ]);
    });

    it("treats an unforeseeable cost as needing everything, so it never runs beside anything", async () => {
        const log: string[] = [];
        const tasks = [ task("unknown", null, log), task("known", 10 * MB, log) ];

        const run = runWithinBudget(tasks, { totalBytes: 1024 * MB, maxConcurrent: 4 });
        await settle();

        expect(log).toEqual([ "start unknown" ]);
        expect(tasks[0].reservation).toBe(1024 * MB);

        tasks.forEach((entry) => entry.release());
        await run;
    });

    it("never runs more at once than it was allowed, however small they are", async () => {
        const log: string[] = [];
        const tasks = Array.from({ length: 5 }, (_unused, index) => task(`t${index}`, MB, log));

        const run = runWithinBudget(tasks, { totalBytes: 1024 * MB, maxConcurrent: 2 });
        await settle();

        expect(log).toEqual([ "start t0", "start t1" ]);

        tasks.forEach((entry) => entry.release());
        await expect(run).resolves.toHaveLength(5);
    });

    it("lets the rest finish when one fails, and raises the failure once they have", async () => {
        const log: string[] = [];
        const failing: BudgetedTask<string> = { cost: MB, run: async () => { throw new Error("decode failed"); } };
        const survivor = task("survivor", MB, log);

        const run = runWithinBudget([ failing, survivor ], { totalBytes: 1024 * MB, maxConcurrent: 2 });
        await settle();

        // The failure has already happened, but the task beside it is still running and is left to
        // finish — abandoning it would leave a worker's result with nobody to receive it.
        expect(log).toEqual([ "start survivor" ]);

        survivor.release();
        await expect(run).rejects.toThrow("decode failed");
        expect(log).toEqual([ "start survivor", "end survivor" ]);
    });

    it("hands the reservation to the task, and frees it again for the next one", async () => {
        const log: string[] = [];
        const tasks = [ task("one", 600 * MB, log), task("two", 600 * MB, log) ];

        const run = runWithinBudget(tasks, { totalBytes: 1024 * MB, maxConcurrent: 4 });
        await settle();
        expect(tasks[0].reservation).toBe(600 * MB);

        // Freed on completion rather than held to the end of the run, or the second would never go.
        tasks[0].release();
        await settle();
        expect(tasks[1].reservation).toBe(600 * MB);

        tasks[1].release();
        await run;
    });

    it("answers an empty list without running anything", async () => {
        await expect(runWithinBudget([], { totalBytes: 1024 * MB, maxConcurrent: 4 })).resolves.toEqual([]);
    });
});
