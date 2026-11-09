/**
 * The worker side of the channel to the parent, bundled into every worker entry.
 *
 * An Electron utility process talks through `process.parentPort`; a forked Node child talks through
 * `process.send` and the `message` event. Nothing here imports Trilium core, so a worker bundle
 * stays small.
 */

import { getHeapStatistics } from "node:v8";

/** A job the pool sends to a worker. */
export interface WorkerJob<Req> {
    id: number;
    request: Req;
}

/** A worker's answer to one job. */
export interface WorkerReply<Res> {
    id: number;
    result?: Res;
    /** Set when the job could not be done; the pool rejects that job with it. */
    error?: string;
    /** Lines for the parent's backend log, which the worker has no access to. */
    logs?: string[];
}

/** A line the worker wants logged now rather than with its answer. */
export interface WorkerTrace {
    trace: string;
}

export type WorkerMessage<Res> = WorkerReply<Res> | WorkerTrace;

/** The parts of `process` the channel uses, so a spec can hand in a fake. */
export interface ChannelHost {
    pid: number;
    env: NodeJS.ProcessEnv;
    parentPort?: {
        on(event: "message", listener: (event: { data: unknown }) => void): unknown;
        postMessage(message: unknown): void;
    };
    send?: (message: unknown) => unknown;
    on(event: "message", listener: (message: unknown) => void): unknown;
    on(event: "disconnect", listener: () => void): unknown;
    exit(code?: number): void;
}

export interface ParentChannel {
    onMessage(listener: (message: unknown) => void): void;
    post(message: unknown): void;
}

export function createParentChannel(host: ChannelHost): ParentChannel {
    const port = host.parentPort;

    if (port) {
        return {
            onMessage(listener) {
                port.on("message", (event) => listener(event.data));
            },
            post(message) {
                port.postMessage(message);
            }
        };
    }

    let watchingDisconnect = false;

    return {
        onMessage(listener) {
            host.on("message", listener);

            if (!watchingDisconnect) {
                watchingDisconnect = true;
                // A parent that has gone away never collects an answer.
                host.on("disconnect", () => host.exit(0));
            }
        },
        post(message) {
            host.send?.(message);
        }
    };
}

export function onParentMessage(listener: (message: unknown) => void) {
    processChannel().onMessage(listener);
}

export function postToParent(message: unknown) {
    processChannel().post(message);
}

export interface ServeJobsOptions {
    /** Prefix for the worker's console lines, e.g. `image worker`. */
    name: string;
    /** An environment variable that turns on per-job tracing when set. */
    traceEnv?: string;
}

/**
 * Answers the pool's jobs one at a time with `handler`, after announcing that the worker is up.
 *
 * The announce is the pool's proof that this installation can run workers at all, and carries the
 * heap limit V8 granted, which shows whether a slow worker is starved for memory.
 */
export function serveJobs<Req, Res>(
    options: ServeJobsOptions,
    handler: (request: Req, logs: string[]) => Promise<Res>,
    host: ChannelHost = process as unknown as ChannelHost
) {
    const channel = createParentChannel(host);
    const announce = (message: string) => {
        console.log(`[${options.name} ${host.pid}] ${message}`);
        channel.post({ trace: `worker ${host.pid}: ${message}` } satisfies WorkerTrace);
    };
    const trace = (message: string) => {
        if (options.traceEnv && host.env[options.traceEnv]) {
            announce(message);
        }
    };

    channel.onMessage((message) => {
        const { id, request } = message as WorkerJob<Req>;
        const logs: string[] = [];
        const started = Date.now();

        trace(`received job #${id}`);
        handler(request, logs).then(
            (result) => {
                trace(`job #${id} done in ${Date.now() - started}ms`);
                channel.post({ id, result, logs } satisfies WorkerReply<Res>);
            },
            (error: unknown) => {
                trace(`job #${id} failed in ${Date.now() - started}ms`);
                channel.post({ id, error: describe(error), logs } satisfies WorkerReply<Res>);
            }
        );
    });

    const heapLimitMb = Math.round(getHeapStatistics().heap_size_limit / 1024 / 1024);

    announce(`loaded and listening; heap limit ${heapLimitMb} MB`);
}

let defaultChannel: ParentChannel | undefined;

function processChannel(): ParentChannel {
    defaultChannel ??= createParentChannel(process as unknown as ChannelHost);

    return defaultChannel;
}

function describe(error: unknown): string {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
