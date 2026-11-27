import type { ImageCompressionRequest } from "@triliumnext/core/src/services/image_provider.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pool's failure semantics, with the processes themselves faked out: what separates "this
 * installation cannot run workers, stop trying" from "this one image killed its worker, fail it
 * alone". Getting that line wrong in the second direction hands the poison image to the thread
 * serving the application — the freeze the pool exists to prevent.
 */
const h = vi.hoisted(() => {
    type Handler = (...args: unknown[]) => void;

    class FakeChild {
        pid: number;
        sent: unknown[] = [];
        killed = false;
        /** What the channel reports to `send`'s callback; set to fail the next send. */
        sendError: Error | null = null;
        /** Whether the IPC channel is open; cleared by an `exit`, as Node closes a dead child's. */
        connected = true;
        channel = { unref() {} };
        private handlers = new Map<string, Handler[]>();

        constructor(pid: number) {
            this.pid = pid;
        }

        on(event: string, handler: Handler) {
            this.handlers.set(event, [ ...(this.handlers.get(event) ?? []), handler ]);

            return this;
        }

        emit(event: string, ...args: unknown[]) {
            if (event === "exit") {
                this.connected = false;
            }

            for (const handler of this.handlers.get(event) ?? []) {
                handler(...args);
            }
        }

        send(message: unknown, callback?: (error: Error | null) => void) {
            this.sent.push(message);
            callback?.(this.connected ? this.sendError : new Error("Channel closed"));

            return true;
        }

        kill() {
            this.killed = true;

            return true;
        }

        unref() {}
    }

    const forked: InstanceType<typeof FakeChild>[] = [];
    const forkOptions: { serialization?: string; execArgv?: string[] }[] = [];
    const logs: string[] = [];

    return {
        forked,
        forkOptions,
        logs,
        /** Which of the worker entry candidates exist; by default only the TypeScript source. */
        exists: (file: string) => file.endsWith("image_worker.ts"),
        forkError: null as Error | null,
        // What the fake machine has; individual tests shrink these to watch the pool follow.
        cores: 8,
        memoryBytes: 32 * 1024 * 1024 * 1024,
        fork(file: string, options: { serialization?: string; execArgv?: string[] }) {
            void file;
            if (this.forkError) {
                throw this.forkError;
            }
            forkOptions.push(options);

            const child = new FakeChild(4000 + forked.length);

            forked.push(child);

            return child;
        }
    };
});

vi.mock("node:child_process", () => ({
    fork: (file: string, options: { serialization?: string; execArgv?: string[] }) => h.fork(file, options)
}));
vi.mock("node:os", () => ({ availableParallelism: () => h.cores, totalmem: () => h.memoryBytes }));
vi.mock("node:fs", () => ({ existsSync: (file: string) => h.exists(file) }));
vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ info: (message: string) => h.logs.push(message), error() {} })
}));

const REQUEST: ImageCompressionRequest = {
    resize: true,
    maxWidthHeight: 800,
    jpegHandling: "compress",
    pngHandling: "optimize",
    quality: 75,
    conversionQuality: 85
};

const BYTES = new Uint8Array([ 1, 2, 3 ]);

/** Lets the pool's ready-gate promise chain and send callbacks run to completion. */
async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
    vi.resetModules();
    h.forked.length = 0;
    h.forkOptions.length = 0;
    h.logs.length = 0;
    h.exists = (file: string) => file.endsWith("image_worker.ts");
    h.forkError = null;
    h.cores = 8;
    h.memoryBytes = 32 * 1024 * 1024 * 1024;
});

describe("worker pool failure semantics", () => {
    it("fails a poison image alone once any worker has announced, and replaces its worker", async () => {
        const pool = await import("./image_worker_pool.js");
        const first = pool.compressInWorker(BYTES, REQUEST, 1024);

        await flush();

        const child = h.forked[0];

        expect(child).toBeDefined();
        // The bytes only survive the channel under structured clone; JSON would mangle them.
        expect(h.forkOptions[0]).toMatchObject({ serialization: "advanced" });

        // The image goes out only once the child has provably attached its listener.
        expect(child.sent).toHaveLength(0);
        child.emit("message", { trace: "worker 4000: loaded and listening" });
        await flush();
        expect(child.sent).toHaveLength(1);

        // The decode takes the worker down mid-image: the image fails, the pool does not.
        child.emit("exit", 1, null);
        await expect(first).rejects.toThrow("exited with code 1");
        expect(child.killed).toBe(true);

        const second = pool.compressInWorker(BYTES, REQUEST, 1024);

        await flush();

        const replacement = h.forked[1];

        expect(replacement).toBeDefined();
        replacement.emit("message", { trace: "worker 4001: loaded and listening" });
        await flush();
        replacement.emit("message", { id: (replacement.sent[0] as { id: number }).id, outcome: { compressed: false, reason: "no-gain" }, logs: [] });
        await expect(second).resolves.toMatchObject({ compressed: false, reason: "no-gain" });
    });

    it("gives up on workers for good only when none has ever spoken", async () => {
        const pool = await import("./image_worker_pool.js");
        const first = pool.compressInWorker(BYTES, REQUEST, 1024);

        await flush();
        // Dead before its announce: nothing has proven workers can run here at all.
        h.forked[0].emit("exit", 127, null);

        await expect(first).resolves.toBeNull();

        // Disabled: the next image is answered without so much as a spawn attempt.
        await expect(pool.compressInWorker(BYTES, REQUEST, 1024)).resolves.toBeNull();
        expect(h.forked).toHaveLength(1);
    });

    /**
     * What happens to the images queued behind a worker, which is where the pool can do real harm.
     *
     * A caller queues only when every worker is busy, and is then past the point where it could
     * have started one for itself: from there it is answered by the pool or not at all. Not at all
     * is not a slow answer but a permanent one — an import creates each note empty and fills it in
     * when its compression returns, so a promise that never settles is a note left at zero bytes.
     */
    describe("images queued behind a busy pool", () => {
        /** Fills the pool and queues `count` more images behind it. */
        async function queueBehind(pool: typeof import("./image_worker_pool.js"), count: number) {
            h.cores = 1;

            const running = pool.compressInWorker(BYTES, REQUEST, 1024);

            await flush();

            const queued = Array.from({ length: count }, () => pool.compressInWorker(BYTES, REQUEST, 1024));

            await flush();
            // One process for all of them: the rest are waiting on it, not on one of their own.
            expect(h.forked).toHaveLength(1);

            return { running, queued };
        }

        it("answers all of them when workers are given up on, rather than leaving them waiting", async () => {
            const pool = await import("./image_worker_pool.js");
            const { running, queued } = await queueBehind(pool, 3);

            // Dead before it ever spoke, so this installation is taken to have no workers at all.
            // The one being run is answered by its own call; the queued ones are answered by
            // nothing unless giving up says so.
            h.forked[0].emit("exit", 127, null);

            await expect(running).resolves.toBeNull();
            await expect(Promise.all(queued)).resolves.toEqual([ null, null, null ]);
        });

        it("starts a replacement for one that dies, so the queue behind it moves", async () => {
            const pool = await import("./image_worker_pool.js");
            const { running, queued } = await queueBehind(pool, 1);
            const worker = h.forked[0];

            worker.emit("message", { trace: "worker 4000: loaded and listening" });
            await flush();
            // Taken down by the image it was given, having already proven workers run here.
            worker.emit("exit", 1, null);
            await expect(running).rejects.toThrow("exited with code 1");
            await flush();

            // The capacity it held is free again, and the image queued for it gets a process rather
            // than a wait with nothing left to end it.
            expect(h.forked).toHaveLength(2);

            const replacement = h.forked[1];

            replacement.emit("message", { trace: "worker 4001: loaded and listening" });
            await flush();
            replacement.emit("message", {
                id: (replacement.sent[0] as { id: number }).id,
                outcome: { compressed: false, reason: "no-gain" },
                logs: []
            });

            await expect(queued[0]).resolves.toMatchObject({ compressed: false, reason: "no-gain" });
        });
    });

    it("sizes the pool to the machine's memory as well as its cores", async () => {
        const pool = await import("./image_worker_pool.js");

        // A roomy machine gets the full cap; each worker below may grow a 2 GB heap, so the sum
        // is kept inside half the memory: 8 GB carries two of them, and a small box gets the one
        // worker that off-thread compression needs at minimum, never zero.
        expect(pool.compressionConcurrency()).toBe(4);
        h.memoryBytes = 8 * 1024 * 1024 * 1024;
        expect(pool.compressionConcurrency()).toBe(2);
        h.memoryBytes = 2 * 1024 * 1024 * 1024;
        expect(pool.compressionConcurrency()).toBe(1);

        // The core count still binds on its own.
        h.memoryBytes = 32 * 1024 * 1024 * 1024;
        h.cores = 2;
        expect(pool.compressionConcurrency()).toBe(2);
    });

    it("takes more of a desktop machine than of a server", async () => {
        const pool = await import("./image_worker_pool.js");
        const versions = process.versions as { electron?: string };

        // Same machine, both readings: a server holds back to a handful whatever it is running on,
        // where the desktop app takes a core per worker and leaves one for the thread handing them
        // out — the machine belongs to the person waiting for the run.
        h.cores = 12;
        h.memoryBytes = 64 * 1024 * 1024 * 1024;
        expect(pool.compressionConcurrency()).toBe(4);

        versions.electron = "38.0.0";

        try {
            expect(pool.compressionConcurrency()).toBe(11);

            // Memory still has the last word, whoever's machine it is: twelve cores buy nothing on
            // a box that cannot hold twelve of these heaps.
            h.memoryBytes = 8 * 1024 * 1024 * 1024;
            expect(pool.compressionConcurrency()).toBe(2);
        } finally {
            delete versions.electron;
        }
    });
    it("compresses in this process when no worker entry point exists, saying so once", async () => {
        h.exists = () => false;
        const pool = await import("./image_worker_pool.js");

        expect(pool.compressionConcurrency()).toBe(1);
        await expect(pool.compressInWorker(BYTES, REQUEST, 1024)).resolves.toBeNull();
        await expect(pool.compressInWorker(BYTES, REQUEST, 1024)).resolves.toBeNull();

        expect(h.forked).toHaveLength(0);
        expect(h.logs).toEqual([
            "Image Compression Tool: compressing in this process because no worker entry point was found."
        ]);
    });

    it("starts a bundled worker without this process's loader flags, and a source one with them", async () => {
        h.exists = (file) => file.endsWith("image_worker.cjs");
        const bundled = await import("./image_worker_pool.js");
        void bundled.compressInWorker(BYTES, REQUEST, 1024);
        await flush();
        expect(h.forkOptions[0].execArgv).toEqual([ "--max-old-space-size=2048" ]);

        vi.resetModules();
        h.exists = (file) => file.endsWith("image_worker.ts");
        const fromSource = await import("./image_worker_pool.js");
        void fromSource.compressInWorker(BYTES, REQUEST, 1024);
        await flush();
        expect(h.forkOptions[1].execArgv).toEqual([ ...process.execArgv, "--max-old-space-size=2048" ]);
    });

    it("compresses in this process when a worker cannot even be forked", async () => {
        h.forkError = new Error("spawn EMFILE");
        const pool = await import("./image_worker_pool.js");

        await expect(pool.compressInWorker(BYTES, REQUEST, 1024)).resolves.toBeNull();
        expect(h.logs).toContain(
            "Image Compression Tool: compressing in this process because they could not be started (spawn EMFILE).");
    });

    it("reuses a free worker, hands it straight to an image queued for it, and traces when asked", async () => {
        vi.stubEnv("TRILIUM_IMAGE_WORKER_DEBUG", "1");
        h.cores = 1;
        const pool = await import("./image_worker_pool.js");

        try {
            const first = pool.compressInWorker(BYTES, REQUEST, 1024);
            await flush();
            const child = h.forked[0];
            child.emit("message", { trace: "loaded and listening" });
            await flush();

            const queued = pool.compressInWorker(BYTES, REQUEST, 1024);
            await flush();
            answer(child, 0, { outcome: { compressed: false, reason: "no-gain" }, logs: [ "decoded in 5ms" ] });
            await expect(first).resolves.toEqual({ compressed: false, reason: "no-gain" });
            await flush();

            // The queued image went to the same process the moment it came free.
            expect(child.sent).toHaveLength(2);
            // A response without an outcome is read as no worker answer at all.
            answer(child, 1, { logs: [] });
            await expect(queued).resolves.toBeNull();

            // Now idle, the worker takes the next image without a new process being started.
            const third = pool.compressInWorker(BYTES, REQUEST, 1024);
            await flush();
            expect(h.forked).toHaveLength(1);
            answer(child, 2, { outcome: { compressed: false, reason: "no-gain" }, logs: [] });
            await expect(third).resolves.toEqual({ compressed: false, reason: "no-gain" });

            expect(h.logs).toContain("Image Compression Tool: loaded and listening");
            expect(h.logs).toContain("decoded in 5ms");
            expect(h.logs.some((line) => line.includes("sending image #1 (3 bytes) to worker 4000"))).toBe(true);
            expect(h.logs.some((line) => line.includes("worker 4000 answered image #1"))).toBe(true);
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it("fails an image its worker reports an error for, and retires that worker", async () => {
        const pool = await import("./image_worker_pool.js");
        const image = pool.compressInWorker(BYTES, REQUEST, 1024);
        await flush();
        const child = h.forked[0];
        child.emit("message", { trace: "loaded and listening" });
        await flush();

        answer(child, 0, { error: "Maximum memory usage exceeded", logs: [] });

        await expect(image).rejects.toThrow("Maximum memory usage exceeded");
        expect(child.killed).toBe(true);
    });

    it("fails an image whose message the channel would not take", async () => {
        const pool = await import("./image_worker_pool.js");
        const image = pool.compressInWorker(BYTES, REQUEST, 1024);
        await flush();
        const child = h.forked[0];
        child.sendError = new Error("Channel closed");
        child.emit("message", { trace: "loaded and listening" });

        await expect(image).rejects.toThrow("Channel closed");
    });

    it("gives up on workers when the first one errors before it speaks", async () => {
        const pool = await import("./image_worker_pool.js");
        const image = pool.compressInWorker(BYTES, REQUEST, 1024);
        await flush();

        h.forked[0].emit("error", "spawn UNKNOWN\n    at ChildProcess.spawn");

        await expect(image).resolves.toBeNull();
        expect(h.logs).toContain("Image Compression Tool: worker 4000 errored: spawn UNKNOWN");
        expect(h.logs).toContain(
            "Image Compression Tool: compressing in this process because they do not work here (spawn UNKNOWN).");
    });

    describe("deadlines", () => {
        beforeEach(() => {
            vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("gives up on a worker that does not come up in time, and on workers with it", async () => {
            const pool = await import("./image_worker_pool.js");
            const image = pool.compressInWorker(BYTES, REQUEST, 1024);
            await flush();

            vi.advanceTimersByTime(30 * 1000);

            await expect(image).resolves.toBeNull();
            expect(h.logs).toContain(
                "Image Compression Tool: worker 4000 did not come up within 30000ms; giving up on it");
            expect(h.forked[0].killed).toBe(true);
        });

        it("fails an image whose worker stops answering", async () => {
            const pool = await import("./image_worker_pool.js");
            const image = pool.compressInWorker(BYTES, REQUEST, 1024);
            await flush();
            h.forked[0].emit("message", { trace: "loaded and listening" });
            await flush();

            vi.advanceTimersByTime(15 * 60 * 1000);

            await expect(image).rejects.toThrow("Image worker did not answer in time.");
            expect(h.logs.some((line) => line.startsWith("Image Compression Tool: worker 4000 did not answer for image #")))
                .toBe(true);
        });
    });

    it("tells a worker it stopped apart from one that died while idle", async () => {
        const pool = await import("./image_worker_pool.js");

        /** Runs one image to completion, leaving its worker idle in the pool. */
        async function runOne() {
            const image = pool.compressInWorker(BYTES, REQUEST, 1024);
            await flush();
            const child = h.forked[h.forked.length - 1];
            child.emit("spawn");
            child.emit("message", { trace: "loaded and listening" });
            await flush();
            answer(child, child.sent.length - 1, { outcome: { compressed: false, reason: "no-gain" }, logs: [] });
            await image;
            return child;
        }

        const stopped = await runOne();
        pool.shutdownImageWorkers();
        expect(stopped.killed).toBe(true);
        stopped.emit("exit", null, "SIGTERM");
        expect(h.logs).toContain("Image Compression Tool: worker 4000 stopped");

        const died = await runOne();
        expect(died.pid).toBe(4001);
        died.emit("exit", null, "SIGKILL");
        expect(h.logs).toContain("Image Compression Tool: worker 4001 exited unexpectedly with code SIGKILL while idle");
        expect(h.logs.some((line) => /^Image Compression Tool: worker 4000 online in \d+ms$/.test(line))).toBe(true);

        // Killed by a signal mid-image, the worker takes only that image with it.
        const image = pool.compressInWorker(BYTES, REQUEST, 1024);
        await flush();
        const killed = h.forked[h.forked.length - 1];
        killed.emit("message", { trace: "loaded and listening" });
        await flush();
        killed.emit("exit", null, "SIGKILL");
        await expect(image).rejects.toThrow("Image worker exited with code SIGKILL.");
        expect(h.logs).toContain(
            `Image Compression Tool: worker ${killed.pid} exited unexpectedly with code SIGKILL while working on an image`);
    });

    describe("a worker that dies while idle", () => {
        const NO_GAIN = { compressed: false, reason: "no-gain" };

        /** Runs one image to completion on a pool of one worker, leaving that worker idle. */
        async function idleWorker(pool: typeof import("./image_worker_pool.js")) {
            h.cores = 1;

            const image = pool.compressInWorker(BYTES, REQUEST, 1024);

            await flush();

            const child = h.forked[0];

            child.emit("message", { trace: "loaded and listening" });
            await flush();
            answer(child, 0, { outcome: NO_GAIN, logs: [] });
            await expect(image).resolves.toEqual(NO_GAIN);

            return child;
        }

        it("is replaced by a fresh worker for the next image", async () => {
            const pool = await import("./image_worker_pool.js");
            const dead = await idleWorker(pool);

            dead.emit("exit", null, "SIGKILL");

            const next = pool.compressInWorker(BYTES, REQUEST, 1024);

            await flush();
            expect(dead.sent).toHaveLength(1);
            expect(h.forked).toHaveLength(2);

            const fresh = h.forked[1];

            fresh.emit("message", { trace: "loaded and listening" });
            await flush();
            answer(fresh, 0, { outcome: NO_GAIN, logs: [] });
            await expect(next).resolves.toEqual(NO_GAIN);
        });

        it("is passed over once its channel has closed, and its late exit frees no extra place", async () => {
            const pool = await import("./image_worker_pool.js");
            const dead = await idleWorker(pool);

            // Node closes the channel and reports the exit in separate callbacks.
            dead.connected = false;

            const next = pool.compressInWorker(BYTES, REQUEST, 1024);

            await flush();
            expect(dead.sent).toHaveLength(1);
            expect(h.forked).toHaveLength(2);

            const fresh = h.forked[1];

            fresh.emit("message", { trace: "loaded and listening" });
            await flush();

            // With one worker allowed and the fresh one busy, the next image queues for it.
            dead.emit("exit", null, "SIGKILL");

            const queued = pool.compressInWorker(BYTES, REQUEST, 1024);

            await flush();
            expect(h.forked).toHaveLength(2);

            answer(fresh, 0, { outcome: NO_GAIN, logs: [] });
            await expect(next).resolves.toEqual(NO_GAIN);
            await flush();
            answer(fresh, 1, { outcome: NO_GAIN, logs: [] });
            await expect(queued).resolves.toEqual(NO_GAIN);
        });
    });
});

/** Answers the `index`th image sent to `child` with `response`. */
function answer(child: (typeof h.forked)[number], index: number, response: Record<string, unknown>) {
    child.emit("message", { id: (child.sent[index] as { id: number }).id, ...response });
}
