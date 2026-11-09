import type { BeccaReplicaSink } from "@triliumnext/core";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
    let loaded: () => void = () => {};
    return {
        setBeccaReplicaSink: vi.fn(),
        beccaLoaded: new Promise<void>((resolve) => {
            loaded = resolve;
        }),
        load: () => loaded(),
        replica: {
            start: vi.fn(), run: vi.fn(), shutdown: vi.fn(), onCommit() {}, onReload() {}, onProtectedSession() {}
        },
        contentJobs: { concurrency: 4, run: vi.fn(), shutdown: vi.fn() },
        shutdownImageWorkers: vi.fn()
    };
});

vi.mock("@triliumnext/core", () => ({
    setBeccaReplicaSink: h.setBeccaReplicaSink,
    becca_loader: { beccaLoaded: h.beccaLoaded },
    getLog: () => ({ info() {}, error() {} })
}));
vi.mock("./search_replica/replica_client.js", () => ({ createReplicaSearchExecutor: () => h.replica }));
vi.mock("./workers/content_job_executor.js", () => ({ createPooledContentJobExecutor: () => h.contentJobs }));
vi.mock("./image_worker_pool.js", () => ({ shutdownImageWorkers: h.shutdownImageWorkers }));

import { applyPostInit, createCoreExtensions, shutdownWorkers, startSearchReplica } from "./core_extensions.js";

describe("core extensions", () => {
    it("supplies the content-job executor and the search replica, wired only once becca has loaded", async () => {
        const extensions = createCoreExtensions();

        expect(typeof extensions.contentJobs.run).toBe("function");
        expect(extensions.contentJobs.concurrency).toBeGreaterThanOrEqual(1);
        expect(extensions.search).toBe(h.replica);
        expect(extensions.replicaSink).toBe(h.replica);

        applyPostInit({ ...extensions, replicaSink: undefined });
        applyPostInit(extensions);
        startSearchReplica();
        await Promise.resolve();
        expect(h.setBeccaReplicaSink).not.toHaveBeenCalled();
        expect(h.replica.start).not.toHaveBeenCalled();

        h.load();
        await h.beccaLoaded;
        await Promise.resolve();

        expect(h.setBeccaReplicaSink).toHaveBeenCalledTimes(1);
        expect(h.setBeccaReplicaSink).toHaveBeenCalledWith(h.replica satisfies BeccaReplicaSink);
        expect(h.replica.start).toHaveBeenCalledTimes(1);
    });

    it("starts the replica only once the spawner can start processes", async () => {
        const { setWorkerSpawner } = await import("./workers/worker_host.js");
        let markReady = () => {};

        setWorkerSpawner(() => {
            throw new Error("not called");
        }, new Promise<void>((resolve) => {
            markReady = resolve;
        }));

        try {
            createCoreExtensions();
            h.replica.start.mockClear();
            h.load();
            startSearchReplica();
            await new Promise((resolve) => setImmediate(resolve));
            expect(h.replica.start).not.toHaveBeenCalled();

            markReady();
            await new Promise((resolve) => setImmediate(resolve));
            expect(h.replica.start).toHaveBeenCalledTimes(1);
        } finally {
            setWorkerSpawner(null);
        }
    });

    it("stops the replica and every pool's workers on shutdown", () => {
        createCoreExtensions();
        shutdownWorkers();

        expect(h.replica.shutdown).toHaveBeenCalledTimes(1);
        expect(h.contentJobs.shutdown).toHaveBeenCalledTimes(1);
        expect(h.shutdownImageWorkers).toHaveBeenCalledTimes(1);
    });
});
