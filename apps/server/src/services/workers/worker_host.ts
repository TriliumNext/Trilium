/**
 * The spawn seam for worker processes.
 *
 * The server forks plain Node children. The desktop app registers a spawner built on Electron's
 * `utilityProcess.fork` through {@link setWorkerSpawner}, because a packaged build burns the
 * `RunAsNode` fuse off and `child_process.fork` cannot start a child there. Both are adapted to
 * {@link WorkerHandle}, so the pools never see which one they run on.
 */

import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** A running worker process, whichever primitive started it. */
export interface WorkerHandle {
    /** Undefined until the process has spawned, or when spawning failed. */
    readonly pid: number | undefined;
    /**
     * Sends a structured-clone message. Throws when the channel is gone; a failure detected later
     * arrives as an `error` event.
     */
    postMessage(message: unknown): void;
    on(event: "message", listener: (message: unknown) => void): void;
    /** `signal` is only ever set by the fork adapter; a utility process reports a code alone. */
    on(event: "exit", listener: (code: number | null, signal?: string | null) => void): void;
    on(event: "error", listener: (error: Error) => void): void;
    kill(): void;
    /** Stops the handle from holding the parent's event loop open. A no-op where unsupported. */
    unref(): void;
}

export interface WorkerSpawnOptions {
    execArgv: string[];
    env: NodeJS.ProcessEnv;
    /** A name for the process in OS tools. Only the utility-process spawner uses it. */
    serviceName: string;
}

export type WorkerSpawner = (entryFile: string, options: WorkerSpawnOptions) => WorkerHandle;

export interface WorkerEntry {
    file: string;
    /** Loader flags the entry needs; empty for a bundled `.cjs`. */
    execArgv: string[];
}

/** Replaces the spawner for every pool; `null` restores the `child_process.fork` default. */
export function setWorkerSpawner(spawner: WorkerSpawner | null) {
    currentSpawner = spawner ?? forkSpawner;
}

export function spawnWorker(entryFile: string, options: WorkerSpawnOptions): WorkerHandle {
    return currentSpawner(entryFile, options);
}

/**
 * Finds a worker's code: the bundled `<basename>.cjs` beside the bundle, or the TypeScript in
 * `sourceDir` when running from sources, started with this process's own loader flags.
 *
 * The answer is remembered per basename, including the answer that there is none.
 */
export function resolveWorkerEntry(
    basename: string,
    sourceDir: string = __dirname
): WorkerEntry | null {
    const known = resolvedEntries.get(basename);

    if (known !== undefined) {
        return known;
    }

    const candidates: WorkerEntry[] = [
        { file: join(__dirname, "services", `${basename}.cjs`), execArgv: [] },
        { file: join(__dirname, `${basename}.cjs`), execArgv: [] },
        { file: join(sourceDir, `${basename}.ts`), execArgv: process.execArgv }
    ];
    const entry = candidates.find((candidate) => existsSync(candidate.file)) ?? null;

    resolvedEntries.set(basename, entry);

    return entry;
}

/**
 * The environment a worker starts with: this process's, minus the variables that make core write
 * options at boot, which a worker must never do.
 */
export function workerEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env = { ...base };

    for (const name of SCRUBBED_ENV) {
        delete env[name];
    }

    return env;
}

const SCRUBBED_ENV = [ "TRILIUM_START_NOTE_ID", "TRILIUM_SAFE_MODE" ];

const resolvedEntries = new Map<string, WorkerEntry | null>();

const forkSpawner: WorkerSpawner = (entryFile, { execArgv, env }) => {
    const child = fork(entryFile, {
        execArgv,
        env,
        // The default JSON serialization mangles binary data; this is structured clone.
        serialization: "advanced"
    });
    const errorListeners: ((error: Error) => void)[] = [];

    child.on("error", (error) => {
        for (const listener of errorListeners) {
            listener(error);
        }
    });

    return {
        get pid() {
            return child.pid;
        },
        postMessage(message) {
            if (!child.connected) {
                throw new Error("The worker's channel is closed.");
            }

            child.send(message as Parameters<typeof child.send>[0], (error) => {
                if (error) {
                    for (const listener of errorListeners) {
                        listener(error);
                    }
                }
            });
        },
        on(event: "message" | "exit" | "error", listener: (...args: never[]) => void) {
            if (event === "error") {
                errorListeners.push(listener as (error: Error) => void);
            } else {
                child.on(event, listener as (...args: unknown[]) => void);
            }
        },
        kill() {
            child.kill();
        },
        unref() {
            child.unref();
            child.channel?.unref();
        }
    };
};

let currentSpawner: WorkerSpawner = forkSpawner;
