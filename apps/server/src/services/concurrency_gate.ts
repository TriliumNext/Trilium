/**
 * Lets a fixed number of pieces of work run at once, and queues the rest.
 *
 * For work that arrives rather than work that is scheduled. A caller with a list in hand can decide
 * how much of it to start — that is what the compression tool's budget does — but images arriving on
 * their way into the database come one call at a time from callers that know nothing of each other,
 * and an import of a thousand notes hands over a thousand of them at once. Something has to say how
 * many of those are acted on at a time, and this is it.
 *
 * The limit is read at each admission rather than fixed at construction, so a gate follows whatever
 * its owner currently answers.
 */
export interface ConcurrencyGate {
    /** Runs `work` once there is room for it, and gives up its place however `work` ends. */
    run<T>(work: () => Promise<T>): Promise<T>;
    /** How many are running right now. For tests and for anything that reports on itself. */
    running(): number;
}

export function createConcurrencyGate(limit: () => number): ConcurrencyGate {
    let running = 0;
    const waiting: (() => void)[] = [];

    /**
     * The place is handed from one holder to the next rather than given up and taken again: with a
     * count to decrement and re-increment, two callers released in the same turn can both see room
     * and both take it. Passing the place itself means there is never a moment where it is free and
     * unclaimed, so the count is exactly the number running whoever is looking.
     */
    function leave() {
        const next = waiting.shift();

        if (next) {
            next();
        } else {
            running--;
        }
    }

    async function enter() {
        if (running < Math.max(limit(), 1)) {
            running++;

            return;
        }

        await new Promise<void>((resolve) => waiting.push(resolve));
    }

    return {
        running: () => running,
        async run<T>(work: () => Promise<T>): Promise<T> {
            await enter();

            try {
                return await work();
            } finally {
                // However it ended. Work that throws still has to give up its place, or a gate
                // closes a little further with every failure until nothing gets through at all.
                leave();
            }
        }
    };
}
