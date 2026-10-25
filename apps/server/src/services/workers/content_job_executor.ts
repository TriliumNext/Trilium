/**
 * Runs core's content jobs (Markdown and HTML conversion, sanitizing, ENEX bodies, office previews)
 * in a pool of worker processes, on the server and the desktop app.
 *
 * {@link createProcessPool} answers `null` when this installation cannot run workers at all; the
 * job then runs in this process, as it does in the standalone build.
 */

import { getLog } from "@triliumnext/core";
import type { ContentJobExecutor } from "@triliumnext/core/src/services/content_jobs/executor.js";
import {
    type ContentJob,
    type ContentJobResult,
    runContentJob
} from "@triliumnext/core/src/services/content_jobs/jobs.js";

import type { ContentJobOutcome } from "./content_job_worker.js";
import {
    createProcessPool,
    defaultWorkerCount,
    type ProcessPool,
    WorkerReplyTimeoutError
} from "./process_pool.js";

export interface PooledContentJobExecutor extends ContentJobExecutor {
    readonly concurrency: number;
    /** Stops the idle workers. */
    shutdown(): void;
}

/**
 * Inputs shorter than this, in characters, convert in this process: below it a sanitize costs the
 * main thread about as much as the worker round trip does, and the round trip adds latency.
 */
export const IN_PROCESS_MAX_CHARS = 1024;

/**
 * Creates the executor. No worker starts until the first job large enough to need one.
 *
 * A job that throws in a worker rejects here with the same message, because it would throw in this
 * process too. A worker that crashes mid-job has the job retried once in a fresh worker, never in
 * this process: the input that exhausted a worker's heap would freeze or exhaust this one. A job
 * that outlives the reply timeout is not retried.
 */
export function createPooledContentJobExecutor(
    { inProcessMaxChars = IN_PROCESS_MAX_CHARS }: { inProcessMaxChars?: number } = {}
): PooledContentJobExecutor {
    const pool = createProcessPool<ContentJob, ContentJobOutcome>({
        name: "Content Jobs",
        entry: "content_job_worker",
        sourceDir: __dirname,
        serviceName: "Trilium content job worker",
        maxWorkers: () => defaultWorkerCount(WORKER_HEAP_MB),
        heapMb: WORKER_HEAP_MB,
        replyTimeoutMs: 5 * 60 * 1000,
        idleShutdownMs: 30 * 1000,
        traceEnv: "TRILIUM_CONTENT_JOB_WORKER_DEBUG"
    });

    return {
        get concurrency() {
            return pool.concurrency();
        },
        run: (job) => runPooled(pool, job, inProcessMaxChars),
        shutdown: () => pool.shutdown()
    };
}

const WORKER_HEAP_MB = 1024;

async function runPooled<J extends ContentJob>(
    pool: ProcessPool<ContentJob, ContentJobOutcome>,
    job: J,
    inProcessMaxChars: number
): Promise<ContentJobResult<J>> {
    if (jobSize(job) < inProcessMaxChars) {
        return runContentJob(job);
    }

    let outcome: ContentJobOutcome | null;

    try {
        outcome = await pool.run(job);
    } catch (e: unknown) {
        if (e instanceof WorkerReplyTimeoutError) {
            throw e;
        }

        outcome = await retryInWorker(pool, job, e);
    }

    if (!outcome) {
        return runContentJob(job);
    }

    if ("error" in outcome) {
        throw new Error(outcome.error);
    }

    return outcome.result as ContentJobResult<J>;
}

/** Runs a job whose worker crashed in a fresh worker, and rejects if that one fails too. */
async function retryInWorker(
    pool: ProcessPool<ContentJob, ContentJobOutcome>,
    job: ContentJob,
    crash: unknown
): Promise<ContentJobOutcome> {
    getLog().info(`Content Jobs: a worker failed on a ${job.kind} job (${describe(crash)}); `
        + "retrying it in a fresh worker.");

    let outcome: ContentJobOutcome | null;

    try {
        outcome = await pool.run(job);
    } catch (e: unknown) {
        if (e instanceof WorkerReplyTimeoutError) {
            throw e;
        }

        getLog().info(`Content Jobs: the retried ${job.kind} job failed too (${describe(e)}).`);

        throw new Error("Content conversion crashed the worker twice.");
    }

    if (!outcome) {
        throw new Error(
            "Content conversion crashed its worker, and no worker could be started to retry it."
        );
    }

    return outcome;
}

/** The size of a job's main input, in characters; an office document always goes to a worker. */
function jobSize(job: ContentJob): number {
    switch (job.kind) {
        case "markdownToHtml":
            return job.markdown.length;
        case "htmlToMarkdown":
        case "prettyPrintHtml":
        case "sanitizeHtml":
            return job.html.length;
        case "enexNoteContent":
            return job.content.length;
        case "prepareNoteText":
            return job.input.content.length;
        case "officeToHtml":
            return Number.POSITIVE_INFINITY;
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
