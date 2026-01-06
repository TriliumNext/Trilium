import type { DatabaseProvider, RunResult, Statement, Transaction } from "@triliumnext/core";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { BindableValue } from "@sqlite.org/sqlite-wasm";
import demoDbSql from "./db.sql?raw";

// Type definitions for SQLite WASM (the library doesn't export these directly)
type Sqlite3Module = Awaited<ReturnType<typeof sqlite3InitModule>>;
type Sqlite3Database = InstanceType<Sqlite3Module["oo1"]["DB"]>;
type Sqlite3PreparedStatement = ReturnType<Sqlite3Database["prepare"]>;

/**
 * Wraps an SQLite WASM PreparedStatement to match the Statement interface
 * expected by trilium-core.
 */
class WasmStatement implements Statement {
    private isRawMode = false;
    
    constructor(
        private stmt: Sqlite3PreparedStatement,
        private db: Sqlite3Database
    ) {}

    run(...params: unknown[]): RunResult {
        this.bindParams(params);
        try {
            this.stmt.stepFinalize();
            return {
                changes: this.db.changes(),
                lastInsertRowid: 0 // Would need sqlite3_last_insert_rowid for this
            };
        } catch (e) {
            this.stmt.finalize();
            throw e;
        }
    }

    get(params: unknown): unknown {
        this.bindParams(Array.isArray(params) ? params : params !== undefined ? [params] : []);
        try {
            if (this.stmt.step()) {
                return this.isRawMode ? this.stmt.get([]) : this.stmt.get({});
            }
            return undefined;
        } finally {
            this.stmt.reset();
        }
    }

    all(...params: unknown[]): unknown[] {
        this.bindParams(params);
        const results: unknown[] = [];
        try {
            while (this.stmt.step()) {
                results.push(this.isRawMode ? this.stmt.get([]) : this.stmt.get({}));
            }
            return results;
        } finally {
            this.stmt.reset();
        }
    }

    iterate(...params: unknown[]): IterableIterator<unknown> {
        this.bindParams(params);
        const stmt = this.stmt;
        const isRaw = this.isRawMode;

        return {
            [Symbol.iterator]() {
                return this;
            },
            next(): IteratorResult<unknown> {
                if (stmt.step()) {
                    return { value: isRaw ? stmt.get([]) : stmt.get({}), done: false };
                }
                stmt.reset();
                return { value: undefined, done: true };
            }
        };
    }

    raw(toggleState?: boolean): this {
        // In raw mode, rows are returned as arrays instead of objects
        // If toggleState is undefined, enable raw mode (better-sqlite3 behavior)
        this.isRawMode = toggleState !== undefined ? toggleState : true;
        return this;
    }

    pluck(_toggleState?: boolean): this {
        // pluck mode returns only the first column of each row
        console.warn("pluck() mode is not fully supported in WASM SQLite provider");
        return this;
    }

    private bindParams(params: unknown[]): void {
        this.stmt.clearBindings();
        if (params.length === 0) {
            return;
        }

        // Handle single object with named parameters
        if (params.length === 1 && typeof params[0] === "object" && params[0] !== null && !Array.isArray(params[0])) {
            const bindings = params[0] as { [paramName: string]: BindableValue };
            this.stmt.bind(bindings);
        } else {
            // Handle positional parameters - flatten and cast to BindableValue[]
            const flatParams = params.flat() as BindableValue[];
            if (flatParams.length > 0) {
                this.stmt.bind(flatParams);
            }
        }
    }

    finalize(): void {
        this.stmt.finalize();
    }
}

/**
 * SQLite database provider for browser environments using SQLite WASM.
 *
 * This provider wraps the official @sqlite.org/sqlite-wasm package to provide
 * a DatabaseProvider implementation compatible with trilium-core.
 *
 * @example
 * ```typescript
 * const provider = new BrowserSqlProvider();
 * await provider.initWasm(); // Initialize SQLite WASM module
 * provider.loadFromMemory(); // Open an in-memory database
 * // or
 * provider.loadFromBuffer(existingDbBuffer); // Load from existing data
 * ```
 */
export default class BrowserSqlProvider implements DatabaseProvider {
    private db?: Sqlite3Database;
    private sqlite3?: Sqlite3Module;
    private _inTransaction = false;
    private initPromise?: Promise<void>;
    private initError?: Error;

    /**
     * Get the SQLite WASM module version info.
     * Returns undefined if the module hasn't been initialized yet.
     */
    get version(): { libVersion: string; sourceId: string } | undefined {
        return this.sqlite3?.version;
    }

    /**
     * Initialize the SQLite WASM module.
     * This must be called before using any database operations.
     * Safe to call multiple times - subsequent calls return the same promise.
     *
     * @returns A promise that resolves when the module is initialized
     * @throws Error if initialization fails
     */
    async initWasm(): Promise<void> {
        // Return existing promise if already initializing/initialized
        if (this.initPromise) {
            return this.initPromise;
        }

        // Fail fast if we already tried and failed
        if (this.initError) {
            throw this.initError;
        }

        this.initPromise = this.doInitWasm();
        return this.initPromise;
    }

    private async doInitWasm(): Promise<void> {
        try {
            console.log("[BrowserSqlProvider] Initializing SQLite WASM...");
            const startTime = performance.now();

            this.sqlite3 = await sqlite3InitModule({
                print: console.log,
                printErr: console.error,
            });

            const initTime = performance.now() - startTime;
            console.log(
                `[BrowserSqlProvider] SQLite WASM initialized in ${initTime.toFixed(2)}ms:`,
                this.sqlite3.version.libVersion
            );
        } catch (e) {
            this.initError = e instanceof Error ? e : new Error(String(e));
            console.error("[BrowserSqlProvider] SQLite WASM initialization failed:", this.initError);
            throw this.initError;
        }
    }

    /**
     * Check if the SQLite WASM module has been initialized.
     */
    get isInitialized(): boolean {
        return this.sqlite3 !== undefined;
    }

    loadFromFile(_path: string, _isReadOnly: boolean): void {
        // Browser environment doesn't have direct file system access.
        // For OPFS support, we would need to use the OPFS VFS.
        throw new Error(
            "loadFromFile is not supported in browser environment. " +
            "Use loadFromMemory() or loadFromBuffer() instead, or implement OPFS VFS support."
        );
    }

    loadFromMemory(): void {
        this.ensureSqlite3();
        console.log("[BrowserSqlProvider] Loading demo database...");
        const startTime = performance.now();
        
        this.db = new this.sqlite3!.oo1.DB(":memory:", "c");
        this.db.exec("PRAGMA journal_mode = WAL");
        
        // Load the demo database by default
        this.db.exec(demoDbSql);
        
        const loadTime = performance.now() - startTime;
        console.log(`[BrowserSqlProvider] Demo database loaded in ${loadTime.toFixed(2)}ms`);
    }

    loadFromBuffer(buffer: Uint8Array): void {
        this.ensureSqlite3();
        // SQLite WASM can deserialize a database from a byte array
        const p = this.sqlite3!.wasm.allocFromTypedArray(buffer);
        try {
            this.db = new this.sqlite3!.oo1.DB({ filename: ":memory:", flags: "c" });
            const rc = this.sqlite3!.capi.sqlite3_deserialize(
                this.db.pointer!,
                "main",
                p,
                buffer.byteLength,
                buffer.byteLength,
                this.sqlite3!.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
                this.sqlite3!.capi.SQLITE_DESERIALIZE_RESIZEABLE
            );
            if (rc !== 0) {
                throw new Error(`Failed to deserialize database: ${rc}`);
            }
        } catch (e) {
            this.sqlite3!.wasm.dealloc(p);
            throw e;
        }
    }

    backup(_destinationFile: string): void {
        // In browser, we can serialize the database to a byte array
        // For actual file backup, we'd need to use File System Access API or download
        throw new Error(
            "backup to file is not supported in browser environment. " +
            "Use serialize() to get the database as a Uint8Array instead."
        );
    }

    /**
     * Serialize the database to a byte array.
     * This can be used to save the database to IndexedDB, download it, etc.
     */
    serialize(): Uint8Array {
        this.ensureDb();
        // Use the convenience wrapper which handles all the memory management
        return this.sqlite3!.capi.sqlite3_js_db_export(this.db!);
    }

    prepare(query: string): Statement {
        this.ensureDb();
        const stmt = this.db!.prepare(query);
        return new WasmStatement(stmt, this.db!);
    }

    transaction<T>(func: (statement: Statement) => T): Transaction {
        this.ensureDb();

        const self = this;

        // Helper function to execute within a transaction
        const executeTransaction = (beginStatement: string, ...args: unknown[]): T => {
            self._inTransaction = true;
            self.db!.exec(beginStatement);
            try {
                const result = func.apply(null, args as [Statement]);
                self.db!.exec("COMMIT");
                return result;
            } catch (e) {
                self.db!.exec("ROLLBACK");
                throw e;
            } finally {
                self._inTransaction = false;
            }
        };

        // Create the transaction function that acts like better-sqlite3's Transaction interface
        // In better-sqlite3, the transaction function is callable and has .deferred(), .immediate(), etc.
        const transactionWrapper = Object.assign(
            // Default call executes with BEGIN (same as immediate)
            (...args: unknown[]): T => executeTransaction("BEGIN", ...args),
            {
                // Deferred transaction - locks acquired on first data access
                deferred: (...args: unknown[]): T => executeTransaction("BEGIN DEFERRED", ...args),
                // Immediate transaction - acquires write lock immediately
                immediate: (...args: unknown[]): T => executeTransaction("BEGIN IMMEDIATE", ...args),
                // Exclusive transaction - exclusive lock
                exclusive: (...args: unknown[]): T => executeTransaction("BEGIN EXCLUSIVE", ...args),
                // Default is same as calling directly
                default: (...args: unknown[]): T => executeTransaction("BEGIN", ...args)
            }
        );

        return transactionWrapper as unknown as Transaction;
    }

    get inTransaction(): boolean {
        return this._inTransaction;
    }

    exec(query: string): void {
        this.ensureDb();
        this.db!.exec(query);
    }

    close(): void {
        if (this.db) {
            this.db.close();
            this.db = undefined;
        }
    }

    /**
     * Get the number of rows changed by the last INSERT, UPDATE, or DELETE statement.
     */
    changes(): number {
        this.ensureDb();
        return this.db!.changes();
    }

    /**
     * Check if the database is currently open.
     */
    isOpen(): boolean {
        return this.db !== undefined && this.db.isOpen();
    }

    private ensureSqlite3(): void {
        if (!this.sqlite3) {
            throw new Error(
                "SQLite WASM module not initialized. Call initialize() first with the sqlite3 module."
            );
        }
    }

    private ensureDb(): void {
        this.ensureSqlite3();
        if (!this.db) {
            throw new Error("Database not opened. Call loadFromMemory() or loadFromBuffer() first.");
        }
    }
}
