/**
 * The messages between the main process and the search replica, shared by both sides so that
 * neither imports the other.
 */

import type {
    CoreConfig, EntityChangeRef, SearchQueryArgs, SearchQueryError, SearchQueryKind
} from "@triliumnext/core";

/** The environment variable that carries {@link ReplicaBootOptions} as JSON. */
export const REPLICA_OPTIONS_ENV = "TRILIUM_SEARCH_REPLICA_OPTIONS";

/** What the main process tells the replica at spawn. */
export interface ReplicaBootOptions {
    documentPath: string;
    /** The main process's core config; the replica forces `General.readOnly` on. */
    config: CoreConfig;
}

/** A message from the main process. */
export type ReplicaRequest =
    | { type: "commit"; changes: EntityChangeRef[] }
    | { type: "reload" }
    | { type: "protectedSession"; dataKey: Uint8Array | null }
    | { type: "query"; id: number; kind: SearchQueryKind; args: SearchQueryArgs[SearchQueryKind] };

/** A message to the main process. */
export type ReplicaReply =
    | { type: "log"; level: "info" | "error"; message: string }
    | { type: "ready"; noteCount: number; heapUsedMb: number; bootMs: number }
    | { type: "failed"; reason: string }
    | { type: "result"; id: number; result: unknown }
    | { type: "error"; id: number; error: SearchQueryError };
