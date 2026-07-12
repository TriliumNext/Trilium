import { DatabaseSync } from "node:sqlite";

import type { DatabaseProvider, RunResult, Statement, Transaction } from "@triliumnext/core";

type StatementSync = ReturnType<DatabaseSync["prepare"]>;

/**
 * Native, in-process `DatabaseProvider` backed by Deno's built-in
 * `node:sqlite`. This is the Deno equivalent of the server's
 * better-sqlite3 provider: fully synchronous, WAL-mode, zero copies across
 * runtime boundaries. Semantics (parameter normalization, raw/pluck modes,
 * SAVEPOINT-based transaction nesting) mirror the standalone
 * `BrowserSqlProvider` so trilium-core behaves identically on either.
 */
export default class DenoSqlProvider implements DatabaseProvider {
    private db: DatabaseSync | null = null;
    private statementCache = new Map<string, DenoStatement>();
    private _inTransaction = false;

    loadFromFile(path: string, isReadOnly: boolean): void {
        this.close();
        this.db = new DatabaseSync(path, { readOnly: isReadOnly });
        if (!isReadOnly) {
            this.db.exec("PRAGMA journal_mode = WAL");
        }
    }

    loadFromMemory(): void {
        this.close();
        this.db = new DatabaseSync(":memory:");
    }

    loadFromBuffer(): void {
        throw new Error("loadFromBuffer is not supported by the Deno provider; use loadFromFile.");
    }

    prepare(query: string): Statement {
        const cached = this.statementCache.get(query);
        if (cached) {
            return cached;
        }
        const statement = new DenoStatement(this.ensureDb().prepare(query));
        this.statementCache.set(query, statement);
        return statement;
    }

    exec(query: string): void {
        this.ensureDb().exec(query);
    }

    transaction<T>(func: (statement: Statement) => T): Transaction {
        const db = this.ensureDb();
        const self = this;
        let savepointCounter = 0;

        const executeTransaction = (beginStatement: string, ...args: unknown[]): T => {
            // Nest via SAVEPOINT when a transaction is already open — whether
            // through this wrapper or a manual BEGIN (transactionalAsync),
            // which only the engine's autocommit state reveals.
            if (self._inTransaction || db.isTransaction) {
                const savepointName = `sp_${++savepointCounter}_${Date.now()}`;
                db.exec(`SAVEPOINT ${savepointName}`);
                try {
                    const result = func.apply(null, args as [Statement]);
                    db.exec(`RELEASE SAVEPOINT ${savepointName}`);
                    return result;
                } catch (e) {
                    db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
                    throw e;
                }
            }

            self._inTransaction = true;
            db.exec(beginStatement);
            try {
                const result = func.apply(null, args as [Statement]);
                db.exec("COMMIT");
                return result;
            } catch (e) {
                db.exec("ROLLBACK");
                throw e;
            } finally {
                self._inTransaction = false;
            }
        };

        const transactionWrapper = Object.assign(
            (...args: unknown[]): T => executeTransaction("BEGIN", ...args),
            {
                deferred: (...args: unknown[]): T => executeTransaction("BEGIN DEFERRED", ...args),
                immediate: (...args: unknown[]): T => executeTransaction("BEGIN IMMEDIATE", ...args),
                exclusive: (...args: unknown[]): T => executeTransaction("BEGIN EXCLUSIVE", ...args),
                default: (...args: unknown[]): T => executeTransaction("BEGIN", ...args)
            }
        );

        return transactionWrapper as unknown as Transaction;
    }

    get inTransaction(): boolean {
        return this._inTransaction || this.ensureDb().isTransaction === true;
    }

    backup(destinationFile: string): void {
        try {
            Deno.removeSync(destinationFile);
        } catch {
            // Did not exist.
        }
        // VACUUM INTO produces a consistent single-file copy even in WAL mode.
        this.ensureDb().exec(`VACUUM INTO '${destinationFile.replaceAll("'", "''")}'`);
    }

    serialize(): Uint8Array {
        const tmpPath = `${Deno.makeTempDirSync()}/serialized.db`;
        this.backup(tmpPath);
        try {
            return Deno.readFileSync(tmpPath);
        } finally {
            Deno.removeSync(tmpPath);
        }
    }

    close(): void {
        this.statementCache.clear();
        this.db?.close();
        this.db = null;
    }

    private ensureDb(): DatabaseSync {
        if (!this.db) {
            throw new Error("Database not loaded. Call loadFromFile() first.");
        }
        return this.db;
    }
}

class DenoStatement implements Statement {
    private isRawMode = false;
    private isPluckMode = false;

    constructor(private stmt: StatementSync) {}

    run(...params: unknown[]): RunResult {
        const result = this.invoke("run", params) as { changes: number | bigint; lastInsertRowid: number | bigint };
        return {
            changes: Number(result.changes),
            lastInsertRowid: Number(result.lastInsertRowid)
        };
    }

    get(params: unknown): unknown {
        const args = params === undefined ? [] : [params];
        const row = this.invoke("get", args);
        if (row === undefined || row === null) {
            return undefined;
        }
        return this.projectRow(row);
    }

    all(...params: unknown[]): unknown[] {
        const rows = this.invoke("all", params) as unknown[];
        if (!this.isRawMode && !this.isPluckMode) {
            return rows;
        }
        return rows.map((row) => this.projectRow(row));
    }

    iterate(...params: unknown[]): IterableIterator<unknown> {
        // Buffered: node:sqlite statements are not safely re-entrant while
        // an iterator is open, and callers use this for moderate result sets.
        return this.all(...params)[Symbol.iterator]();
    }

    raw(toggleState?: boolean): this {
        this.isRawMode = toggleState !== undefined ? toggleState : true;
        return this;
    }

    pluck(toggleState?: boolean): this {
        this.isPluckMode = toggleState !== undefined ? toggleState : true;
        return this;
    }

    private invoke(method: "run" | "get" | "all", params: unknown[]): unknown {
        // Mirror WasmStatement: a single object argument means named
        // parameters; anything else is positional.
        if (
            params.length === 1 &&
            typeof params[0] === "object" &&
            params[0] !== null &&
            !Array.isArray(params[0]) &&
            !(params[0] instanceof Uint8Array)
        ) {
            const named: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(params[0])) {
                named[key] = normalizeValue(value);
            }
            return this.stmt[method](named as never);
        }

        const positional = (params.length === 1 && Array.isArray(params[0]) ? params[0] : params)
            .map(normalizeValue);
        return this.stmt[method](...positional as never[]);
    }

    private projectRow(row: unknown): unknown {
        if (!this.isRawMode && !this.isPluckMode) {
            return row;
        }
        const record = row as Record<string, unknown>;
        const columns = this.stmt.columns().map((c) => String(c.name));
        if (this.isPluckMode) {
            return record[columns[0]];
        }
        return columns.map((name) => record[name]);
    }
}

/** node:sqlite refuses booleans and undefined; normalize like WASM SQLite accepts them. */
function normalizeValue(value: unknown): unknown {
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    if (value === undefined) {
        return null;
    }
    return value;
}
