import type { SqlService } from "./sql";

let sql: SqlService | null = null;

export async function initSql(instance: SqlService) {
    if (sql) throw new Error("SQL already initialized");
    sql = instance;
    const sql_init = (await import("../sql_init.js")).default;
    sql_init.initializeDb();
}

export function getSql(): SqlService {
    if (!sql) throw new Error("SQL not initialized");
    return sql;
}
