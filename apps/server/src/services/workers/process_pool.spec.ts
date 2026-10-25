import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProcessPoolOptions } from "./process_pool.js";
import type { WorkerHandle, WorkerSpawnOptions } from "./worker_host.js";

const h = vi.hoisted(() => ({
    logs: [] as string[],
    cores: 8,
    memoryBytes: 32 * 1024 * 1024 * 1024
}));

vi.mock("node:os", () => ({ availableParallelism: () => h.cores, totalmem: () => h.memoryBytes }));
vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ info: (line: string) => h.logs.push(line), error() {} })
}));

type Listener = (...args: never[]) => void;

class FakeWorker implements WorkerHandle {
    sent: { id: number; request: unknown }[] = [];
    killed = false;
    unrefed = false;
    postError?: Error;
    private listeners = new Map<string, Listener[]>();

    constructor(readonly pid: number) {}

    postMessage(message: unknown) {
        if (this.postError) {
            throw this.postError;
        }

        this.sent.push(message as { id: number; request: unknown });
    }

    on(event: string, listener: Listener) {
        this.listeners.set(event, [ ...(this.listeners.get(event) ?? []), listener ]);
    }

    emit(event: string, ...args: unknown[]) {
        for (const listener of this.listeners.get(event) ?? []) {
            (listener as (...values: unknown[]) => void)(...args);
        }
    }

    announce() {
        this.emit("message", { trace: `worker ${this.pid}: loaded and listening` });
    }

    answer(result: unknown, logs: string[] = []) {
        const job = this.sent.at(-1);

        if (!job) {
            throw new Error(`worker ${this.pid} was sent no job`);
        }

        this.emit("message", { id: job.id, result, logs });
    }

    kill() {
        this.killed = true;
    }

    unref() {
        this.unrefed = true;
    }
}

let workers: FakeWorker[];
let spawns: { file: string; options: WorkerSpawnOptions }[];
let spawnError: Error | undefined;

async function createPool(overrides: Partial<ProcessPoolOptions> = {}) {
    const { createProcessPool } = await import("./process_pool.js");

    return createProcessPool<string, string>({
        name: "Test Pool",
        // Any file that exists serves as the entry: the spawner below never starts it.
        entry: "process_pool",
        sourceDir: __dirname,
        maxWorkers: () => 1,
        heapMb: 512,
        bootTimeoutMs: 1000,
        replyTimeoutMs: 5000,
        idleShutdownMs: 3000,
        ...overrides
    });
}

/** Lets the ready gate and the send chain run to completion. */
async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
    h.logs.length = 0;
    h.cores = 8;
    h.memoryBytes = 32 * 1024 * 1024 * 1024;
    workers = [];
    spawns = [];
    spawnError = undefined;

    const host = await import("./worker_host.js");

    host.setWorkerSpawner((file, options) => {
        if (spawnError) {
            throw spawnError;
        }

        spawns.push({ file, options });

        const worker = new FakeWorker(4000 + workers.length);

        workers.push(worker);

        return worker;
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe("createProcessPool", () => {
    it("runs a job in a worker and relays its logs", async () => {
        process.env.TRILIUM_SAFE_MODE = "1";

        try {
            const pool = await createPool();
            const result = pool.run("hello");

            await flush();
            expect(workers).toHaveLength(1);

            const [ worker ] = workers;
            const { file, options } = spawns[0];

            expect(file).toMatch(/process_pool\.ts$/);
            expect(options.execArgv).toContain("--max-old-space-size=512");
            expect(options.env.TRILIUM_SAFE_MODE).toBeUndefined();
            expect(options.serviceName).toBe("Trilium Test Pool");
            expect(worker.unrefed).toBe(true);

            // Nothing is sent before the worker has announced its listener.
            expect(worker.sent).toHaveLength(0);
            worker.announce();
            await flush();
            expect(worker.sent).toEqual([ { id: 1, request: "hello" } ]);

            worker.answer("HELLO", [ "codec line" ]);
            await expect(result).resolves.toBe("HELLO");
            expect(h.logs).toContain("codec line");
            expect(h.logs).toContain("Test Pool: worker 4000: loaded and listening");
            expect(pool.concurrency()).toBe(1);
        } finally {
            delete process.env.TRILIUM_SAFE_MODE;
        }
    });

    it("answers null without spawning when there is no worker entry", async () => {
        const pool = await createPool({ entry: "no_such_worker" });

        await expect(pool.run("job")).resolves.toBeNull();
        expect(spawns).toHaveLength(0);
        expect(pool.concurrency()).toBe(1);
    });

    it("answers null when the spawner throws, and stops trying", async () => {
        spawnError = new Error("fuse burnt");
        const pool = await createPool();

        await expect(pool.run("job")).resolves.toBeNull();
        spawnError = undefined;
        await expect(pool.run("job")).resolves.toBeNull();
        expect(spawns).toHaveLength(0);
        expect(h.logs.some((line) => line.includes("fuse burnt"))).toBe(true);
    });

    it("gives up for good, answering the queue too, when no worker ever spoke", async () => {
        const pool = await createPool();
        const running = pool.run("first");

        await flush();

        const queued = [ pool.run("second"), pool.run("third") ];

        await flush();
        expect(workers).toHaveLength(1);

        workers[0].emit("exit", 127);
        await expect(running).resolves.toBeNull();
        await expect(Promise.all(queued)).resolves.toEqual([ null, null ]);

        await expect(pool.run("later")).resolves.toBeNull();
        expect(workers).toHaveLength(1);
    });

    it("fails one job alone once a worker has spoken, and replaces its worker for the queue", async () => {
        const pool = await createPool();
        const running = pool.run("poison");

        await flush();

        const queued = pool.run("next");

        await flush();

        const [ worker ] = workers;

        worker.announce();
        await flush();
        // An exit code with no signal, the way a utility process reports it.
        worker.emit("exit", 3);
        await expect(running).rejects.toThrow("exited with code 3");
        expect(worker.killed).toBe(true);

        await flush();
        expect(workers).toHaveLength(2);

        const replacement = workers[1];

        replacement.announce();
        await flush();
        expect(replacement.sent.map((job) => job.request)).toEqual([ "next" ]);
        replacement.answer("ok");
        await expect(queued).resolves.toBe("ok");
    });

    it("rejects a job the worker reports as failed, and keeps the worker", async () => {
        const pool = await createPool();
        const failing = pool.run("bad");

        await flush();

        const [ worker ] = workers;

        worker.announce();
        await flush();
        worker.emit("message", { id: worker.sent[0].id, error: "Error: bad input", logs: [ "partial" ] });
        await expect(failing).rejects.toThrow("bad input");
        expect(h.logs).toContain("partial");
        expect(worker.killed).toBe(false);

        const next = pool.run("good");

        await flush();
        worker.answer("fine");
        await expect(next).resolves.toBe("fine");
        expect(workers).toHaveLength(1);
    });

    it("treats a postMessage that throws as that job failing", async () => {
        const pool = await createPool();
        const first = pool.run("first");

        await flush();

        const [ worker ] = workers;

        worker.announce();
        await flush();
        worker.answer("one");
        await expect(first).resolves.toBe("one");

        worker.postError = new Error("channel closed");

        await expect(pool.run("second")).rejects.toThrow("channel closed");
        expect(worker.killed).toBe(true);
    });

    it("gives up on a worker that does not announce within the boot timeout", async () => {
        const pool = await createPool();
        const result = pool.run("job");

        await flush();
        vi.advanceTimersByTime(1000);
        await expect(result).resolves.toBeNull();
        expect(workers[0].killed).toBe(true);
        expect(h.logs.some((line) => line.includes("did not come up within 1000ms"))).toBe(true);
    });

    it("fails a job whose worker does not answer within the reply timeout", async () => {
        const pool = await createPool();
        const result = pool.run("slow");

        await flush();

        const [ worker ] = workers;

        worker.announce();
        await flush();
        vi.advanceTimersByTime(4999);
        await flush();
        expect(worker.killed).toBe(false);
        vi.advanceTimersByTime(1);
        await expect(result).rejects.toThrow("did not answer in time");
        expect(worker.killed).toBe(true);
    });

    it("stops idle workers after the idle timeout and starts fresh ones later", async () => {
        const pool = await createPool();
        const first = pool.run("one");

        await flush();

        const [ worker ] = workers;

        worker.announce();
        await flush();
        worker.answer("1");
        await expect(first).resolves.toBe("1");

        vi.advanceTimersByTime(2999);
        expect(worker.killed).toBe(false);
        vi.advanceTimersByTime(1);
        expect(worker.killed).toBe(true);
        // A stopped worker's exit is not a failure.
        worker.emit("exit", null, "SIGTERM");
        expect(h.logs).toContain("Test Pool: worker 4000 stopped");

        const second = pool.run("two");

        await flush();
        expect(workers).toHaveLength(2);
        workers[1].announce();
        await flush();
        workers[1].answer("2");
        await expect(second).resolves.toBe("2");
    });

    it("never runs more jobs than maxWorkers, and serves the queue in order", async () => {
        const pool = await createPool({ maxWorkers: () => 2 });
        const results = [ "a", "b", "c", "d", "e" ].map((job) => pool.run(job));

        await flush();
        expect(workers).toHaveLength(2);

        for (const worker of workers) {
            worker.announce();
        }

        await flush();

        const [ first, second ] = workers;
        const requests = (worker: FakeWorker) => worker.sent.map((job) => job.request);

        expect(requests(first)).toEqual([ "a" ]);
        expect(requests(second)).toEqual([ "b" ]);

        // Each freed worker takes the oldest queued job; nothing else starts meanwhile.
        for (const [ worker, expected ] of [
            [ first, [ "a", "c" ] ],
            [ second, [ "b", "d" ] ],
            [ first, [ "a", "c", "e" ] ]
        ] as const) {
            worker.answer(String(worker.sent.at(-1)?.request).toUpperCase());
            await flush();
            expect(requests(worker)).toEqual(expected);
        }

        second.answer("D");
        first.answer("E");
        expect(workers).toHaveLength(2);
        await expect(Promise.all(results)).resolves.toEqual([ "A", "B", "C", "D", "E" ]);
        expect(pool.concurrency()).toBe(2);
    });
});

describe("defaultWorkerCount", () => {
    it("caps a server at serverMax and a desktop at its cores less one, both within memory", async () => {
        const { defaultWorkerCount } = await import("./process_pool.js");
        const versions = process.versions as { electron?: string };

        h.cores = 12;
        h.memoryBytes = 64 * 1024 * 1024 * 1024;
        expect(defaultWorkerCount(2048)).toBe(4);
        expect(defaultWorkerCount(2048, 6)).toBe(6);
        expect(defaultWorkerCount(16 * 1024)).toBe(2);

        versions.electron = "44.0.0";

        try {
            expect(defaultWorkerCount(2048)).toBe(11);
            h.memoryBytes = 1024 * 1024 * 1024;
            expect(defaultWorkerCount(2048)).toBe(1);
        } finally {
            delete versions.electron;
        }
    });
});
