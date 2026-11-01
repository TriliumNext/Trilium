/**
 * Runs a fixed list of tasks several at a time, under a ceiling on how much memory they may be
 * holding between them.
 *
 * Written for image compression, where the work is measured in the hundreds of megabytes a decode
 * wants rather than in how long it takes: four decoders each free to allocate a gigabyte is four
 * gigabytes, whatever the machine happens to have. Bounding the *sum* instead of the count lets a
 * photograph run beside a dozen screenshots, and keeps two photographs from running at once.
 *
 * Nothing here knows what a task does or what thread it runs on. That is deliberate — the platform
 * supplies the execution, this decides only what may be in flight, so the same reasoning serves a
 * pool of worker threads and a browser's workers alike.
 */

/** One unit of work, with what running it is expected to cost while it runs. */
export interface BudgetedTask<T> {
    /**
     * Bytes this is expected to want at its peak, or `null` where that cannot be foreseen — an
     * image whose header never gave up its dimensions, say. Unforeseeable is treated as needing
     * everything, so such a task runs on its own rather than beside something it might crowd out.
     */
    cost: number | null;
    /**
     * @param reservation what was set aside for this task: its cost, or the whole budget where that
     *                    was larger or unknown. Worth passing on to whatever enforces a limit
     *                    downstream, so the reservation and the enforcement are the same number.
     */
    run(reservation: number): Promise<T>;
}

export interface BudgetOptions {
    /** The most all running tasks may be holding at once. A single task may reserve all of it. */
    totalBytes: number;
    /** The most tasks that may run at once, whatever the budget would otherwise allow. */
    maxConcurrent: number;
}

/**
 * Runs everything and answers in the order it was given, however the order it ran in worked out.
 *
 * Admission is first-fit from the front: the earliest task whose reservation fits what is left of
 * the budget goes next. A task too large to fit is stepped over rather than waited for, so the
 * cores keep working on whatever does fit — and it goes as soon as enough has been handed back,
 * which on a finite list is a bound rather than a hope.
 *
 * A task larger than the entire budget is not a deadlock. Its reservation is clamped to the whole
 * budget, so it always fits once nothing else is running — which makes progress a property of the
 * arithmetic rather than a case to be handled, and holds however badly a single item was measured.
 *
 * Every task is run to completion even if one of them fails; the first failure is raised once the
 * rest have settled, rather than abandoning work already in flight to an unobserved rejection.
 */
export async function runWithinBudget<T>(tasks: BudgetedTask<T>[], options: BudgetOptions): Promise<T[]> {
    const { totalBytes, maxConcurrent } = options;
    const results = new Array<T>(tasks.length);
    const waiting = tasks.map((task, index) => ({ task, index }));
    const running = new Map<number, Promise<number>>();
    let reserved = 0;
    let failure: unknown;

    // Settled rather than awaited directly: one task failing must not leave the others running with
    // nobody watching, so every outcome is recorded and the first failure raised at the end.
    const start = (task: BudgetedTask<T>, index: number, reservation: number) => {
        reserved += reservation;
        running.set(index, task.run(reservation).then(
            (value) => {
                results[index] = value;
                return index;
            },
            (error: unknown) => {
                failure ??= error;
                return index;
            }
        ).finally(() => {
            reserved -= reservation;
        }) as Promise<number>);
    };

    // At least one at a time, whatever was asked for: a concurrency of none would admit nothing and
    // then wait for it.
    const concurrency = Math.max(1, maxConcurrent);

    while (waiting.length > 0 || running.size > 0) {
        while (waiting.length > 0 && running.size < concurrency) {
            const remaining = totalBytes - reserved;
            const next = waiting.findIndex(({ task }) => reservationFor(task, totalBytes) <= remaining);

            // Nothing fits alongside what is already running; waiting for one of those to finish is
            // what frees the room. It cannot mean nothing will ever fit — with none running the
            // whole budget is free, and no reservation is ever larger than that.
            if (next < 0) {
                break;
            }

            const [ { task, index } ] = waiting.splice(next, 1);
            start(task, index, reservationFor(task, totalBytes));
        }

        // Never awaited empty: reaching here with nothing running means something was just admitted,
        // by the same reasoning.
        running.delete(await Promise.race(running.values()));
    }

    if (failure !== undefined) {
        throw failure;
    }

    return results;
}

/** What a task is set aside, never more than the whole budget — which is what lets anything run. */
function reservationFor<T>(task: BudgetedTask<T>, totalBytes: number): number {
    return Math.min(task.cost ?? totalBytes, totalBytes);
}
