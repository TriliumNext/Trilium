"use strict";

/**
 * @module sql
 */

import log = require('./log');
import Database = require('better-sqlite3');
import dataDir = require('./data_dir');
import cls = require('./cls');
import fs = require("fs-extra");

const dbConnection = new Database(dataDir.DOCUMENT_PATH);
dbConnection.pragma('journal_mode = WAL');

const LOG_ALL_QUERIES = false;

type Params = any;

[`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `SIGTERM`].forEach(eventType => {
    process.on(eventType, () => {
        if (dbConnection) {
            // closing connection is especially important to fold -wal file into the main DB file
            // (see https://sqlite.org/tempfiles.html for details)
            dbConnection.close();
        }
    });
});

function insert<T extends {}>(tableName: string, rec: T, replace = false) {
    const keys = Object.keys(rec || {});
    if (keys.length === 0) {
        log.error(`Can't insert empty object into table ${tableName}`);
        return;
    }

    const columns = keys.join(", ");
    const questionMarks = keys.map(p => "?").join(", ");

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

function replace<T extends {}>(tableName: string, rec: T) {
    return insert(tableName, rec, true);
}

function upsert<T extends {}>(tableName: string, primaryKey: string, rec: T) {
    const keys = Object.keys(rec || {});
    if (keys.length === 0) {
        log.error(`Can't upsert empty object into table ${tableName}`);
        return;
    }

    const columns = keys.join(", ");

    const questionMarks = keys.map(colName => `@${colName}`).join(", ");

    const updateMarks = keys.map(colName => `${colName} = @${colName}`).join(", ");

    const query = `INSERT INTO ${tableName} (${columns}) VALUES (${questionMarks}) 
                   ON CONFLICT (${primaryKey}) DO UPDATE SET ${updateMarks}`;

    for (const idx in rec) {
        if (rec[idx] === true || rec[idx] === false) {
            (rec as any)[idx] = rec[idx] ? 1 : 0;
        }
    }

    execute(query, rec);
}

const statementCache: Record<string, Database.Statement> = {};

function stmt(sql: string) {
    if (!(sql in statementCache)) {
        statementCache[sql] = dbConnection.prepare(sql);
    }

    return statementCache[sql];
}

function getRow<T>(query: string, params: Params = []): T {
    return wrap(query, s => s.get(params)) as T;
}

function getRowOrNull<T>(query: string, params: Params = []): T | null {
    const all = getRows(query, params);
    if (!all) {
        return null;
    }

    return (all.length > 0 ? all[0] : null) as (T | null);
}

function getValue(query: string, params: Params = []) {
    return wrap(query, s => s.pluck().get(params));
}

// smaller values can result in better performance due to better usage of statement cache
const PARAM_LIMIT = 100;

function getManyRows(query: string, params: Params) {
    let results: unknown[] = [];

    while (params.length > 0) {
        const curParams = params.slice(0, Math.min(params.length, PARAM_LIMIT));
        params = params.slice(curParams.length);

        const curParamsObj: Record<string, any> = {};

        let j = 1;
        for (const param of curParams) {
            curParamsObj['param' + j++] = param;
        }

        let i = 1;
        const questionMarks = curParams.map(() => ":param" + i++).join(",");
        const curQuery = query.replace(/\?\?\?/g, questionMarks);

        const statement = curParams.length === PARAM_LIMIT
            ? stmt(curQuery)
            : dbConnection.prepare(curQuery);

        const subResults = statement.all(curParamsObj);
        results = results.concat(subResults);
    }

    return results;
}

function getRows(query: string, params: Params = []): unknown[] {
    return wrap(query, s => s.all(params)) as unknown[];
}

function getRawRows<T extends {} | unknown[]>(query: string, params: Params = []): T[] | null {
    return wrap(query, s => s.raw().all(params)) as T[] | null;
}

function iterateRows(query: string, params: Params = []) {
    if (LOG_ALL_QUERIES) {
        console.log(query);
    }

    return stmt(query).iterate(params);
}

function getMap<K extends string | number | symbol, V>(query: string, params: Params = []) {
    const map: Record<K, V> = {} as Record<K, V>;
    const results = getRawRows<any>(query, params);

    for (const row of results || []) {
        map[row[0] as K] = row[1];
    }

    return map;
}

function getColumn(query: string, params: Params = []) {
    return wrap(query, s => s.pluck().all(params));
}

function execute(query: string, params: Params = []): Database.RunResult {
    return wrap(query, s => s.run(params)) as Database.RunResult;
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
            curParamsObj['param' + j++] = param;
        }

        let i = 1;
        const questionMarks = curParams.map(() => ":param" + i++).join(",");
        const curQuery = query.replace(/\?\?\?/g, questionMarks);

        dbConnection.prepare(curQuery).run(curParamsObj);
    }
}

function executeScript(query: string) {
    if (LOG_ALL_QUERIES) {
        console.log(query);
    }

    return dbConnection.exec(query);
}

function wrap(query: string, func: (statement: Database.Statement) => unknown): unknown {
    const startTimestamp = Date.now();
    let result;

    if (LOG_ALL_QUERIES) {
        console.log(query);
    }

    try {
        result = func(stmt(query));
    }
    catch (e: any) {
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
        }
        else {
            log.info(`Slow query took ${milliseconds}ms: ${query.trim().replace(/\s+/g, " ")}`);
        }
    }

    return result;
}

function transactional<T>(func: (statement: Database.Statement) => T) {
    try {
        const ret = (dbConnection.transaction(func) as any).deferred();

        if (!dbConnection.inTransaction) { // i.e. transaction was really committed (and not just savepoint released)
            require('./ws.js').sendTransactionEntityChangesToAllClients();
        }

        return ret;
    }
    catch (e) {
        const entityChangeIds = cls.getAndClearEntityChangeIds();

        if (entityChangeIds.length > 0) {
            log.info("Transaction rollback dirtied the becca, forcing reload.");

            require('../becca/becca_loader.js').load();
        }

        // the maxEntityChangeId has been incremented during failed transaction, need to recalculate
        require('./entity_changes.js').recalculateMaxEntityChangeId();

        throw e;
    }
}

function fillParamList(paramIds: string[], truncate = true) {
    if (paramIds.length === 0) {
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

    // doing it manually to avoid this showing up on the sloq query list
    const s = stmt(`INSERT INTO param_list VALUES ${paramIds.map(paramId => `(?)`).join(',')}`);

    s.run(paramIds);
}

async function copyDatabase(targetFilePath: string) {
    try {
        fs.unlinkSync(targetFilePath);
    } catch (e) {
    } // unlink throws exception if the file did not exist

    await dbConnection.backup(targetFilePath);
}

function disableSlowQueryLogging<T>(cb: () => T) {
    const orig = cls.isSlowQueryLoggingDisabled();

    try {
        cls.disableSlowQueryLogging(true);

        return cb();
    }
    finally {
        cls.disableSlowQueryLogging(orig);
    }
}

module.exports = {
    dbConnection,
    insert,
    replace,

    /**
     * Get single value from the given query - first column from first returned row.
     *
     * @method
     * @param {string} query - SQL query with ? used as parameter placeholder
     * @param {object[]} [params] - array of params if needed
     * @returns [object] - single value
     */
    getValue,

    /**
     * Get first returned row.
     *
     * @method
     * @param {string} query - SQL query with ? used as parameter placeholder
     * @param {object[]} [params] - array of params if needed
     * @returns {object} - map of column name to column value
     */
    getRow,
    getRowOrNull,

    /**
     * Get all returned rows.
     *
     * @method
     * @param {string} query - SQL query with ? used as parameter placeholder
     * @param {object[]} [params] - array of params if needed
     * @returns {object[]} - array of all rows, each row is a map of column name to column value
     */
    getRows,
    getRawRows,
    iterateRows,
    getManyRows,

    /**
     * Get a map of first column mapping to second column.
     *
     * @method
     * @param {string} query - SQL query with ? used as parameter placeholder
     * @param {object[]} [params] - array of params if needed
     * @returns {object} - map of first column to second column
     */
    getMap,

    /**
     * Get a first column in an array.
     *
     * @method
     * @param {string} query - SQL query with ? used as parameter placeholder
     * @param {object[]} [params] - array of params if needed
     * @returns {object[]} - array of first column of all returned rows
     */
    getColumn,

    /**
     * Execute SQL
     *
     * @method
     * @param {string} query - SQL query with ? used as parameter placeholder
     * @param {object[]} [params] - array of params if needed
     */
    execute,
    executeMany,
    executeScript,
    transactional,
    upsert,
    fillParamList,
    copyDatabase,
    disableSlowQueryLogging
};
