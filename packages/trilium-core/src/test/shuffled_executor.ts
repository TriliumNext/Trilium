import type { ContentJobExecutor } from "../services/content_jobs/executor.js";
import { type ContentJob, runContentJob } from "../services/content_jobs/jobs.js";

/**
 * An executor that answers every job after a seeded pseudo-random delay, so that jobs started in
 * one order finish in another. Jobs and results pass through `structuredClone()`, as they do across
 * the worker process boundary. With `delays: false` it answers in-process without a delay, which
 * still records how many jobs overlap.
 */
export function shuffledExecutor(
    { concurrency, delays = true }: { concurrency?: number; delays?: boolean } = {}
) {
    let seed = 42;
    const nextDelay = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % 5;
    };
    const calls: ContentJob[] = [];
    /** Job indexes (positions in `calls`) in the order the jobs finished. */
    const finished: number[] = [];
    let inFlight = 0;
    const executor = {
        concurrency,
        calls,
        finished,
        maxInFlight: 0,
        async run<J extends ContentJob>(job: J) {
            const id = calls.length;
            calls.push(job);
            inFlight++;
            executor.maxInFlight = Math.max(executor.maxInFlight, inFlight);
            try {
                if (delays) {
                    await new Promise((resolve) => setTimeout(resolve, nextDelay()));
                }
                return structuredClone(await runContentJob(structuredClone(job)));
            } finally {
                inFlight--;
                finished.push(id);
            }
        }
    };
    return executor satisfies ContentJobExecutor;
}
