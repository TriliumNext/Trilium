import { getContext } from "../context.js";
import type { SqlService } from "./sql";

/**
 * Registry of SQL instances keyed by database ID.
 * The default instance (no dbId) is used for single-database mode,
 * server mode, standalone, and tests.
 */
const sqlInstances = new Map<string, SqlService>();
let defaultSql: SqlService | null = null;

/**
 * Initialize a SQL service instance. When `dbId` is provided, the instance
 * is registered in the multi-database registry. Without `dbId`, it becomes
 * the default (backwards-compatible) instance.
 */
export async function initSql(instance: SqlService, dbId?: string) {
    if (dbId) {
        sqlInstances.set(dbId, instance);
    } else {
        if (defaultSql) throw new Error("SQL already initialized");
        defaultSql = instance;
    }
    const sql_init = (await import("../sql_init.js")).default;
    sql_init.initializeDb(dbId);
}

/**
 * Get the SQL service for the current execution context.
 * Reads `dbId` from CLS; falls back to the default instance.
 */
export function getSql(): SqlService {
    try {
        const dbId = getContext().get<string>("dbId");
        if (dbId) {
            const instance = sqlInstances.get(dbId);
            if (instance) return instance;
        }
    } catch {
        // No CLS context (startup, module-level code) — use default.
    }
    if (!defaultSql) throw new Error("SQL not initialized");
    return defaultSql;
}

/**
 * Remove a SQL instance from the registry. Call after closing the database.
 */
export function disposeSql(dbId: string) {
    sqlInstances.delete(dbId);
}
