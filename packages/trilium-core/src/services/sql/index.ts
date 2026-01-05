import type { SqlService } from "./sql";

let sql: SqlService | null = null;

export function initSql(instance: SqlService) {
    if (sql) throw new Error("SQL already initialized");
    sql = instance;
}

export function getSql(): SqlService {
    if (!sql) throw new Error("SQL not initialized");
    return sql;
}
