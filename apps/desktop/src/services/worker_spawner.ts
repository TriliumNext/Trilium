import type { WorkerHandle, WorkerSpawner } from "@triliumnext/server/src/services/workers/worker_host.js";
import { workerEnv } from "@triliumnext/server/src/services/workers/worker_host.js";
import { utilityProcess } from "electron";

/**
 * Starts worker processes as Electron utility processes, which work in a packaged build where the
 * burnt `RunAsNode` fuse stops `child_process.fork`.
 *
 * A bundled `.cjs` entry gets neither loader flags nor `NODE_OPTIONS`. A `.ts` entry only exists
 * when running from sources, where the `--import tsx` in `NODE_OPTIONS` is what lets it load.
 * V8 heap flags such as `--max-old-space-size` go through `--js-flags`: a utility process ignores
 * them as plain `execArgv` entries.
 */
export const utilityProcessSpawner: WorkerSpawner = (entryFile, { execArgv, env, serviceName }) => {
    const fromSources = entryFile.endsWith(".ts");
    const childEnv = workerEnv(env);

    if (!fromSources) {
        delete childEnv.NODE_OPTIONS;
    }

    const child = utilityProcess.fork(entryFile, [], {
        execArgv: withV8FlagsAsJsFlags(fromSources ? execArgv : withoutLoaderFlags(execArgv)),
        env: childEnv,
        serviceName
    });
    let exited = false;

    child.on("exit", () => {
        exited = true;
    });

    const handle: WorkerHandle = {
        get pid() {
            return child.pid;
        },
        postMessage(message) {
            if (exited) {
                throw new Error("The worker has exited.");
            }

            try {
                child.postMessage(message);
            } catch (e: unknown) {
                throw e instanceof Error ? e : new Error(String(e));
            }
        },
        on(event: "message" | "exit" | "error", listener: (...args: never[]) => void) {
            switch (event) {
                case "message":
                    child.on("message", listener as (message: unknown) => void);
                    break;
                case "exit":
                    child.on("exit", listener as (code: number) => void);
                    break;
                case "error":
                    child.on("error", (type, location) => {
                        (listener as (error: Error) => void)(new Error(`${type} at ${location}`));
                    });
                    break;
            }
        },
        kill() {
            child.kill();
        },
        unref() {}
    };

    return handle;
};

const LOADER_FLAGS = [ "--import", "--require", "-r", "--loader", "--experimental-loader" ];

function withoutLoaderFlags(execArgv: string[]): string[] {
    const kept: string[] = [];

    for (let index = 0; index < execArgv.length; index++) {
        const arg = execArgv[index];

        if (LOADER_FLAGS.includes(arg)) {
            index++;
            continue;
        }

        if (!LOADER_FLAGS.some((flag) => arg.startsWith(`${flag}=`))) {
            kept.push(arg);
        }
    }

    return kept;
}

const V8_FLAGS = [ "--max-old-space-size=", "--max-semi-space-size=" ];

function withV8FlagsAsJsFlags(execArgv: string[]): string[] {
    const v8Flags = execArgv.filter((arg) => V8_FLAGS.some((flag) => arg.startsWith(flag)));
    if (v8Flags.length === 0) {
        return execArgv;
    }

    const others = execArgv.filter((arg) => !v8Flags.includes(arg));
    return [ ...others, `--js-flags=${v8Flags.join(" ")}` ];
}
