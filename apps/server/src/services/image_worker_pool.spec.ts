import type { ImageCompressionRequest } from "@triliumnext/core/src/services/image_provider.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkerHandle, WorkerSpawnOptions } from "./workers/worker_host.js";

/**
 * The pool's failure semantics, with the processes themselves faked out: what separates "this
 * installation cannot run workers, stop trying" from "this one image killed its worker, fail it
 * alone". Getting that line wrong in the second direction hands the poison image to the thread
 * serving the application — the freeze the pool exists to prevent.
 */
const h = vi.hoisted(() => ({
    // What the fake machine has; individual tests shrink these to watch the pool follow.
    cores: 8,
    memoryBytes: 32 * 1024 * 1024 * 1024,
    resizeInProcess: vi.fn()
}));

vi.mock("node:os", () => ({ availableParallelism: () => h.cores, totalmem: () => h.memoryBytes }));
vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ info() {}, error() {} }),
    imageCompressionService: {},
    options: {}
}));
vi.mock("./image_codec.js", () => ({
    compressImageBytes: vi.fn(),
    DECODE_MEMORY_MB: 1024,
    decodeCostOf: vi.fn(),
    detectSvg: vi.fn(),
    getImageTypeFromBuffer: vi.fn(),
    planFromBytes: vi.fn(),
    resizePreviewImage: h.resizeInProcess
}));

type Listener = (...args: unknown[]) => void;

class FakeChild implements WorkerHandle {
    sent: { id: number; request: unknown }[] = [];
    killed = false;
    private handlers = new Map<string, Listener[]>();

    constructor(readonly pid: number) {}

    on(event: string, handler: (...args: never[]) => void) {
        this.handlers.set(event, [ ...(this.handlers.get(event) ?? []), handler as Listener ]);
    }

    emit(event: string, ...args: unknown[]) {
        for (const handler of this.handlers.get(event) ?? []) {
            handler(...args);
        }
    }

    postMessage(message: unknown) {
        this.sent.push(message as { id: number; request: unknown });
    }

    kill() {
        this.killed = true;
    }

    unref() {}
}

const forked: FakeChild[] = [];
const spawnOptions: WorkerSpawnOptions[] = [];

const REQUEST: ImageCompressionRequest = {
    resize: true,
    maxWidthHeight: 800,
    jpegHandling: "compress",
    pngHandling: "optimize",
    quality: 75,
    conversionQuality: 85
};

const BYTES = new Uint8Array([ 1, 2, 3 ]);
const PREVIEW = { maxEdge: 256, jpegQuality: 75 };
const UNDECODABLE = { resized: false, reason: "undecodable" };

/** Lets the pool's ready-gate promise chain and send callbacks run to completion. */
async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
    vi.resetModules();
    forked.length = 0;
    spawnOptions.length = 0;

    // Registered on the fresh worker_host instance the pool is about to import.
    const host = await import("./workers/worker_host.js");

    host.setWorkerSpawner((file, options) => {
        spawnOptions.push(options);

        const child = new FakeChild(4000 + forked.length);

        forked.push(child);

        return child;
    });
    h.cores = 8;
    h.memoryBytes = 32 * 1024 * 1024 * 1024;
});

describe("worker pool failure semantics", () => {
    it("fails a poison image alone once any worker has announced, and replaces its worker", async () => {
        const pool = await import("./image_worker_pool.js");
        const first = pool.compressInWorker(BYTES, REQUEST, 1024);

        await flush();

        const child = forked[0];

        expect(child).toBeDefined();
        expect(spawnOptions[0].execArgv).toContain("--max-old-space-size=2048");

        // The image goes out only once the child has provably attached its listener.
        expect(child.sent).toHaveLength(0);
        child.emit("message", { trace: "worker 4000: loaded and listening" });
        await flush();
        expect(child.sent).toHaveLength(1);
        expect(child.sent[0].request).toEqual({ kind: "compress", buffer: BYTES, request: REQUEST, budgetMb: 1024 });

        // The decode takes the worker down mid-image: the image fails, the pool does not.
        child.emit("exit", 1);
        await expect(first).rejects.toThrow("exited with code 1");
        expect(child.killed).toBe(true);

        const second = pool.compressInWorker(BYTES, REQUEST, 1024);

        await flush();

        const replacement = forked[1];

        expect(replacement).toBeDefined();
        replacement.emit("message", { trace: "worker 4001: loaded and listening" });
        await flush();
        replacement.emit("message", { id: replacement.sent[0].id, result: { compressed: false, reason: "no-gain" }, logs: [] });
        await expect(second).resolves.toMatchObject({ compressed: false, reason: "no-gain" });
    });

    it("resizes link previews in their own worker, which compression never holds up", async () => {
        h.cores = 1;

        const pool = await import("./image_worker_pool.js");
        const compressing = pool.compressInWorker(BYTES, REQUEST, 1024);

        await flush();
        forked[0].emit("message", { trace: "worker 4000: loaded and listening" });
        await flush();
        expect(forked[0].sent).toHaveLength(1);

        const resized = pool.resizePreviewInWorker(BYTES, PREVIEW);

        await flush();
        expect(forked).toHaveLength(2);

        const previewWorker = forked[1];

        expect(spawnOptions[1].execArgv).toContain("--max-old-space-size=512");
        previewWorker.emit("message", { trace: "worker 4001: loaded and listening" });
        await flush();
        expect(previewWorker.sent[0].request).toEqual({
            kind: "preview", bytes: BYTES, request: PREVIEW, budgetMb: 256
        });
        previewWorker.emit("message", {
            id: previewWorker.sent[0].id,
            result: { resized: true, bytes: BYTES },
            logs: []
        });
        await expect(resized).resolves.toEqual({ resized: true, bytes: BYTES });

        const compressionSettled = vi.fn();

        compressing.then(compressionSettled, compressionSettled);
        await flush();
        expect(compressionSettled).not.toHaveBeenCalled();
    });

    describe("what a link preview resize answers", () => {
        /** Starts a resize through the provider and brings up the preview worker. */
        async function resizeInWorker() {
            const { serverImageProvider } = await import("./image_provider.js");
            const resized = serverImageProvider.resizeForPreview(BYTES, PREVIEW);

            await flush();

            const worker = forked[0];

            worker.emit("message", { trace: "worker 4000: loaded and listening" });
            await flush();

            return { resized, worker };
        }

        beforeEach(() => {
            h.resizeInProcess.mockReset();
        });

        it("answers undecodable for any failure in a worker, without decoding here", async () => {
            const decodeFailure = await resizeInWorker();

            decodeFailure.worker.emit("message", {
                id: decodeFailure.worker.sent[0].id,
                result: UNDECODABLE,
                logs: []
            });
            await expect(decodeFailure.resized).resolves.toEqual(UNDECODABLE);

            const thrown = await resizeInWorker();

            thrown.worker.emit("message", {
                id: thrown.worker.sent[1].id,
                error: "Error: boom",
                logs: []
            });
            await expect(thrown.resized).resolves.toEqual(UNDECODABLE);

            const crashed = await resizeInWorker();

            crashed.worker.emit("exit", 134);
            await expect(crashed.resized).resolves.toEqual(UNDECODABLE);
            expect(h.resizeInProcess).not.toHaveBeenCalled();
        });

        it("resizes here when there are no workers, and lets that resize throw", async () => {
            const { serverImageProvider } = await import("./image_provider.js");

            h.resizeInProcess.mockResolvedValueOnce({ resized: true, bytes: BYTES });

            const first = serverImageProvider.resizeForPreview(BYTES, PREVIEW);

            await flush();
            forked[0].emit("exit", 127);
            await expect(first).resolves.toEqual({ resized: true, bytes: BYTES });

            h.resizeInProcess.mockRejectedValueOnce(new Error("codec bug"));
            await expect(serverImageProvider.resizeForPreview(BYTES, PREVIEW))
                .rejects.toThrow("codec bug");
            expect(h.resizeInProcess).toHaveBeenCalledTimes(2);
        });
    });

    it("gives up on workers for good only when none has ever spoken", async () => {
        const pool = await import("./image_worker_pool.js");
        const first = pool.compressInWorker(BYTES, REQUEST, 1024);

        await flush();
        // Dead before its announce: nothing has proven workers can run here at all.
        forked[0].emit("exit", 127);

        await expect(first).resolves.toBeNull();

        // Disabled: the next image is answered without so much as a spawn attempt.
        await expect(pool.compressInWorker(BYTES, REQUEST, 1024)).resolves.toBeNull();
        expect(forked).toHaveLength(1);
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
            expect(forked).toHaveLength(1);

            return { running, queued };
        }

        it("answers all of them when workers are given up on, rather than leaving them waiting", async () => {
            const pool = await import("./image_worker_pool.js");
            const { running, queued } = await queueBehind(pool, 3);

            // Dead before it ever spoke, so this installation is taken to have no workers at all.
            // The one being run is answered by its own call; the queued ones are answered by
            // nothing unless giving up says so.
            forked[0].emit("exit", 127);

            await expect(running).resolves.toBeNull();
            await expect(Promise.all(queued)).resolves.toEqual([ null, null, null ]);
        });

        it("starts a replacement for one that dies, so the queue behind it moves", async () => {
            const pool = await import("./image_worker_pool.js");
            const { running, queued } = await queueBehind(pool, 1);
            const worker = forked[0];

            worker.emit("message", { trace: "worker 4000: loaded and listening" });
            await flush();
            // Taken down by the image it was given, having already proven workers run here.
            worker.emit("exit", 1);
            await expect(running).rejects.toThrow("exited with code 1");
            await flush();

            // The capacity it held is free again, and the image queued for it gets a process rather
            // than a wait with nothing left to end it.
            expect(forked).toHaveLength(2);

            const replacement = forked[1];

            replacement.emit("message", { trace: "worker 4001: loaded and listening" });
            await flush();
            replacement.emit("message", {
                id: replacement.sent[0].id,
                result: { compressed: false, reason: "no-gain" },
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
