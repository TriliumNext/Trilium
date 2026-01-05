import fs from "fs";

import becca_loader from "../becca/becca_loader.js";
import cls from "./cls.js";
import config from "./config.js";
import dataDir from "./data_dir.js";
import entity_changes from "./entity_changes.js";
import log from "./log.js";
import BetterSqlite3Provider from "./sql_nodejs.js";
import ws from "./ws.js";

type Params = any;

export interface Statement {
    run(...params: Params): RunResult;
    get(params: Params): unknown;
    all(...params: Params): unknown[];
    iterate(...params: Params): IterableIterator<unknown>;
    raw(toggleState?: boolean): this;
    pluck(toggleState?: boolean): this;
}

export interface Transaction {
    deferred(): void;
}

export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
}

export interface DatabaseProvider {
    loadFromFile(path: string, isReadOnly: boolean): void;
    loadFromMemory(): void;
    loadFromBuffer(buffer: NonSharedBuffer): void;
    backup(destinationFile: string): void;
    prepare(query: string): Statement;
    transaction<T>(func: (statement: Statement) => T): Transaction;
    get inTransaction(): boolean;
    exec(query: string): void;
    close(): void;
}

const dbConnection: DatabaseProvider = new BetterSqlite3Provider();
let statementCache: Record<string, Statement> = {};

function buildDatabase() {
    // for integration tests, ignore the config's readOnly setting
    if (process.env.TRILIUM_INTEGRATION_TEST === "memory") {
        buildIntegrationTestDatabase();
    } else if (process.env.TRILIUM_INTEGRATION_TEST === "memory-no-store") {
        dbConnection.loadFromMemory();
    }

    dbConnection.loadFromFile(dataDir.DOCUMENT_PATH, config.General.readOnly);
}

buildDatabase();

function buildIntegrationTestDatabase(dbPath?: string) {
    const buffer = fs.readFileSync(dbPath ?? dataDir.DOCUMENT_PATH);
    dbConnection.loadFromBuffer(buffer);
}

function rebuildIntegrationTestDatabase(dbPath?: string) {
    if (dbConnection) {
        dbConnection.close();
    }

    // This allows a database that is read normally but is kept in memory and discards all modifications.
    buildIntegrationTestDatabase(dbPath);
    statementCache = {};
}

const LOG_ALL_QUERIES = false;

function insert<T extends {}>(tableName: string, rec: T, replace = false) {
    const keys = Object.keys(rec || {});
    if (keys.length === 0) {
        log.error(`Can't insert empty object into table ${tableName}`);
        return;
    }

    const columns = keys.join(", ");
    const questionMarks = keys.map((p) => "?").join(", ");

    const query = `INSERT
    ${replace ? "OR REPLACE" : ""} INTO
    ${tableName}
    (
    ${columns}
    )
    VALUES (${questionMarks})`;

    const res = execute(query, Object.values(rec));

    return res ? res.lastInsertRowid : null;
}

function replace<T extends {}>(tableName: string, rec: T): number | null {
    return insert(tableName, rec, true) as number | null;
}

function upsert<T extends {}>(tableName: string, primaryKey: string, rec: T) {
    const keys = Object.keys(rec || {});
    if (keys.length === 0) {
        log.error(`Can't upsert empty object into table ${tableName}`);
        return;
    }

    const columns = keys.join(", ");

    const questionMarks = keys.map((colName) => `@${colName}`).join(", ");

    const updateMarks = keys.map((colName) => `${colName} = @${colName}`).join(", ");

    const query = `INSERT INTO ${tableName} (${columns}) VALUES (${questionMarks})
                    ON CONFLICT (${primaryKey}) DO UPDATE SET ${updateMarks}`;

    for (const idx in rec) {
        if (rec[idx] === true || rec[idx] === false) {
            (rec as any)[idx] = rec[idx] ? 1 : 0;
        }
    }

    execute(query, rec);
}

/**
 * For the given SQL query, returns a prepared statement. For the same query (string comparison), the same statement is returned.
 *
 * @param sql the SQL query for which to return a prepared statement.
 * @param isRaw indicates whether `.raw()` is going to be called on the prepared statement in order to return the raw rows (e.g. via {@link getRawRows()}). The reason is that the raw state is preserved in the saved statement and would break non-raw calls for the same query.
 * @returns the corresponding {@link Statement}.
 */
function stmt(sql: string, isRaw?: boolean) {
    const key = (isRaw ? `raw/${sql}` : sql);

    if (!(key in statementCache)) {
        statementCache[key] = dbConnection.prepare(sql);
    }

    return statementCache[key];
}

function getRow<T>(query: string, params: Params = []): T {
    return wrap(query, (s) => s.get(params)) as T;
}

function getRowOrNull<T>(query: string, params: Params = []): T | null {
    const all = getRows(query, params);
    if (!all) {
        return null;
    }

    return (all.length > 0 ? all[0] : null) as T | null;
}

function getValue<T>(query: string, params: Params = []): T {
    return wrap(query, (s) => s.pluck().get(params)) as T;
}

// smaller values can result in better performance due to better usage of statement cache
const PARAM_LIMIT = 100;

function getManyRows<T>(query: string, params: Params): T[] {
    let results: unknown[] = [];

    while (params.length > 0) {
        const curParams = params.slice(0, Math.min(params.length, PARAM_LIMIT));
        params = params.slice(curParams.length);

        const curParamsObj: Record<string, any> = {};

        let j = 1;
        for (const param of curParams) {
            curParamsObj[`param${j++}`] = param;
        }

        let i = 1;
        const questionMarks = curParams.map(() => `:param${i++}`).join(",");
        const curQuery = query.replace(/\?\?\?/g, questionMarks);

        const statement = curParams.length === PARAM_LIMIT ? stmt(curQuery) : dbConnection.prepare(curQuery);

        const subResults = statement.all(curParamsObj);
        results = results.concat(subResults);
    }

    return (results as T[] | null) || [];
}

function getRows<T>(query: string, params: Params = []): T[] {
    return wrap(query, (s) => s.all(params)) as T[];
}

function getRawRows<T extends {} | unknown[]>(query: string, params: Params = []): T[] {
    return (wrap(query, (s) => s.raw().all(params), true) as T[]) || [];
}

function iterateRows<T>(query: string, params: Params = []): IterableIterator<T> {
    if (LOG_ALL_QUERIES) {
        console.log(query);
    }

    return stmt(query).iterate(params) as IterableIterator<T>;
}

function getMap<K extends string | number | symbol, V>(query: string, params: Params = []) {
    const map: Record<K, V> = {} as Record<K, V>;
    const results = getRawRows<[K, V]>(query, params);

    for (const row of results || []) {
        map[row[0]] = row[1];
    }

    return map;
}

function getColumn<T>(query: string, params: Params = []): T[] {
    return wrap(query, (s) => s.pluck().all(params)) as T[];
}

function execute(query: string, params: Params = []): RunResult {
    if (config.General.readOnly && (query.startsWith("UPDATE") || query.startsWith("INSERT") || query.startsWith("DELETE"))) {
        log.error(`read-only DB ignored: ${query} with parameters ${JSON.stringify(params)}`);
        return {
            changes: 0,
            lastInsertRowid: 0
        };
    }
    return wrap(query, (s) => s.run(params)) as RunResult;
}

function executeMany(query: string, params: Params) {
    if (LOG_ALL_QUERIES) {
        console.log(query);
    }

    while (params.length > 0) {
        const curParams = params.slice(0, Math.min(params.length, PARAM_LIMIT));
        params = params.slice(curParams.length);

        const curParamsObj: Record<string, any> = {};

        let j = 1;
        for (const param of curParams) {
            curParamsObj[`param${j++}`] = param;
        }

        let i = 1;
        const questionMarks = curParams.map(() => `:param${i++}`).join(",");
        const curQuery = query.replace(/\?\?\?/g, questionMarks);

        dbConnection.prepare(curQuery).run(curParamsObj);
    }
}

function executeScript(query: string) {
    if (LOG_ALL_QUERIES) {
        console.log(query);
    }

    dbConnection.exec(query);
}

/**
 * @param isRaw indicates whether `.raw()` is going to be called on the prepared statement in order to return the raw rows (e.g. via {@link getRawRows()}). The reason is that the raw state is preserved in the saved statement and would break non-raw calls for the same query.
 */
function wrap(query: string, func: (statement: Statement) => unknown, isRaw?: boolean): unknown {
    const startTimestamp = Date.now();
    let result;

    if (LOG_ALL_QUERIES) {
        console.log(query);
    }

    try {
        result = func(stmt(query, isRaw));
    } catch (e: any) {
        if (e.message.includes("The database connection is not open")) {
            // this often happens on killing the app which puts these alerts in front of user
            // in these cases error should be simply ignored.
            console.log(e.message);

            return null;
        }

        throw e;
    }

    const milliseconds = Date.now() - startTimestamp;

    if (milliseconds >= 20 && !cls.isSlowQueryLoggingDisabled()) {
        if (query.includes("WITH RECURSIVE")) {
            log.info(`Slow recursive query took ${milliseconds}ms.`);
        } else {
            log.info(`Slow query took ${milliseconds}ms: ${query.trim().replace(/\s+/g, " ")}`);
        }
    }

    return result;
}

function transactional<T>(func: (statement: Statement) => T) {
    try {
        const ret = (dbConnection.transaction(func) as any).deferred();

        if (!dbConnection.inTransaction) {
            // i.e. transaction was really committed (and not just savepoint released)
            ws.sendTransactionEntityChangesToAllClients();
        }

        return ret as T;
    } catch (e) {
        console.warn("Got error ", e);
        const entityChangeIds = cls.getAndClearEntityChangeIds();

        if (entityChangeIds.length > 0) {
            log.info("Transaction rollback dirtied the becca, forcing reload.");

            becca_loader.load();
        }

        // the maxEntityChangeId has been incremented during failed transaction, need to recalculate
        entity_changes.recalculateMaxEntityChangeId();

        throw e;
    }
}

function fillParamList(paramIds: string[] | Set<string>, truncate = true) {
    if ("length" in paramIds && paramIds.length === 0) {
        return;
    }

    if (truncate) {
        execute("DELETE FROM param_list");
    }

    paramIds = Array.from(new Set(paramIds));

    if (paramIds.length > 30000) {
        fillParamList(paramIds.slice(30000), false);

        paramIds = paramIds.slice(0, 30000);
    }

    // doing it manually to avoid this showing up on the slow query list
    const s = stmt(`INSERT INTO param_list VALUES ${paramIds.map((paramId) => `(?)`).join(",")}`);

    s.run(paramIds);
}

async function copyDatabase(targetFilePath: string) {
    try {
        fs.unlinkSync(targetFilePath);
    } catch (e) { } // unlink throws exception if the file did not exist

    await dbConnection.backup(targetFilePath);
}

function disableSlowQueryLogging<T>(cb: () => T) {
    const orig = cls.isSlowQueryLoggingDisabled();

    try {
        cls.disableSlowQueryLogging(true);

        return cb();
    } finally {
        cls.disableSlowQueryLogging(orig);
    }
}

export default {
    insert,
    replace,

    /**
     * Get single value from the given query - first column from first returned row.
     *
     * @param query - SQL query with ? used as parameter placeholder
     * @param params - array of params if needed
     * @returns single value
     */
    getValue,

    /**
     * Get first returned row.
     *
     * @param query - SQL query with ? used as parameter placeholder
     * @param params - array of params if needed
     * @returns - map of column name to column value
     */
    getRow,
    getRowOrNull,

    /**
     * Get all returned rows.
     *
     * @param query - SQL query with ? used as parameter placeholder
     * @param params - array of params if needed
     * @returns - array of all rows, each row is a map of column name to column value
     */
    getRows,
    getRawRows,
    iterateRows,
    getManyRows,

    /**
     * Get a map of first column mapping to second column.
     *
     * @param query - SQL query with ? used as parameter placeholder
     * @param params - array of params if needed
     * @returns - map of first column to second column
     */
    getMap,

    /**
     * Get a first column in an array.
     *
     * @param query - SQL query with ? used as parameter placeholder
     * @param params - array of params if needed
     * @returns array of first column of all returned rows
     */
    getColumn,

    /**
     * Execute SQL
     *
     * @param query - SQL query with ? used as parameter placeholder
     * @param params - array of params if needed
     */
    execute,
    executeMany,
    executeScript,
    transactional,
    upsert,
    fillParamList,
    copyDatabase,
    disableSlowQueryLogging,
    rebuildIntegrationTestDatabase
};
