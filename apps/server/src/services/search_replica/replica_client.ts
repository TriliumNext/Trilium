/**
 * The main process's side of the search replica (`search_replica_worker.ts`): one long-lived worker
 * process that answers the route-level searches from its own read-only copy of becca.
 *
 * The client is both core's `SearchExecutor` and its `BeccaReplicaSink`. Commits, reloads and
 * protected-session changes go down the same channel as the queries, in the order they happen, so a
 * search sent after a commit sees that commit.
 *
 * The replica is never load-bearing. Until it is ready, after it is turned off and while it is being
 * replaced, searches run in this process. A query that the replica does not answer within the
 * timeout, or that was waiting on a replica that died, is answered here too.
 */

import { totalmem } from "node:os";

import {
    type BeccaReplicaSink,
    deserializeSearchQueryError,
    getConfig,
    getLog,
    getPlatform,
    inProcessSearchExecutor,
    type SearchExecutor,
    type SearchQueryArgs,
    type SearchQueryKind,
    type SearchQueryResults
} from "@triliumnext/core";

import config from "../config.js";
import { getResourceDir } from "../utils.js";
import { resolveWorkerEntry, spawnWorker, type WorkerHandle, workerEnv } from "../workers/worker_host.js";
import {
    REPLICA_OPTIONS_ENV, type ReplicaBootOptions, type ReplicaReply, type ReplicaRequest
} from "./replica_protocol.js";

export type ReplicaState = "idle" | "booting" | "ready" | "disabled";

export interface ReplicaSearchExecutor extends SearchExecutor, BeccaReplicaSink {
    readonly state: ReplicaState;
    /** Spawns the replica, or turns it off for good when this installation should not run one. */
    start(): void;
    /** Stops the replica; later searches run in this process. */
    shutdown(): void;
}

export interface ReplicaSearchOptions {
    /**
     * Defaults to `searchWorker` in the `[General]` section of `config.ini`, and off under
     * `TRILIUM_INTEGRATION_TEST`.
     */
    enabled?: boolean;
    /** Defaults to the platform's database path. */
    documentPath?: string | null;
    totalMemoryBytes?: number;
    queryTimeoutMs?: number;
    bootTimeoutMs?: number;
}

/** Below this much memory a second copy of becca costs more than the search time it saves. */
export const MIN_TOTAL_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
export const QUERY_TIMEOUT_MS = 60 * 1000;
export const BOOT_TIMEOUT_MS = 10 * 60 * 1000;

export function createReplicaSearchExecutor(options: ReplicaSearchOptions = {}): ReplicaSearchExecutor {
    const queryTimeoutMs = options.queryTimeoutMs ?? QUERY_TIMEOUT_MS;
    const bootTimeoutMs = options.bootTimeoutMs ?? BOOT_TIMEOUT_MS;
    const memoryBytes = options.totalMemoryBytes ?? totalmem();
    const heapMb = replicaHeapMb(memoryBytes);
    const pending = new Map<number, PendingQuery>();
    let state: ReplicaState = "idle";
    let worker: WorkerHandle | null = null;
    let bootTimer: NodeJS.Timeout | undefined;
    let spawnedAt = 0;
    let failures = 0;
    let lastQueryId = 0;
    // Set when a feed message arrives while the replica boots: its own load might predate it.
    let missedFeed = false;
    // Set once becca here has loaded again since startup. Only then does it hold the in-app help
    // in the stored language, which a replica gets from a reload rather than from its boot.
    let reloadedSinceStart = false;
    let dataKey: Uint8Array | null = null;

    const log = (message: string) => getLog().info(`Search replica: ${message}`);

    function start() {
        if (state !== "idle") {
            return;
        }

        const documentPath = documentPathOf();
        const reason = skipReason();

        if (reason) {
            disable(reason);
        } else if (!documentPath) {
            disable("the database has no file path");
        } else {
            spawn(documentPath);
        }
    }

    function skipReason(): string | null {
        if (options.enabled === undefined) {
            if (!config.General.searchWorker) {
                return "searchWorker is off in config.ini";
            }

            // The integration database lives in memory or in a rollback journal, neither of which a
            // second connection can follow.
            if (process.env.TRILIUM_INTEGRATION_TEST) {
                return "TRILIUM_INTEGRATION_TEST is set";
            }
        } else if (!options.enabled) {
            return "it is turned off";
        }

        if (memoryBytes < MIN_TOTAL_MEMORY_BYTES) {
            return "the machine has less than 2 GiB of memory";
        }

        if (!resolveWorkerEntry(ENTRY, __dirname)) {
            return "no replica entry point was found";
        }

        return null;
    }

    function spawn(documentPath: string) {
        const entry = resolveWorkerEntry(ENTRY, __dirname);

        /* v8 ignore next 4 -- start() checks the entry first; kept so this path never throws. */
        if (!entry) {
            disable("no replica entry point was found");
            return;
        }

        state = "booting";
        missedFeed = false;
        spawnedAt = Date.now();

        let handle: WorkerHandle;

        try {
            handle = spawnWorker(entry.file, {
                execArgv: [ ...entry.execArgv, `--max-old-space-size=${heapMb}` ],
                env: replicaEnv(documentPath),
                serviceName: "Trilium search replica"
            });
        } catch (e: unknown) {
            disable(`it could not be started (${firstLine(e)})`);
            return;
        }

        worker = handle;
        bootTimer = setTimeout(() => fail(handle, `did not come up within ${bootTimeoutMs}ms`), bootTimeoutMs);
        bootTimer.unref();

        handle.on("message", (message) => receive(handle, message as ReplicaReply));
        handle.on("error", (error) => fail(handle, `errored (${firstLine(error)})`));
        handle.on("exit", (code, signal) => fail(handle, `exited with code ${code ?? signal ?? "unknown"}`));
        handle.unref();
    }

    function receive(handle: WorkerHandle, message: ReplicaReply) {
        if (handle !== worker) {
            return;
        }

        switch (message.type) {
            case "log":
                if (message.level === "error") {
                    getLog().error(`Search replica: ${message.message}`);
                } else {
                    log(message.message);
                }
                break;
            case "ready":
                becomeReady(message);
                break;
            case "failed":
                disable(`it refused to start: ${message.reason}`);
                break;
            case "result":
                settle(message.id, (query) => query.resolve(message.result));
                break;
            case "error":
                settle(message.id, (query) => query.reject(deserializeSearchQueryError(message.error)));
                break;
        }
    }

    function becomeReady({ noteCount, heapUsedMb }: Extract<ReplicaReply, { type: "ready" }>) {
        clearTimeout(bootTimer);
        state = "ready";
        log(`ready in ${Date.now() - spawnedAt}ms with ${noteCount} notes, `
            + `${heapUsedMb} MB of a ${heapMb} MB heap`);

        if ((missedFeed || reloadedSinceStart) && !post({ type: "reload" })) {
            return;
        }

        if (dataKey) {
            post({ type: "protectedSession", dataKey });
        }
    }

    function run<K extends SearchQueryKind>(kind: K, args: SearchQueryArgs[K]): Promise<SearchQueryResults[K]> {
        const handle = worker;

        if (state !== "ready" || !handle) {
            return inProcessSearchExecutor.run(kind, args);
        }

        const id = ++lastQueryId;

        return new Promise<SearchQueryResults[K]>((resolve, reject) => {
            const timer = setTimeout(() => {
                fail(handle, `did not answer a ${kind} query within ${queryTimeoutMs}ms`);
            }, queryTimeoutMs);

            timer.unref();
            pending.set(id, {
                kind,
                args,
                timer,
                resolve: resolve as (result: unknown) => void,
                reject
            });
            post({ type: "query", id, kind, args });
        });
    }

    function feed(message: ReplicaRequest) {
        if (state === "ready") {
            post(message);
        } else if (state === "booting") {
            missedFeed = true;
        }
    }

    /** Sends a message; a replica that cannot take one is treated as dead. */
    function post(message: ReplicaRequest): boolean {
        const handle = worker;

        if (!handle) {
            return false;
        }

        try {
            handle.postMessage(message);
            return true;
        } catch (e: unknown) {
            fail(handle, `could not be sent a message (${firstLine(e)})`);
            return false;
        }
    }

    function settle(id: number, action: (query: PendingQuery) => void) {
        const query = pending.get(id);

        if (query) {
            pending.delete(id);
            clearTimeout(query.timer);
            action(query);
        }
    }

    /** Replaces a replica that died or hung, once; the second failure turns the replica off. */
    function fail(handle: WorkerHandle, reason: string) {
        if (handle !== worker) {
            return;
        }

        retire();
        failures++;

        if (failures > 1) {
            disable(`it failed again: it ${reason}`);
            return;
        }

        log(`the replica ${reason}; starting a new one.`);
        answerPendingInProcess();

        const documentPath = documentPathOf();

        if (documentPath) {
            spawn(documentPath);
        }
    }

    function disable(reason: string) {
        if (state !== "disabled") {
            log(`searching in this process because ${reason}.`);
        }

        state = "disabled";
        retire();
        answerPendingInProcess();
    }

    function retire() {
        const handle = worker;

        worker = null;
        clearTimeout(bootTimer);
        handle?.kill();
    }

    function answerPendingInProcess() {
        for (const [ id, query ] of pending) {
            pending.delete(id);
            clearTimeout(query.timer);
            query.resolve(inProcessSearchExecutor.run(query.kind, query.args));
        }
    }

    function documentPathOf(): string | null {
        return options.documentPath === undefined
            ? (getPlatform().getDatabasePath?.() ?? null)
            : options.documentPath;
    }

    function shutdown() {
        state = "disabled";
        retire();
        answerPendingInProcess();
    }

    return {
        get state() {
            return state;
        },
        start,
        shutdown,
        run,
        onCommit: (changes) => feed({ type: "commit", changes }),
        onReload() {
            reloadedSinceStart = true;
            feed({ type: "reload" });
        },
        onProtectedSession(key) {
            reloadedSinceStart ||= key === null;
            dataKey = key;
            feed({ type: "protectedSession", dataKey: key });
        }
    };
}

/** A quarter of the machine's memory, up to 4 GiB, as the replica's V8 old-space limit in MB. */
export function replicaHeapMb(totalMemoryBytes: number): number {
    return Math.min(4096, Math.floor(totalMemoryBytes / 4 / 1024 / 1024));
}

const ENTRY = "search_replica_worker";

interface PendingQuery {
    kind: SearchQueryKind;
    args: SearchQueryArgs[SearchQueryKind];
    timer: NodeJS.Timeout;
    resolve(result: unknown): void;
    reject(error: unknown): void;
}

/**
 * The replica's environment: the worker one, with the boot options and the resource directory this
 * process resolved, so both find the same translations and help.
 */
function replicaEnv(documentPath: string): NodeJS.ProcessEnv {
    const env = workerEnv();
    const bootOptions: ReplicaBootOptions = { documentPath, config: getConfig() };

    delete env.TRILIUM_INTEGRATION_TEST;
    env.TRILIUM_RESOURCE_DIR = getResourceDir();
    env[REPLICA_OPTIONS_ENV] = JSON.stringify(bootOptions);

    return env;
}

function firstLine(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);

    return message.split("\n")[0];
}
