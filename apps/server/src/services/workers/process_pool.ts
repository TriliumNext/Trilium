/**
 * A pool of worker processes that run one job each at a time, off the thread serving the app.
 *
 * Processes rather than worker threads: in the Electron main process a worker thread's garbage
 * collector depends on V8 background tasks that never complete, so allocation-heavy jobs wedge it.
 * A child process collects normally on both runtimes.
 *
 * Nothing here is load-bearing. When no worker can run — no entry file, a spawn that fails, a
 * process that dies before it ever speaks — {@link ProcessPool.run} answers `null` for good, and
 * the caller does the job in its own process. Once any worker has spoken, a later failure fails only
 * the job it was running: redoing that job on the main thread would freeze the app for exactly the
 * input that just proved too much for a worker.
 */

import { availableParallelism, totalmem } from "node:os";

import { getLog } from "@triliumnext/core";

import type { WorkerJob, WorkerMessage, WorkerReply } from "./worker_channel.js";
import { resolveWorkerEntry, spawnWorker, type WorkerHandle, workerEnv } from "./worker_host.js";

export interface ProcessPoolOptions {
    /** Prefix for the pool's log lines, e.g. `Image Compression Tool`. */
    name: string;
    /** Basename of the worker entry, resolved by {@link resolveWorkerEntry}. */
    entry: string;
    /** Where the entry's TypeScript lives when running from sources. */
    sourceDir?: string;
    /** The process name the desktop's spawner shows. Defaults to `Trilium <name>`. */
    serviceName?: string;
    /** The most workers to run at once. Read whenever a worker might be started. */
    maxWorkers: () => number;
    /** The V8 old-space limit of each worker. */
    heapMb: number;
    bootTimeoutMs?: number;
    replyTimeoutMs: number;
    idleShutdownMs: number;
    /** An environment variable that turns on per-job tracing in the log when set. */
    traceEnv?: string;
}

export interface ProcessPool<Req, Res> {
    /** Runs a job in a worker, or answers `null` when there are no workers to run it. */
    run(request: Req): Promise<Res | null>;
    /** Stops the idle workers. Busy ones finish their job. */
    shutdown(): void;
    /** How many jobs can run at once; 1 when there is no worker entry. */
    concurrency(): number;
}

export function createProcessPool<Req, Res>(options: ProcessPoolOptions): ProcessPool<Req, Res> {
    const {
        name,
        heapMb,
        replyTimeoutMs,
        idleShutdownMs,
        bootTimeoutMs = DEFAULT_BOOT_TIMEOUT_MS
    } = options;
    const idle: PooledWorker<Res>[] = [];
    const waiting: ((worker: PooledWorker<Res> | null) => void)[] = [];
    let started = 0;
    let disabled = false;
    // Whether any worker has sent anything back. That proves spawning, the loader and the channel
    // all work here, which separates "give up on workers" from "this job failed".
    let everSpoke = false;
    let lastRequestId = 0;
    let idleTimer: NodeJS.Timeout | undefined;

    const log = (message: string) => getLog().info(`${name}: ${message}`);
    const trace = (message: string) => {
        if (options.traceEnv && process.env[options.traceEnv]) {
            log(message);
        }
    };
    const entry = () => resolveWorkerEntry(options.entry, options.sourceDir);

    function concurrency(): number {
        return entry() ? Math.max(1, options.maxWorkers()) : 1;
    }

    async function run(request: Req): Promise<Res | null> {
        if (!entry()) {
            return disable("no worker entry point was found");
        }

        const worker = await acquire();

        if (!worker) {
            return null;
        }

        let reply: WorkerReply<Res>;

        try {
            reply = await send(worker, request);
        } catch (e: unknown) {
            // A worker that failed to answer may be dead, so it is never handed to the next job.
            retire(worker);

            if (!everSpoke) {
                return disable(`they do not work here (${firstLine(e)})`);
            }

            throw e;
        }

        for (const line of reply.logs ?? []) {
            getLog().info(line);
        }

        release(worker);

        if (reply.error !== undefined) {
            throw new Error(reply.error);
        }

        return reply.result ?? null;
    }

    function shutdown() {
        started -= idle.length;

        for (const pooled of idle) {
            pooled.stopped = true;
            pooled.handle.kill();
        }

        idle.length = 0;
    }

    function scheduleShutdown() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(shutdown, idleShutdownMs);
        idleTimer.unref();
    }

    async function acquire(): Promise<PooledWorker<Res> | null> {
        if (disabled) {
            return null;
        }

        const free = idle.pop();

        if (free) {
            return free;
        }

        if (started < concurrency()) {
            const spawned = spawn();

            if (spawned) {
                started++;
            }

            return spawned;
        }

        // Every queued caller must be answered by release(), retire() or disable(); one that is
        // forgotten waits for the life of the process.
        return new Promise((resolve) => waiting.push(resolve));
    }

    function release(worker: PooledWorker<Res>) {
        const next = waiting.shift();

        if (next) {
            next(worker);

            return;
        }

        idle.push(worker);
        scheduleShutdown();
    }

    function retire(worker: PooledWorker<Res>) {
        started--;
        worker.stopped = true;
        worker.handle.kill();

        const next = waiting.shift();

        if (!next) {
            return;
        }

        // The queued caller is past the point of starting a worker itself, so the replacement is
        // started here. Where no worker has ever spoken, another would only fail the same way.
        const replacement = everSpoke ? spawn() : null;

        if (replacement) {
            started++;
            next(replacement);
        } else {
            next(null);
        }
    }

    function spawn(): PooledWorker<Res> | null {
        const resolved = entry();

        /* v8 ignore next 3 -- run() checks the entry first; kept so this path never throws. */
        if (!resolved) {
            return disable("no worker entry point was found");
        }

        let handle: WorkerHandle;

        try {
            handle = spawnWorker(resolved.file, {
                execArgv: [ ...resolved.execArgv, `--max-old-space-size=${heapMb}` ],
                env: workerEnv(),
                serviceName: options.serviceName ?? `Trilium ${name}`
            });
        } catch (e: unknown) {
            return disable(`they could not be started (${firstLine(e)})`);
        }

        const readiness: { arrived?: () => void; died?: (error: unknown) => void } = {};
        const ready = new Promise<void>((resolve, reject) => {
            readiness.arrived = resolve;
            readiness.died = reject;
        });

        // A worker that dies while idle has nobody awaiting its readiness.
        ready.catch(() => {});

        const pooled: PooledWorker<Res> = { handle, ready };
        const bootTimer = setTimeout(() => {
            log(`worker ${handle.pid} did not come up within ${bootTimeoutMs}ms; giving up on it`);
            readiness.died?.(new Error(`${name} worker did not come up in time.`));
        }, bootTimeoutMs);

        bootTimer.unref();
        log(`starting a worker with a ${heapMb} MB heap from ${resolved.file}`);

        handle.on("message", (raw) => {
            const message = raw as WorkerMessage<Res>;

            clearTimeout(bootTimer);
            everSpoke = true;
            readiness.arrived?.();

            if ("trace" in message) {
                log(message.trace);

                return;
            }

            pooled.pending?.(message);
        });
        handle.on("error", (error) => {
            clearTimeout(bootTimer);
            log(`worker ${handle.pid} errored: ${firstLine(error)}`);
            readiness.died?.(error);
            pooled.failed?.(error);
        });
        handle.on("exit", (code, signal) => {
            clearTimeout(bootTimer);

            const status = code ?? signal ?? "unknown";

            log(pooled.stopped
                ? `worker ${handle.pid} stopped`
                : `worker ${handle.pid} exited unexpectedly with code ${status}`
                    + (pooled.pending ? " while working on a job" : " while idle"));

            const error = new Error(`${name} worker exited with code ${status}.`);

            readiness.died?.(error);
            pooled.failed?.(error);
        });
        handle.unref();

        return pooled;
    }

    function disable(reason: string): null {
        if (!disabled) {
            disabled = true;
            log(`running jobs in this process because ${reason}.`);
        }

        while (waiting.length > 0) {
            waiting.shift()?.(null);
        }

        return null;
    }

    function send(worker: PooledWorker<Res>, request: Req): Promise<WorkerReply<Res>> {
        const job: WorkerJob<Req> = { id: ++lastRequestId, request };
        const sentAt = Date.now();

        trace(`sending job #${job.id} to worker ${worker.handle.pid}`
            + ` — ${started} started, ${idle.length} idle, ${waiting.length} waiting`);

        return new Promise<WorkerReply<Res>>((resolve, reject) => {
            const expiry = setTimeout(() => {
                log(`worker ${worker.handle.pid} did not answer job #${job.id} within `
                    + `${replyTimeoutMs}ms; giving up on it`);
                reject(new WorkerReplyTimeoutError(`${name} worker did not answer in time.`));
            }, replyTimeoutMs);

            worker.pending = (reply) => {
                if (reply.id !== job.id) {
                    return;
                }

                clearTimeout(expiry);
                trace(`worker ${worker.handle.pid} answered job #${job.id}`
                    + ` in ${Date.now() - sentAt}ms`);
                resolve(reply);
            };
            worker.failed = (error) => {
                clearTimeout(expiry);
                reject(error);
            };
            // A forked child only receives messages once its listener is attached, which its
            // announce proves.
            worker.ready.then(
                () => {
                    try {
                        worker.handle.postMessage(job);
                    } catch (e: unknown) {
                        worker.failed?.(e);
                    }
                },
                (error: unknown) => worker.failed?.(error)
            );
        }).finally(() => {
            worker.pending = undefined;
            worker.failed = undefined;
        });
    }

    return { run, shutdown, concurrency };
}

/**
 * How many workers a pool may run, given each one's heap.
 *
 * The desktop app takes a core per worker and leaves one for the main thread, since the person
 * waiting on the job owns the machine. A server may be serving others, so it stops at `serverMax`.
 * Either way the workers' heaps together stay within half the machine's memory, so a small box is
 * answered 1 rather than paging.
 */
export function defaultWorkerCount(heapMb: number, serverMax = 4): number {
    const byMemory = Math.floor(usableMemoryBytes() / 2 / (heapMb * 1024 * 1024));
    const byCores = process.versions.electron !== undefined
        ? availableParallelism() - 1
        : Math.min(availableParallelism(), serverMax);

    return Math.max(1, Math.min(byCores, byMemory));
}

/**
 * The memory this process tree can use: a container's cgroup limit when there is one, else the
 * machine's. `totalmem()` alone reads the host inside a container.
 *
 * `process.constrainedMemory()` answers 0 without a limit, and a value above the machine's memory
 * when the cgroup sets none.
 */
export function usableMemoryBytes(): number {
    const total = totalmem();
    const constrained = process.constrainedMemory();

    return constrained > 0 && constrained < total ? constrained : total;
}

/** The rejection of {@link ProcessPool.run} when a worker took longer than `replyTimeoutMs`. */
export class WorkerReplyTimeoutError extends Error {
    override name = "WorkerReplyTimeoutError";
}

const DEFAULT_BOOT_TIMEOUT_MS = 30 * 1000;

interface PooledWorker<Res> {
    handle: WorkerHandle;
    /** Settles when the worker first speaks, or when it dies or times out trying. */
    ready: Promise<void>;
    /** Set when the pool stopped it, so its exit is not logged as a failure. */
    stopped?: boolean;
    pending?: (reply: WorkerReply<Res>) => void;
    failed?: (error: unknown) => void;
}

function firstLine(error: unknown): string {
    return String(error instanceof Error ? error.message : error).split(/\r?\n/)[0];
}
