/**
 * The worker side of the content-job pool: converts Markdown, HTML, ENEX and office documents one
 * job at a time, off the process that has to keep answering requests.
 *
 * It imports core's content-job dispatcher by its sub-path, never the core barrel, so the bundle
 * holds the converters and none of becca, SQL or options. Everything a job reads from the database
 * arrives in the job's `env`.
 */

import {
    type ContentJob,
    type ContentJobResults,
    runContentJob
} from "@triliumnext/core/src/services/content_jobs/jobs.js";

import { serveJobs } from "./worker_channel.js";

/**
 * A job's answer. A conversion that throws comes back as `error` rather than as a failed reply, so
 * the parent can tell a job that failed from a worker that died.
 */
export type ContentJobOutcome =
    | { result: ContentJobResults[keyof ContentJobResults] }
    | { error: string };

/* v8 ignore start -- runs only inside a worker process, where the harness does not follow. */
serveJobs<ContentJob, ContentJobOutcome>(
    { name: "content job worker", traceEnv: "TRILIUM_CONTENT_JOB_WORKER_DEBUG" },
    runJob
);

async function runJob(job: ContentJob): Promise<ContentJobOutcome> {
    try {
        return { result: await runContentJob(job) };
    } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}
/* v8 ignore stop */
