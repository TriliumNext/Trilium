import type { ContentJob } from "@triliumnext/core/src/services/content_jobs/jobs.js";
import { runContentJob } from "@triliumnext/core/src/services/content_jobs/jobs.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkerHandle } from "./worker_host.js";

const h = vi.hoisted(() => ({
    logs: [] as string[]
}));

vi.mock("node:os", () => ({ availableParallelism: () => 8, totalmem: () => 32 * 1024 * 1024 * 1024 }));
vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ info: (line: string) => h.logs.push(line), error() {} })
}));

type Listener = (...args: never[]) => void;

class FakeWorker implements WorkerHandle {
    sent: { id: number; request: ContentJob }[] = [];
    killed = false;
    private listeners = new Map<string, Listener[]>();

    constructor(readonly pid: number) {}

    postMessage(message: unknown) {
        this.sent.push(message as { id: number; request: ContentJob });
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

    reply(outcome: unknown) {
        const job = this.sent.at(-1);

        if (!job) {
            throw new Error(`worker ${this.pid} was sent no job`);
        }

        this.emit("message", { id: job.id, result: outcome, logs: [] });
    }

    kill() {
        this.killed = true;
    }

    unref() {}
}

const ENV = { allowedHtmlTags: [ "p", "strong" ], taskStates: [] };
const LARGE_HTML = `<p onclick="x()">${"<strong>bold</strong> text ".repeat(800)}</p><script>alert(1)</script>`;
const largeJob: ContentJob = { kind: "sanitizeHtml", html: LARGE_HTML, env: ENV };

let workers: FakeWorker[];
let spawnError: Error | undefined;

async function createExecutor() {
    const { createPooledContentJobExecutor } = await import("./content_job_executor.js");

    return createPooledContentJobExecutor();
}

/** Lets the ready gate and the send chain run to completion. */
async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

/** Starts `job`, brings the first worker up and returns it with the pending result. */
async function sendToWorker(executor: Awaited<ReturnType<typeof createExecutor>>, job: ContentJob) {
    const result = executor.run(job);

    await flush();

    const worker = workers.at(-1);

    if (!worker) {
        throw new Error("no worker was spawned");
    }

    worker.announce();
    await flush();

    return { result, worker };
}

beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
    h.logs.length = 0;
    workers = [];
    spawnError = undefined;

    const host = await import("./worker_host.js");

    host.setWorkerSpawner(() => {
        if (spawnError) {
            throw spawnError;
        }

        const worker = new FakeWorker(5000 + workers.length);

        workers.push(worker);

        return worker;
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe("createPooledContentJobExecutor", () => {
    it("sends a large job to a worker and exposes the pool's concurrency", async () => {
        const executor = await createExecutor();

        expect(LARGE_HTML.length).toBeGreaterThan((await import("./content_job_executor.js")).IN_PROCESS_MAX_CHARS);
        expect(executor.concurrency).toBe(4);
        expect(workers).toHaveLength(0);

        const { result, worker } = await sendToWorker(executor, largeJob);

        expect(worker.sent).toHaveLength(1);
        expect(worker.sent[0].request).toEqual(largeJob);
        worker.reply({ result: "from the worker" });
        await expect(result).resolves.toBe("from the worker");
    });

    it("converts a small job in this process without starting a worker", async () => {
        const executor = await createExecutor();
        const job: ContentJob = { kind: "sanitizeHtml", html: "<p onclick=\"x()\">a</p><script>1</script>", env: ENV };

        await expect(executor.run(job)).resolves.toBe(await runContentJob(job));

        const { IN_PROCESS_MAX_CHARS } = await import("./content_job_executor.js");
        const justUnder: ContentJob = { kind: "markdownToHtml", markdown: "a".repeat(IN_PROCESS_MAX_CHARS - 1), title: "", env: ENV };

        await expect(executor.run(justUnder)).resolves.toBe(await runContentJob(justUnder));
        expect(workers).toHaveLength(0);

        const atThreshold = executor.run({ ...justUnder, markdown: "a".repeat(IN_PROCESS_MAX_CHARS) });

        await flush();
        expect(workers).toHaveLength(1);
        workers[0].announce();
        await flush();
        workers[0].reply({ result: "<p>pooled</p>" });
        await expect(atThreshold).resolves.toBe("<p>pooled</p>");
    });

    it("sends an office document to a worker whatever its size", async () => {
        const executor = await createExecutor();
        const job: ContentJob = { kind: "officeToHtml", bytes: new Uint8Array(4), mime: "application/rtf", options: {} };
        const { result, worker } = await sendToWorker(executor, job);

        expect(worker.sent[0].request.kind).toBe("officeToHtml");
        worker.reply({ result: "<p>doc</p>" });
        await expect(result).resolves.toBe("<p>doc</p>");
    });

    it("converts in this process when no worker can be started", async () => {
        spawnError = new Error("fuse burnt");
        const executor = await createExecutor();

        await expect(executor.run(largeJob)).resolves.toBe(await runContentJob(largeJob));
        expect(workers).toHaveLength(0);
    });

    it("rejects with the worker's message when the conversion throws, without redoing it here", async () => {
        const executor = await createExecutor();
        const { result, worker } = await sendToWorker(executor, largeJob);

        worker.reply({ error: "Unsupported markup at line 3" });
        await expect(result).rejects.toThrow(/^Unsupported markup at line 3$/);
        expect(h.logs.some((line) => line.includes("running it in this process"))).toBe(false);

        // A job error leaves the worker healthy, so the next job reuses it.
        expect(worker.killed).toBe(false);

        const next = executor.run(largeJob);

        await flush();
        expect(workers).toHaveLength(1);
        worker.reply({ result: "second" });
        await expect(next).resolves.toBe("second");
    });

    it("retries a job whose worker crashed in a fresh worker, not in this process", async () => {
        const executor = await createExecutor();
        const { result, worker } = await sendToWorker(executor, largeJob);

        worker.emit("exit", 134);
        await flush();
        expect(worker.killed).toBe(true);

        const retry = workers[1];

        expect(retry).toBeDefined();
        retry.announce();
        await flush();
        expect(retry.sent.map((sent) => sent.request)).toEqual([ largeJob ]);
        retry.reply({ result: "from the retry" });
        await expect(result).resolves.toBe("from the retry");
        expect(h.logs.some((line) => line.includes("running it in this process"))).toBe(false);
    });

    it("rejects a job that crashes its worker twice, without running it here", async () => {
        const executor = await createExecutor();
        const { result, worker } = await sendToWorker(executor, largeJob);
        const settled = result.then(() => "resolved", (error: unknown) => error);

        worker.emit("exit", 134);
        await flush();

        const retry = workers[1];

        expect(retry).toBeDefined();
        retry.announce();
        await flush();
        retry.emit("exit", 134);

        const error = await settled;

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Content conversion crashed the worker twice.");
        expect(workers).toHaveLength(2);
        expect(h.logs.some((line) => line.includes("running it in this process"))).toBe(false);
    });

    it("rejects a crashed job when no worker can be started to retry it", async () => {
        const executor = await createExecutor();
        const { result, worker } = await sendToWorker(executor, largeJob);

        spawnError = new Error("fuse burnt");
        worker.emit("exit", 134);

        await expect(result).rejects.toThrow("no worker could be started to retry it");
        expect(h.logs.some((line) => line.includes("running it in this process"))).toBe(false);
    });

    it("fails a job that outlives the reply timeout rather than redoing it here", async () => {
        const executor = await createExecutor();
        const { result, worker } = await sendToWorker(executor, largeJob);
        const settled = result.then(() => "resolved", (error: unknown) => error);

        vi.advanceTimersByTime(5 * 60 * 1000);

        const error = await settled;

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).name).toBe("WorkerReplyTimeoutError");
        expect(worker.killed).toBe(true);
        expect(h.logs.some((line) => line.includes("running it in this process"))).toBe(false);
    });
});
