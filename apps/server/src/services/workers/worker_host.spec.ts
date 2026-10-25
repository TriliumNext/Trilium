import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    fork: vi.fn()
}));

vi.mock("node:child_process", () => ({ fork: h.fork }));

class FakeChildProcess extends EventEmitter {
    pid = 1234;
    connected = true;
    channel = { unref: vi.fn() };
    sendError: Error | null = null;
    send = vi.fn((_message: unknown, callback: (error: Error | null) => void) => {
        callback(this.sendError);

        return true;
    });
    kill = vi.fn();
    unref = vi.fn();
}

let child: FakeChildProcess;

beforeEach(() => {
    vi.resetModules();
    h.fork.mockReset();
    child = new FakeChildProcess();
    h.fork.mockReturnValue(child);
});

describe("default fork spawner", () => {
    it("forks with structured-clone serialization and adapts the child to a WorkerHandle", async () => {
        const { spawnWorker } = await import("./worker_host.js");
        const env = { A: "1" };
        const handle = spawnWorker("/x/worker.cjs", { execArgv: [ "--flag" ], env, serviceName: "unused" });

        expect(h.fork).toHaveBeenCalledWith("/x/worker.cjs", { execArgv: [ "--flag" ], env, serialization: "advanced" });
        expect(handle.pid).toBe(1234);

        const messages: unknown[] = [];
        const exits: unknown[][] = [];
        const errors: Error[] = [];

        handle.on("message", (message) => messages.push(message));
        handle.on("exit", (...args) => exits.push(args));
        handle.on("error", (error) => errors.push(error));

        child.emit("message", { id: 1 });
        child.emit("exit", null, "SIGKILL");
        expect(messages).toEqual([ { id: 1 } ]);
        expect(exits).toEqual([ [ null, "SIGKILL" ] ]);

        handle.postMessage({ id: 2 });
        expect(child.send).toHaveBeenCalledWith({ id: 2 }, expect.any(Function));

        // A failed send surfaces as an error event, as does the child's own error.
        child.sendError = new Error("EPIPE");
        handle.postMessage({ id: 3 });
        child.emit("error", new Error("spawn failed"));
        expect(errors.map((error) => error.message)).toEqual([ "EPIPE", "spawn failed" ]);

        // A closed channel throws synchronously.
        child.connected = false;
        expect(() => handle.postMessage({ id: 4 })).toThrow("closed");

        handle.unref();
        handle.kill();
        expect(child.unref).toHaveBeenCalled();
        expect(child.channel.unref).toHaveBeenCalled();
        expect(child.kill).toHaveBeenCalled();
    });

    it("can be replaced and restored", async () => {
        const { setWorkerSpawner, spawnWorker } = await import("./worker_host.js");
        const custom = vi.fn(() => ({ pid: 1 }) as never);
        const options = { execArgv: [], env: {}, serviceName: "Trilium test" };

        setWorkerSpawner(custom);
        spawnWorker("/x/worker.cjs", options);
        expect(custom).toHaveBeenCalledWith("/x/worker.cjs", options);
        expect(h.fork).not.toHaveBeenCalled();

        setWorkerSpawner(null);
        spawnWorker("/x/worker.cjs", options);
        expect(h.fork).toHaveBeenCalledTimes(1);
    });
});

describe("resolveWorkerEntry", () => {
    it("finds the TypeScript source with this process's loader flags, and remembers a miss", async () => {
        const { resolveWorkerEntry } = await import("./worker_host.js");

        expect(resolveWorkerEntry("worker_host")).toEqual({
            file: expect.stringMatching(/workers[\\/]worker_host\.ts$/),
            execArgv: process.execArgv
        });
        expect(resolveWorkerEntry("no_such_worker")).toBeNull();
        expect(resolveWorkerEntry("no_such_worker", __dirname)).toBeNull();
    });
});

describe("workerEnv", () => {
    it("drops the variables that make core write options at boot", async () => {
        const { workerEnv } = await import("./worker_host.js");

        expect(workerEnv({ PATH: "/bin", TRILIUM_SAFE_MODE: "1", TRILIUM_START_NOTE_ID: "root", NODE_OPTIONS: "--x" }))
            .toEqual({ PATH: "/bin", NODE_OPTIONS: "--x" });
    });
});

describe("spawnerPending", () => {
    it("holds the spawner's readiness until it settles, and nothing for a spawner that is ready", async () => {
        const { setWorkerSpawner, spawnerPending } = await import("./worker_host.js");
        let markReady = () => {};
        const spawner = () => {
            throw new Error("not called");
        };

        expect(spawnerPending()).toBeNull();

        setWorkerSpawner(spawner, new Promise<void>((resolve) => {
            markReady = resolve;
        }));
        const pending = spawnerPending();
        expect(pending).toBeInstanceOf(Promise);

        markReady();
        await pending;
        expect(spawnerPending()).toBeNull();

        setWorkerSpawner(null);
        expect(spawnerPending()).toBeNull();
    });
});
