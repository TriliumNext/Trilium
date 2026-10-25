/**
 * The Node implementations of core's off-thread seams, shared by the two boots that call
 * `initializeCore()`: the server's `core_init.ts` and the desktop's `main.ts`.
 */

import {
    type BeccaReplicaSink,
    becca_loader,
    type ContentJobExecutor,
    type SearchExecutor,
    setBeccaReplicaSink
} from "@triliumnext/core";

import { createReplicaSearchExecutor, type ReplicaSearchExecutor } from "./search_replica/replica_client.js";
import { createPooledContentJobExecutor } from "./workers/content_job_executor.js";
import { spawnerPending } from "./workers/worker_host.js";

export interface CoreExtensions {
    /** Passed to `initializeCore()` as `contentJobs`. */
    contentJobs: ContentJobExecutor;
    /** Passed to `initializeCore()` as `search`; core searches in-process when unset. */
    search?: SearchExecutor;
    /** Receives becca's commits and reloads once core is up; see {@link applyPostInit}. */
    replicaSink?: BeccaReplicaSink;
}

/**
 * Creates the extensions. Nothing here starts a process: content workers start on first use, and
 * the search replica on {@link startSearchReplica}.
 */
export function createCoreExtensions(): CoreExtensions {
    searchReplica = createReplicaSearchExecutor();

    return {
        contentJobs: createPooledContentJobExecutor(),
        search: searchReplica,
        replicaSink: searchReplica
    };
}

/**
 * Wires the parts of the extensions that need an initialized core. Call after `initializeCore()`.
 *
 * The sink is registered once becca has first loaded, so that the startup load does not reach the
 * replica as a reload.
 */
export function applyPostInit({ replicaSink }: CoreExtensions) {
    if (replicaSink) {
        void becca_loader.beccaLoaded.then(() => setBeccaReplicaSink(replicaSink));
    }
}

/**
 * Starts the search replica once becca has loaded, which on a database still being set up is only
 * after the setup. Called once the app is ready to serve, so the replica's boot does not compete
 * with the main process's.
 */
export function startSearchReplica() {
    const replica = searchReplica;

    if (replica) {
        void Promise.all([ becca_loader.beccaLoaded, spawnerPending() ]).then(() => replica.start());
    }
}

let searchReplica: ReplicaSearchExecutor | null = null;
