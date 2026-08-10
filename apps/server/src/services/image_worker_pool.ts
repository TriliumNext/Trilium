/**
 * A small pool of worker processes that compress images, so the decoding stops holding the thread
 * that serves the application.
 *
 * Decoding is synchronous from beginning to end — jpeg-js, pngjs and UPNG all run to completion
 * without yielding — so an image being compressed on the main thread is an application that has
 * stopped answering for as long as it takes. Moving that off-thread is worth more than the extra
 * cores it also buys.
 *
 * Processes rather than worker threads, which were tried first and cannot be used: in the Electron
 * main process a worker thread's isolate wedges on this workload. Its garbage collector hands
 * sweeping to V8 background tasks that never complete there, so the hundreds of megabytes a decode
 * allocates are never truly reclaimed — a forced full collection returns without them, and a second
 * one never returns at all. The first image per thread works, the next waits on that sweep forever;
 * in between sit runs that crawl, seconds of collector stall per image. A forked child is a main
 * isolate on Node's own platform, where collection simply works — under the plain server, which
 * never had the problem, and under Electron, which fork serves by re-running its binary as Node.
 *
 * Nothing here is load-bearing. Every way this can fail — a worker file that is not where it was
 * expected, a process that will not start, one that dies mid-image — ends in the same place: the
 * caller is told so once and compresses in this process instead, exactly as it always did.
 *
 * This is the Node half of the platform, reached only through the server's own image provider —
 * the server itself and the desktop app, whose main process is Node too. The standalone build has
 * no decoder to run in a thread and never arrives here; it answers for itself.
 */

import { type ChildProcess, fork } from "node:child_process";
import { existsSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { join } from "node:path";

import { getLog } from "@triliumnext/core";
import type { ImageCompressionOutcome, ImageCompressionRequest } from "@triliumnext/core/src/services/image_provider.js";

import type { ImageWorkerRequest, ImageWorkerResponse, ImageWorkerTrace } from "./image_worker.js";

/**
 * How many images may be compressed at once, or 1 where they cannot be compressed off-thread at
 * all — which is the same answer as "do it here", and is what the caller schedules against.
 *
 * How much of the machine to take depends on whose machine it is.
 *
 * The desktop app runs on one person's computer, doing a job that person just asked for and is
 * waiting on, so it takes a core per worker and leaves one for the thread handing out the images —
 * which is also the thread the window is answering on. A server is not anyone's computer in that
 * sense: it may be serving other people while this runs, and a maintenance job nobody is watching
 * has no business taking the whole of it, so it stays with a handful.
 *
 * A ceiling rather than a promise either way: what actually runs at once is whatever the memory
 * budget admits, which on large images is far fewer. Worth knowing that decoding is bound by memory
 * bandwidth as much as by processor, so the last threads on a wide machine are worth much less than
 * the first — this is what the machine allows, not what it will reward.
 *
 * `availableParallelism` rather than the raw core count: it follows the affinity the process was
 * given, so a container pinned to two cores is answered as two.
 *
 * Bounded by memory besides. Each worker may grow a {@link WORKER_HEAP_MB} heap, and their sum is
 * kept inside half of what the machine has — a four-gigabyte NAS is answered 1, not 4, because the
 * failure past that bound is not the compression slowing down but the machine paging, which stops
 * everything on it. Coarse on purpose: in a container `totalmem` reads the host rather than the
 * cgroup, so this guards the obvious overcommit rather than accounting for what is genuinely free.
 */
export function compressionConcurrency(): number {
    if (!workerEntry()) {
        return 1;
    }

    const byMemory = Math.floor(totalmem() / 2 / (WORKER_HEAP_MB * 1024 * 1024));
    const byCores = isDesktopApp()
        ? availableParallelism() - 1
        : Math.min(availableParallelism(), SERVER_MAX_WORKERS);

    return Math.max(1, Math.min(byCores, byMemory));
}

/** What a shared machine is allowed to spend on a job nobody is waiting for. */
const SERVER_MAX_WORKERS = 4;

/**
 * Whether this is the desktop app rather than a server.
 *
 * Read from the runtime rather than from core's platform flags: those are settled during startup,
 * and this is asked for whenever a run begins.
 */
function isDesktopApp(): boolean {
    return process.versions.electron !== undefined;
}


/**
 * Compresses one image in a worker, or answers `null` if there is no worker to do it in — which the
 * caller reads as "then do it yourself" rather than as a failure of the image.
 *
 * @param budgetMb the most this decode may allocate, which the caller has already set aside for it.
 */
export async function compressInWorker(
    buffer: Uint8Array,
    request: ImageCompressionRequest,
    budgetMb: number
): Promise<ImageCompressionOutcome | null> {
    if (!workerEntry()) {
        return disable("no worker entry point was found");
    }

    const worker = await acquire();

    if (!worker) {
        return null;
    }

    try {
        const response = await send(worker, buffer, request, budgetMb);

        // The worker's own logging, written here because here is where a logger exists.
        response.logs.forEach((line) => getLog().info(line));

        if (response.error) {
            throw new Error(response.error);
        }

        release(worker);

        return response.outcome ?? null;
    } catch (e: unknown) {
        // Retired rather than released: a process that failed us may well be dead, and handing it to
        // the next image would post a message nothing is listening for — which looks like the run
        // hanging rather than like one image having failed.
        retire(worker);

        // No worker has ever so much as announced itself, so this is not one process having died
        // but this installation being unable to run them — an environment whose loader cannot read
        // the entry point, say. Answered as "there are no workers", which is the truth of it: this
        // image and every one after it is compressed by the caller, exactly as before there were
        // workers.
        if (!everSpoke) {
            return disable(`they do not work here (${firstLine(e)})`);
        }

        // Workers run here — one announced itself, which took spawning, the loader and the channel
        // all working — so this failure belongs to the image: a decode that blew through the heap,
        // say, taking its worker with it. Raised rather than answered with a fallback, and
        // emphatically not treated as the installation being broken: decoding this image on the
        // calling thread would stop the application for the length of a decode — the very freeze
        // the pool exists to prevent, handed to exactly the image that just proved too much for a
        // worker. The image is reported untouched and the run goes on.
        throw e;
    }
}

/**
 * Stops the workers that are not doing anything, so a Trilium that has finished compressing is not
 * still holding them.
 *
 * An idle child is still a process, holding its runtime and whatever its last decode grew it to.
 * Several of them sitting on that is memory the rest of the machine would rather have, and
 * terminating them gives it back outright.
 *
 * Only the free ones: a busy worker is not in the pool to be found here, and is left to finish.
 */
export function shutdownImageWorkers() {
    started -= idle.length;
    idle.forEach((pooled) => {
        pooled.stopped = true;
        pooled.worker.kill();
    });
    idle.length = 0;
}

/**
 * How long the pool waits, having been given nothing to do, before letting its workers go.
 *
 * Long enough that the images of one run do not pay to start a process each, short enough that a
 * run which has finished stops costing anything soon after. Nothing schedules a run, so any wait at
 * all is only ever bridging the gap between two images.
 */
const IDLE_SHUTDOWN_MS = 30 * 1000;

let idleTimer: NodeJS.Timeout | undefined;

/** Restarted whenever a worker comes free, so the countdown only ever runs on a quiet pool. */
function scheduleShutdown() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(shutdownImageWorkers, IDLE_SHUTDOWN_MS);
    // Never a reason for this to be what holds the process open.
    idleTimer.unref();
}

interface PooledWorker {
    worker: ChildProcess;
    /** Missing exactly when the spawn failed, in which case its error event is on the way. */
    pid: number | undefined;
    /**
     * Settled when the child first speaks, or when it dies trying. Waited out before sending:
     * unlike a thread's queue, a process's channel does not hold messages for a listener that has
     * not attached yet, and the child only listens once its module has loaded.
     */
    ready: Promise<void>;
    /** Set when we stopped it ourselves, so its exit is not reported as something going wrong. */
    stopped?: boolean;
    pending?: (response: ImageWorkerResponse) => void;
    failed?: (error: unknown) => void;
}

const idle: PooledWorker[] = [];
const waiting: ((worker: PooledWorker | null) => void)[] = [];
let started = 0;
let disabled = false;
/**
 * Whether any worker has ever sent anything back — its startup announce being the first thing one
 * says. That is proof the installation can run workers at all, which is the line between "give up
 * on workers for good" and "this one image failed": everything a worker needs to exist — spawning,
 * the loader, the channel home — has demonstrably worked once.
 */
let everSpoke = false;

async function acquire(): Promise<PooledWorker | null> {
    if (disabled) {
        return null;
    }

    const free = idle.pop();

    if (free) {
        return free;
    }

    if (started < compressionConcurrency()) {
        const spawned = spawn();

        if (spawned) {
            started++;

            return spawned;
        }

        return null;
    }

    // Every worker is busy, so this one queues for the next to come free. That queue is ordinary
    // and can be deep: images arriving into the database are handed over one call at a time by
    // callers that know nothing of each other, and an import produces hundreds at once.
    //
    // Which makes it the pool's business to answer every caller in it. Whoever waits here is past
    // the point where they could have started a worker for themselves, so from here they are
    // answered by `release`, by `retire`, or by `disable` — and if any of those three forgets
    // them, they wait for the life of the process. An image whose compression never comes back is
    // an image never written: the note was created empty and is filled in when the answer arrives.
    return new Promise((resolve) => waiting.push(resolve));
}

function release(worker: PooledWorker) {
    const next = waiting.shift();

    if (next) {
        next(worker);

        return;
    }

    idle.push(worker);
    // Nothing was waiting for it, so this may well have been the last image of a run.
    scheduleShutdown();
}

/**
 * Takes a worker out of the pool for good, and never puts it back.
 *
 * Whoever was waiting for a free worker is answered with none rather than with this one: no process
 * is coming to replace it, and a caller told there is none compresses the image itself. Waiting on
 * a worker that no longer exists is the one outcome worse than not having workers at all.
 */
function retire(worker: PooledWorker) {
    started--;
    worker.stopped = true;
    worker.worker.kill();

    const next = waiting.shift();

    if (!next) {
        return;
    }

    // The capacity this worker held is free again, and whoever is queued for it is already past
    // the point where they could have started one for themselves — they queued because the pool
    // was full, and it no longer is. Starting the replacement here is what keeps the queue moving;
    // without it a pool whose workers all died would leave everyone behind them waiting on a
    // release that can no longer come.
    //
    // Only where workers are known to run, though. If none has ever spoken, another is not going
    // to either, and starting one would make this caller wait out a second process failing to come
    // up before hearing the same answer it can be given now.
    const replacement = everSpoke ? spawn() : null;

    if (replacement) {
        started++;
        next(replacement);
    } else {
        // Nothing can be started, which `spawn` has already answered for by disabling workers
        // outright — and that answers everyone else. This one was taken off the queue first.
        next(null);
    }
}

/**
 * The heap a worker is given: sized to the work, and neither inherited nor unbounded.
 *
 * Both directions matter, which is why this is a fixed figure rather than a floor.
 *
 * Too small and a decode does not fail, it collects — over and over, taking several times longer
 * while looking perfectly healthy. Whatever started this process sized its heap for running an
 * application, not for decoding photographs.
 *
 * Too large is the subtler half. V8 collects lazily against its ceiling, so a child allowed four
 * gigabytes will happily accumulate several before it bothers, and four such children can put a
 * machine into paging — where the symptom is not the compression slowing down but everything else
 * stopping, the process that hosts them included.
 *
 * This is what one decode actually needs: the memory budget a single image may claim, and room to
 * work around it. A worker only ever holds one image at a time, so it never needs more.
 */
const WORKER_HEAP_MB = 2048;

function spawn(): PooledWorker | null {
    const entry = workerEntry();

    /* v8 ignore next 3 -- guarded by compressionConcurrency() answering 1 when there is no entry,
       which stops the caller ever asking. Kept because "no entry" and "cannot spawn" are one
       fallback, and this is the one that must not throw. */
    if (!entry) {
        return disable("no worker entry point was found");
    }

    try {
        const startedAt = Date.now();
        const worker = fork(entry.file, {
            execArgv: [ ...(entry.execArgv ?? []), `--max-old-space-size=${WORKER_HEAP_MB}` ],
            // The default serialization is JSON, which has no idea what to do with an image's
            // bytes; this is the structured clone a worker thread's messages always had.
            serialization: "advanced"
        });
        const readiness: { arrived?: () => void; died?: (error: unknown) => void } = {};
        const ready = new Promise<void>((resolve, reject) => {
            readiness.arrived = resolve;
            readiness.died = reject;
        });

        // A worker that dies while idle has nobody awaiting its readiness; that is not a leak
        // worth a warning about an unhandled rejection.
        ready.catch(() => {});

        const pooled: PooledWorker = { worker, pid: worker.pid, ready };

        // A process that comes up says so within a second, so a long silence here is not a slow
        // boot but a hung one — and without a deadline of its own it would sit on the run for the
        // whole of the reply timeout, which is sized for decodes, not for saying hello.
        const bootTimer = setTimeout(() => {
            getLog().info(`Image Compression Tool: worker ${pooled.pid} did not come up within `
                + `${WORKER_BOOT_TIMEOUT_MS}ms; giving up on it`);
            readiness.died?.(new Error("Image worker did not come up in time."));
        }, WORKER_BOOT_TIMEOUT_MS);

        bootTimer.unref();

        // Rare enough to say out loud without asking: a handful of lines per process, and the ones
        // that answer "did a worker ever start, and did it stay up" — which is the whole question
        // when a run stops making progress.
        getLog().info(`Image Compression Tool: starting a worker with a `
            + `${WORKER_HEAP_MB} MB heap from ${entry.file}`);
        pooled.worker.on("spawn",
            () => getLog().info(`Image Compression Tool: worker ${pooled.pid} online in ${Date.now() - startedAt}ms`));

        pooled.worker.on("message", (response: ImageWorkerResponse | ImageWorkerTrace) => {
            clearTimeout(bootTimer);
            everSpoke = true;
            readiness.arrived?.();

            // Traces arrive while the image is still being worked on, so they are written straight
            // out rather than waited for; only the answer settles the request.
            if ("trace" in response) {
                getLog().info(`Image Compression Tool: ${response.trace}`);

                return;
            }

            pooled.pending?.(response);
        });
        // A worker that dies takes its in-flight image with it; the image is failed, not the run.
        pooled.worker.on("error", (error) => {
            clearTimeout(bootTimer);
            getLog().info(`Image Compression Tool: worker ${pooled.pid} errored: ${firstLine(error)}`);
            readiness.died?.(error);
            pooled.failed?.(error);
        });
        pooled.worker.on("exit", (code, signal) => {
            clearTimeout(bootTimer);
            // A worker we stopped ourselves exits with a failure code too, so saying so plainly is
            // the difference between "this is the pool tidying up" and "something died mid-image".
            getLog().info(pooled.stopped
                ? `Image Compression Tool: worker ${pooled.pid} stopped`
                : `Image Compression Tool: worker ${pooled.pid} exited unexpectedly with code ${code ?? signal}`
                    + `${pooled.pending ? " while working on an image" : " while idle"}`);
            readiness.died?.(new Error(`Image worker exited with code ${code ?? signal}.`));
            pooled.failed?.(new Error(`Image worker exited with code ${code ?? signal}.`));
        });
        // Never a reason for the pool to be what holds this process open; both handles count.
        pooled.worker.unref();
        pooled.worker.channel?.unref();

        return pooled;
    } catch (e: unknown) {
        return disable(`they could not be started (${(e as Error).message})`);
    }
}

/** The gist of a failure. A worker's error arrives with its stack attached, which a log line is not. */
function firstLine(error: unknown): string {
    return String(error instanceof Error ? error.message : error).split(/\r?\n/)[0];
}

/**
 * Gives up on workers for the rest of the process, saying so once.
 *
 * Once rather than per image: a run over a subtree would otherwise write the same line a thousand
 * times, and the condition is a property of this installation rather than of any one image.
 */
function disable(reason: string): null {
    if (!disabled) {
        disabled = true;
        getLog().info(
            `Image Compression Tool: compressing in this process because ${reason}.`);
    }

    // Everyone still queued is answered, not left holding a promise for a worker that is now never
    // coming. Nothing else would ever answer them — the queue is drained by workers coming free,
    // and there are to be no more workers — so without this they wait for the life of the process,
    // and whoever is awaiting them waits with them. An image whose compression never returns is an
    // image that is never written: the note is created empty and filled in when the compression
    // answers, so a promise that never settles is a note left at nothing.
    answerEveryoneWaiting();

    return null;
}

/** Tells every queued caller there is no worker for it, so each one compresses its own image. */
function answerEveryoneWaiting() {
    while (waiting.length > 0) {
        waiting.shift()?.(null);
    }
}

function send(
    worker: PooledWorker,
    buffer: Uint8Array,
    request: ImageCompressionRequest,
    budgetMb: number
): Promise<ImageWorkerResponse> {
    const message: ImageWorkerRequest = { id: ++lastRequestId, buffer, request, budgetMb };
    const sentAt = Date.now();

    trace(`sending image #${message.id} (${buffer.byteLength} bytes) to worker ${worker.pid}`
        + ` — ${started} started, ${idle.length} idle, ${waiting.length} waiting`);

    return new Promise<ImageWorkerResponse>((resolve, reject) => {
        // A worker that took an image and went quiet would otherwise hold the run open with nothing
        // to show for it. Generous, because a large decode legitimately takes minutes; expiring is
        // treated as the worker having failed, and the image is compressed here instead.
        const expiry = setTimeout(() => {
            getLog().info(
                `Image Compression Tool: worker ${worker.pid} did not answer for image `
                + `#${message.id} within ${WORKER_REPLY_TIMEOUT_MS}ms; giving up on it`);
            reject(new Error("Image worker did not answer in time."));
        }, WORKER_REPLY_TIMEOUT_MS);

        worker.pending = (response) => {
            clearTimeout(expiry);
            trace(`worker ${worker.pid} answered image #${message.id} in ${Date.now() - sentAt}ms`);
            resolve(response);
        };
        worker.failed = (error) => {
            clearTimeout(expiry);
            reject(error);
        };
        // Only once the child is listening; a message sent into its boot is a message lost. The
        // bytes are copied rather than shared either way — the caller still holds them to report
        // the original size, and to fall back on if this goes wrong.
        worker.ready.then(
            () => worker.worker.send(message, (error) => {
                if (error) {
                    worker.failed?.(error);
                }
            }),
            (error: unknown) => worker.failed?.(error)
        );
    }).finally(() => {
        worker.pending = undefined;
        worker.failed = undefined;
    });
}

/**
 * How long a worker is given to answer before it is written off.
 *
 * Deliberately far longer than any decode should take, because the cost of being wrong in this
 * direction is small and the cost of being wrong in the other is not. Two minutes looked generous
 * against images that decode in seconds — until an image near the size ceiling, sharing the memory
 * bus with three others, legitimately took longer than that. Killing it did not save any time: the
 * work fell back onto the thread serving the application, blocked it for twenty seconds, and made
 * the next worker time out in turn.
 *
 * So this is for a worker that has genuinely stopped, not for one that is taking a while. A run
 * meets that at most once per worker, and the images are not waiting on anything else meanwhile.
 */
const WORKER_REPLY_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * How long a fresh process is given to announce itself before it is written off.
 *
 * Kept apart from the reply timeout above, which is sized for decodes that legitimately take
 * minutes: coming up is under a second of work, and a process silent for this long past it is not
 * going to speak. Generous all the same — a first spawn on a loaded machine, behind a virus
 * scanner reading the binary, has taken whole seconds without anything being wrong.
 */
const WORKER_BOOT_TIMEOUT_MS = 30 * 1000;

/**
 * Per-image tracing, off unless asked for: a cleanup over a large tree would otherwise write two
 * lines per image into the log a user reads. Set `TRILIUM_IMAGE_WORKER_DEBUG` to follow a run image
 * by image; the worker reads the same variable and traces its own side to stdout.
 */
function trace(message: string) {
    if (process.env.TRILIUM_IMAGE_WORKER_DEBUG) {
        getLog().info(`Image Compression Tool: ${message}`);
    }
}

let lastRequestId = 0;

interface WorkerEntry {
    file: string;
    execArgv?: string[];
}

/**
 * Where the worker's code is, which differs by how the server was started.
 *
 * Bundled, the worker sits beside the bundle as an entry point of its own. Running from sources it
 * is the TypeScript, started with this process's own loader flags — which works wherever those
 * flags are what makes TypeScript readable, and fails harmlessly wherever they are not. A loader
 * that arrived through `NODE_OPTIONS` instead — the desktop's dev launcher does this — reaches the
 * child through its environment, which fork passes on by itself.
 *
 * Answered once and remembered, including the answer that there is none: this is a question about
 * an installation, and asking the filesystem it per image would be its own small waste.
 */
function workerEntry(): WorkerEntry | null {
    if (resolvedEntry === undefined) {
        resolvedEntry = [
            { file: join(__dirname, "services", "image_worker.cjs") },
            { file: join(__dirname, "image_worker.cjs") },
            { file: join(__dirname, "image_worker.ts"), execArgv: process.execArgv }
        ].find((candidate) => existsSync(candidate.file)) ?? null;
    }

    return resolvedEntry;
}

let resolvedEntry: WorkerEntry | null | undefined;
