import { getContext } from "../context.js";
import type LogService from "../log.js";
import type { DatabaseProvider, Params, RunResult, Statement } from "./types.js";

const LOG_ALL_QUERIES = false;

// smaller values can result in better performance due to better usage of statement cache
const PARAM_LIMIT = 100;

export interface SqlServiceParams {
    provider: DatabaseProvider;
    onTransactionRollback: () => void;
    onTransactionCommit: () => void;
    isReadOnly: boolean;
}

export class SqlService {

    private dbConnection: DatabaseProvider;
    private statementCache: Record<string, Statement> = {};
    private params: Omit<SqlServiceParams, "provider">;

    constructor({ provider, ...restParams }: SqlServiceParams,
        private log: LogService
    ) {
        this.dbConnection = provider;
        this.params = restParams;
    }

    insert<T extends {}>(tableName: string, rec: T, replace = false) {
        const keys = Object.keys(rec || {});
        if (keys.length === 0) {
            this.log.error(`Can't insert empty object into table ${tableName}`);
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

        const res = this.execute(query, Object.values(rec));

        return res ? res.lastInsertRowid : null;
    }

    replace<T extends {}>(tableName: string, rec: T): number | null {
        return this.insert(tableName, rec, true) as number | null;
    }

    upsert<T extends {}>(tableName: string, primaryKey: string, rec: T) {
        const keys = Object.keys(rec || {});
        if (keys.length === 0) {
            this.log.error(`Can't upsert empty object into table ${tableName}`);
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

        this.execute(query, rec);
    }

    /**
     * For the given SQL query, returns a prepared statement. For the same query (string comparison), the same statement is returned.
     *
     * @param sql the SQL query for which to return a prepared statement.
     * @param isRaw indicates whether `.raw()` is going to be called on the prepared statement in order to return the raw rows (e.g. via {@link getRawRows()}). The reason is that the raw state is preserved in the saved statement and would break non-raw calls for the same query.
     * @returns the corresponding {@link Statement}.
     */
    stmt(sql: string, isRaw?: boolean) {
        const key = (isRaw ? `raw/${sql}` : sql);

        if (!(key in this.statementCache)) {
            this.statementCache[key] = this.dbConnection.prepare(sql);
        }

        return this.statementCache[key];
    }

    /**
     * Get first returned row.
     *
     * @param query - SQL query with ? used as parameter placeholder
     * @param params - array of params if needed
     * @returns - map of column name to column value
     */
    getRow<T>(query: string, params: Params = []): T {
        return this.wrap(query, (s) => s.get(params)) as T;
    }

    getRowOrNull<T>(query: string, params: Params = []): T | null {
        const all = this.getRows(query, params);
        if (!all) {
            return null;
        }

        return (all.length > 0 ? all[0] : null) as T | null;
    }

    /**
     * Get single value from the given query - first column from first returned row.
     *
     * @param query - SQL query with ? used as parameter placeholder
     * @param params - array of params if needed
     * @returns single value
     */
    getValue<T>(query: string, params: Params = []): T {
        return this.wrap(query, (s) => s.pluck().get(params)) as T;
    }

    getManyRows<T>(query: string, params: Params): T[] {
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

            const statement = curParams.length === PARAM_LIMIT ? this.stmt(curQuery) : this.dbConnection.prepare(curQuery);

            const subResults = statement.all(curParamsObj);
            results = results.concat(subResults);
        }

        return (results as T[] | null) || [];
    }

    /**
     * Get all returned rows.
     *
     * @param query - SQL query with ? used as parameter placeholder
     * @param params - array of params if needed
     * @returns - array of all rows, each row is a map of column name to column value
     */
    getRows<T>(query: string, params: Params = []): T[] {
        return this.wrap(query, (s) => s.all(params)) as T[];
    }

    getRawRows<T extends {} | unknown[]>(query: string, params: Params = []): T[] {
        return (this.wrap(query, (s) => s.raw().all(params), true) as T[]) || [];
    }

    iterateRows<T>(query: string, params: Params = []): IterableIterator<T> {
        if (LOG_ALL_QUERIES) {
            console.log(query);
        }

        return this.stmt(query).iterate(params) as IterableIterator<T>;
    }

    /**
     * Get a map of first column mapping to second column.
     *
     * @param query - SQL query with ? used as parameter placeholder
     * @param params - array of params if needed
     * @returns - map of first column to second column
     */
    getMap<K extends string | number | symbol, V>(query: string, params: Params = []) {
        const map: Record<K, V> = {} as Record<K, V>;
        const results = this.getRawRows<[K, V]>(query, params);

        for (const row of results || []) {
            map[row[0]] = row[1];
        }

        return map;
    }

    /**
     * Get a first column in an array.
     *
     * @param query - SQL query with ? used as parameter placeholder
     * @param params - array of params if needed
     * @returns array of first column of all returned rows
     */
    getColumn<T>(query: string, params: Params = []): T[] {
        return this.wrap(query, (s) => s.pluck().all(params)) as T[];
    }

    /**
     * Execute SQL
     *
     * @param query - SQL query with ? used as parameter placeholder
     * @param params - array of params if needed
     */
    execute(query: string, params: Params = []): RunResult {
        if (this.params.isReadOnly && (query.startsWith("UPDATE") || query.startsWith("INSERT") || query.startsWith("DELETE"))) {
            this.log.error(`read-only DB ignored: ${query} with parameters ${JSON.stringify(params)}`);
            return {
                changes: 0,
                lastInsertRowid: 0
            };
        }
        return this.wrap(query, (s) => s.run(params)) as RunResult;
    }

    executeMany(query: string, params: Params) {
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

            this.dbConnection.prepare(curQuery).run(curParamsObj);
        }
    }

    executeScript(query: string) {
        if (LOG_ALL_QUERIES) {
            console.log(query);
        }

        this.dbConnection.exec(query);
    }

    /**
     * @param isRaw indicates whether `.raw()` is going to be called on the prepared statement in order to return the raw rows (e.g. via {@link getRawRows()}). The reason is that the raw state is preserved in the saved statement and would break non-raw calls for the same query.
     */
    wrap(query: string, func: (statement: Statement) => unknown, isRaw?: boolean): unknown {
        const startTimestamp = Date.now();
        let result;

        if (LOG_ALL_QUERIES) {
            console.log(query);
        }

        try {
            result = func(this.stmt(query, isRaw));
        } catch (e: any) {
            if (e.message.includes("The database connection is not open")) {
                // this often happens on killing the app which puts these alerts in front of user
                // in these cases error should be simply ignored.
                console.log(e.message);

                return null;
            }

            console.error(`Error executing query: ${query} with parameters ${JSON.stringify((e as any).params || [])}`);

            throw e;
        }

        const milliseconds = Date.now() - startTimestamp;

        if (milliseconds >= 20 && !isSlowQueryLoggingDisabled()) {
            if (query.includes("WITH RECURSIVE")) {
                this.log.info(`Slow recursive query took ${milliseconds}ms.`);
            } else {
                this.log.info(`Slow query took ${milliseconds}ms: ${query.trim().replace(/\s+/g, " ")}`);
            }
        }

        return result;
    }

    transactional<T>(func: (statement: Statement) => T) {
        try {
            const ret = (this.dbConnection.transaction(func) as any).deferred();

            if (!this.dbConnection.inTransaction) {
                // i.e. transaction was really committed (and not just savepoint released)
                this.params.onTransactionCommit();
            }

            return ret as T;
        } catch (e) {
            console.warn("Got error ", e);
            this.params.onTransactionRollback();
            throw e;
        }
    }

    fillParamList(paramIds: string[] | Set<string>, truncate = true) {
        if ("length" in paramIds && paramIds.length === 0) {
            return;
        }

        if (truncate) {
            this.execute("DELETE FROM param_list");
        }

        paramIds = Array.from(new Set(paramIds));

        if (paramIds.length > 30000) {
            this.fillParamList(paramIds.slice(30000), false);

            paramIds = paramIds.slice(0, 30000);
        }

        // doing it manually to avoid this showing up on the slow query list
        const s = this.stmt(`INSERT INTO param_list VALUES ${paramIds.map((paramId) => `(?)`).join(",")}`);

        s.run(paramIds);
    }

    async copyDatabase(targetFilePath: string) {
        await this.dbConnection.backup(targetFilePath);
    }

    disableSlowQueryLogging<T>(cb: () => T) {
        const orig = isSlowQueryLoggingDisabled();

        try {
            disableSlowQueryLogging(true);

            return cb();
        } finally {
            disableSlowQueryLogging(orig);
        }
    }
}

function disableSlowQueryLogging(disable: boolean) {
    getContext().set("disableSlowQueryLogging", disable);
}

function isSlowQueryLoggingDisabled() {
    return !!getContext().get("disableSlowQueryLogging");
}
