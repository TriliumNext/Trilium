import { type BindableValue, default as sqlite3InitModule } from "@sqlite.org/sqlite-wasm";
import type { DatabaseProvider, RunResult, Statement, Transaction } from "@triliumnext/core";

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
    private isPluckMode = false;
    private isFinalized = false;

    constructor(
        private stmt: Sqlite3PreparedStatement,
        private db: Sqlite3Database,
        private sqlite3: Sqlite3Module
    ) {}

    run(...params: unknown[]): RunResult {
        if (this.isFinalized) {
            throw new Error("Cannot call run() on finalized statement");
        }

        this.bindParams(params);
        try {
            // Use step() and then reset instead of stepFinalize()
            // This allows the statement to be reused
            this.stmt.step();
            const changes = this.db.changes();
            // Get the last insert row ID using the C API
            const lastInsertRowid = this.db.pointer ? this.sqlite3.capi.sqlite3_last_insert_rowid(this.db.pointer) : 0;
            this.stmt.reset();
            return {
                changes,
                lastInsertRowid: typeof lastInsertRowid === "bigint" ? Number(lastInsertRowid) : lastInsertRowid
            };
        } catch (e) {
            // Reset on error to allow reuse
            this.stmt.reset();
            throw e;
        }
    }

    get(params: unknown): unknown {
        if (this.isFinalized) {
            throw new Error("Cannot call get() on finalized statement");
        }

        this.bindParams(Array.isArray(params) ? params : params !== undefined ? [params] : []);
        try {
            if (this.stmt.step()) {
                if (this.isPluckMode) {
                    // In pluck mode, return only the first column value
                    const row = this.stmt.get([]);
                    return Array.isArray(row) && row.length > 0 ? row[0] : undefined;
                }
                return this.isRawMode ? this.stmt.get([]) : this.stmt.get({});
            }
            return undefined;
        } finally {
            this.stmt.reset();
        }
    }

    all(...params: unknown[]): unknown[] {
        if (this.isFinalized) {
            throw new Error("Cannot call all() on finalized statement");
        }

        this.bindParams(params);
        const results: unknown[] = [];
        try {
            while (this.stmt.step()) {
                if (this.isPluckMode) {
                    // In pluck mode, return only the first column value for each row
                    const row = this.stmt.get([]);
                    if (Array.isArray(row) && row.length > 0) {
                        results.push(row[0]);
                    }
                } else {
                    results.push(this.isRawMode ? this.stmt.get([]) : this.stmt.get({}));
                }
            }
            return results;
        } finally {
            this.stmt.reset();
        }
    }

    iterate(...params: unknown[]): IterableIterator<unknown> {
        if (this.isFinalized) {
            throw new Error("Cannot call iterate() on finalized statement");
        }

        this.bindParams(params);
        const stmt = this.stmt;
        const isRaw = this.isRawMode;
        const isPluck = this.isPluckMode;

        return {
            [Symbol.iterator]() {
                return this;
            },
            next(): IteratorResult<unknown> {
                if (stmt.step()) {
                    if (isPluck) {
                        const row = stmt.get([]);
                        const value = Array.isArray(row) && row.length > 0 ? row[0] : undefined;
                        return { value, done: false };
                    }
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

    pluck(toggleState?: boolean): this {
        // In pluck mode, only the first column of each row is returned
        // If toggleState is undefined, enable pluck mode (better-sqlite3 behavior)
        this.isPluckMode = toggleState !== undefined ? toggleState : true;
        return this;
    }

    private bindParams(params: unknown[]): void {
        this.stmt.clearBindings();
        if (params.length === 0) {
            return;
        }

        // Handle single object with named parameters
        if (params.length === 1 && typeof params[0] === "object" && params[0] !== null && !Array.isArray(params[0])) {
            const inputBindings = params[0] as { [paramName: string]: BindableValue };

            // SQLite WASM expects parameter names to include the prefix (@ : or $)
            // better-sqlite3 automatically maps unprefixed names to @name
            // We need to add the @ prefix for compatibility
            const bindings: { [paramName: string]: BindableValue } = {};
            for (const [key, value] of Object.entries(inputBindings)) {
                // If the key already has a prefix, use it as-is
                if (key.startsWith('@') || key.startsWith(':') || key.startsWith('$')) {
                    bindings[key] = value;
                } else {
                    // Add @ prefix to match better-sqlite3 behavior
                    bindings[`@${key}`] = value;
                }
            }

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
        if (!this.isFinalized) {
            try {
                this.stmt.finalize();
            } catch (e) {
                console.warn("Error finalizing SQLite statement:", e);
            } finally {
                this.isFinalized = true;
            }
        }
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
    private statementCache: Map<string, WasmStatement> = new Map();

    // OPFS state tracking
    private opfsDbPath?: string;

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

    // ==================== OPFS Support ====================

    /**
     * Check if the OPFS VFS is available.
     * This requires:
     * - Running in a Worker context
     * - Browser support for OPFS APIs
     * - COOP/COEP headers sent by the server (for SharedArrayBuffer)
     *
     * @returns true if OPFS VFS is available for use
     */
    isOpfsAvailable(): boolean {
        this.ensureSqlite3();
        // SQLite WASM automatically installs the OPFS VFS if the environment supports it
        // We can check for its presence via sqlite3_vfs_find or the OpfsDb class
        return this.sqlite3!.oo1.OpfsDb !== undefined;
    }

    /**
     * Load or create a database stored in OPFS for persistent storage.
     * The database will persist across browser sessions.
     *
     * Requires COOP/COEP headers to be set by the server:
     * - Cross-Origin-Opener-Policy: same-origin
     * - Cross-Origin-Embedder-Policy: require-corp
     *
     * @param path - The path for the database file in OPFS (e.g., "/trilium.db")
     *               Paths without a leading slash are treated as relative to OPFS root.
     *               Leading directories are created automatically.
     * @param options - Additional options
     * @throws Error if OPFS VFS is not available
     *
     * @example
     * ```typescript
     * const provider = new BrowserSqlProvider();
     * await provider.initWasm();
     * if (provider.isOpfsAvailable()) {
     *     provider.loadFromOpfs("/my-database.db");
     * } else {
     *     console.warn("OPFS not available, using in-memory database");
     *     provider.loadFromMemory();
     * }
     * ```
     */
    loadFromOpfs(path: string, options: { createIfNotExists?: boolean } = {}): void {
        this.ensureSqlite3();

        if (!this.isOpfsAvailable()) {
            throw new Error(
                "OPFS VFS is not available. This requires:\n" +
                "1. Running in a Worker context\n" +
                "2. Browser support for OPFS (Chrome 102+, Firefox 111+, Safari 17+)\n" +
                "3. COOP/COEP headers from the server:\n" +
                "   Cross-Origin-Opener-Policy: same-origin\n" +
                "   Cross-Origin-Embedder-Policy: require-corp"
            );
        }

        console.log(`[BrowserSqlProvider] Loading database from OPFS: ${path}`);
        const startTime = performance.now();

        try {
            // OpfsDb automatically creates directories in the path
            // Mode 'c' = create if not exists
            const mode = options.createIfNotExists !== false ? 'c' : '';
            this.db = new this.sqlite3!.oo1.OpfsDb(path, mode);
            this.opfsDbPath = path;

            // Configure the database for OPFS
            // Note: WAL mode requires exclusive locking in OPFS environment
            this.db.exec("PRAGMA journal_mode = DELETE");
            this.db.exec("PRAGMA synchronous = NORMAL");

            const loadTime = performance.now() - startTime;
            console.log(`[BrowserSqlProvider] OPFS database loaded in ${loadTime.toFixed(2)}ms`);
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            console.error(`[BrowserSqlProvider] Failed to load OPFS database: ${error.message}`);
            throw error;
        }
    }

    /**
     * Check if the currently open database is stored in OPFS.
     */
    get isUsingOpfs(): boolean {
        return this.opfsDbPath !== undefined;
    }

    /**
     * Get the OPFS path of the currently open database.
     * Returns undefined if not using OPFS.
     */
    get currentOpfsPath(): string | undefined {
        return this.opfsDbPath;
    }

    /**
     * Check if the database has been initialized with a schema.
     * This is a simple sanity check that looks for the existence of core tables.
     *
     * @returns true if the database appears to be initialized
     */
    isDbInitialized(): boolean {
        this.ensureDb();

        // Check if the 'notes' table exists (a core table that must exist in an initialized DB)
        const tableExists = this.db!.selectValue(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes'"
        );

        return tableExists !== undefined;
    }

    // ==================== End OPFS Support ====================

    loadFromFile(_path: string, _isReadOnly: boolean): void {
        // Browser environment doesn't have direct file system access.
        // Use OPFS for persistent storage.
        throw new Error(
            "loadFromFile is not supported in browser environment. " +
            "Use loadFromMemory() for temporary databases, loadFromBuffer() to load from data, " +
            "or loadFromOpfs() for persistent storage."
        );
    }

    /**
     * Create an empty in-memory database.
     * Data will be lost when the page is closed.
     *
     * For persistent storage, use loadFromOpfs() instead.
     * To load demo data, call initializeDemoDatabase() after this.
     */
    loadFromMemory(): void {
        this.ensureSqlite3();
        console.log("[BrowserSqlProvider] Creating in-memory database...");
        const startTime = performance.now();

        this.db = new this.sqlite3!.oo1.DB(":memory:", "c");
        this.opfsDbPath = undefined; // Not using OPFS
        this.db.exec("PRAGMA journal_mode = WAL");

        // Initialize with demo data for in-memory databases
        // (since they won't persist anyway)
        this.initializeDemoDatabase();

        const loadTime = performance.now() - startTime;
        console.log(`[BrowserSqlProvider] In-memory database created in ${loadTime.toFixed(2)}ms`);
    }

    /**
     * Initialize the database with demo/starter data.
     * This should only be called once when creating a new database.
     *
     * For OPFS databases, this is called automatically only if the database
     * doesn't already exist.
     */
    initializeDemoDatabase(): void {
        this.ensureDb();
        console.log("[BrowserSqlProvider] Initializing database with demo data...");
        const startTime = performance.now();

        this.db!.exec(demoDbSql);

        const loadTime = performance.now() - startTime;
        console.log(`[BrowserSqlProvider] Demo data loaded in ${loadTime.toFixed(2)}ms`);
    }

    loadFromBuffer(buffer: Uint8Array): void {
        this.ensureSqlite3();
        // SQLite WASM can deserialize a database from a byte array
        const p = this.sqlite3!.wasm.allocFromTypedArray(buffer);
        try {
            this.db = new this.sqlite3!.oo1.DB({ filename: ":memory:", flags: "c" });
            this.opfsDbPath = undefined; // Not using OPFS

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

        // Check if we already have this statement cached
        if (this.statementCache.has(query)) {
            return this.statementCache.get(query)!;
        }

        // Create new statement and cache it
        const stmt = this.db!.prepare(query);
        const wasmStatement = new WasmStatement(stmt, this.db!, this.sqlite3!);
        this.statementCache.set(query, wasmStatement);
        return wasmStatement;
    }

    transaction<T>(func: (statement: Statement) => T): Transaction {
        this.ensureDb();

        const self = this;
        let savepointCounter = 0;

        // Helper function to execute within a transaction
        const executeTransaction = (beginStatement: string, ...args: unknown[]): T => {
            // If we're already in a transaction, use SAVEPOINTs for nesting
            // This mimics better-sqlite3's behavior
            if (self._inTransaction) {
                const savepointName = `sp_${++savepointCounter}_${Date.now()}`;
                self.db!.exec(`SAVEPOINT ${savepointName}`);
                try {
                    const result = func.apply(null, args as [Statement]);
                    self.db!.exec(`RELEASE SAVEPOINT ${savepointName}`);
                    return result;
                } catch (e) {
                    self.db!.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
                    throw e;
                }
            }

            // Not in a transaction, start a new one
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
        // Clean up all cached statements first
        for (const statement of this.statementCache.values()) {
            try {
                statement.finalize();
            } catch (e) {
                // Ignore errors during cleanup
                console.warn("Error finalizing statement during cleanup:", e);
            }
        }
        this.statementCache.clear();

        if (this.db) {
            this.db.close();
            this.db = undefined;
        }

        // Reset OPFS state
        this.opfsDbPath = undefined;
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
            throw new Error("Database not opened. Call loadFromMemory(), loadFromBuffer(), or loadFromOpfs() first.");
        }
    }
}
