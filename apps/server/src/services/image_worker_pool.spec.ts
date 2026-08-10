import type { ImageCompressionRequest } from "@triliumnext/core/src/services/image_provider.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
            (this.handlers.get(event) ?? []).forEach((handler) => handler(...args));
        }

        send(message: unknown, callback?: (error: Error | null) => void) {
            this.sent.push(message);
            callback?.(null);

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

    return {
        forked,
        forkOptions,
        // What the fake machine has; individual tests shrink these to watch the pool follow.
        cores: 8,
        memoryBytes: 32 * 1024 * 1024 * 1024,
        fork(file: string, options: { serialization?: string; execArgv?: string[] }) {
            void file;
            forkOptions.push(options);

            const child = new FakeChild(4000 + forked.length);

            forked.push(child);

            return child;
        }
    };
});

vi.mock("node:child_process", () => ({ fork: h.fork }));
vi.mock("node:os", () => ({ availableParallelism: () => h.cores, totalmem: () => h.memoryBytes }));
vi.mock("@triliumnext/core", () => ({ getLog: () => ({ info() {}, error() {} }) }));

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
});
