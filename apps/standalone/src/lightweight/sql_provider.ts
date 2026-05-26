import { type BindableValue, type SAHPoolUtil, default as sqlite3InitModule } from "@sqlite.org/sqlite-wasm";
import type { DatabaseProvider, RunResult, Statement, Transaction } from "@triliumnext/core";

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
        private sqlite3: Sqlite3Module,
        private sql: string
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

    /**
     * Detect the prefix used for a parameter name in the SQL query.
     * SQLite supports @name, :name, and $name parameter styles.
     * Returns the prefix character, or ':' as default if not found.
     */
    private detectParamPrefix(paramName: string): string {
        // Search for the parameter with each possible prefix
        for (const prefix of [':', '@', '$']) {
            // Use word boundary to avoid partial matches
            const pattern = new RegExp(`\\${prefix}${paramName}(?![a-zA-Z0-9_])`);
            if (pattern.test(this.sql)) {
                return prefix;
            }
        }
        // Default to ':' if not found (most common in Trilium)
        return ':';
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
            // We detect the prefix used in the SQL for each parameter
            const bindings: { [paramName: string]: BindableValue } = {};
            for (const [key, value] of Object.entries(inputBindings)) {
                // If the key already has a prefix, use it as-is
                if (key.startsWith('@') || key.startsWith(':') || key.startsWith('$')) {
                    bindings[key] = value;
                } else {
                    // Detect the prefix used in the SQL and apply it
                    const prefix = this.detectParamPrefix(key);
                    bindings[`${prefix}${key}`] = value;
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

    // SAHPool state tracking
    private sahPoolUtil?: SAHPoolUtil;
    private sahPoolDbName?: string;

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

    // ==================== SAHPool VFS (preferred OPFS backend) ====================

    /**
     * Install the OPFS SAHPool VFS. This pre-allocates a pool of OPFS
     * SyncAccessHandle objects, enabling WAL mode and significantly faster
     * writes compared to the legacy OPFS VFS.
     *
     * Must be called after `initWasm()` and before `loadFromSahPool()`.
     * This is async because it acquires OPFS file handles.
     *
     * SAHPool does **not** require SharedArrayBuffer or COOP/COEP headers — it
     * only needs OPFS itself (a Worker context with `navigator.storage.getDirectory`).
     * This makes it usable in Capacitor's Android WebView, which doesn't support
     * cross-origin isolation.
     *
     * @param options.directory - OPFS directory for the pool (default: auto-derived from VFS name)
     * @param options.initialCapacity - Minimum number of file slots (default: 6)
     * @throws Error if the environment doesn't support OPFS (no Worker, or no OPFS API)
     */
    async installSahPool(options: { directory?: string; initialCapacity?: number } = {}): Promise<void> {
        this.ensureSqlite3();

        console.log("[BrowserSqlProvider] Installing OPFS SAHPool VFS...");
        const startTime = performance.now();

        this.sahPoolUtil = await this.sqlite3!.installOpfsSAHPoolVfs({
            clearOnInit: false,
            initialCapacity: options.initialCapacity ?? 6,
            directory: options.directory,
        });

        // Ensure enough slots for DB + WAL + journal + temp files
        await this.sahPoolUtil.reserveMinimumCapacity(options.initialCapacity ?? 6);

        const initTime = performance.now() - startTime;
        console.log(
            `[BrowserSqlProvider] SAHPool VFS installed in ${initTime.toFixed(2)}ms ` +
            `(capacity: ${this.sahPoolUtil.getCapacity()}, files: ${this.sahPoolUtil.getFileCount()})`
        );
    }

    /**
     * Whether the SAHPool VFS has been successfully installed.
     */
    get isSahPoolInstalled(): boolean {
        return this.sahPoolUtil !== undefined;
    }

    /**
     * Access the SAHPool utility for advanced operations (import/export/migration).
     */
    get sahPool(): SAHPoolUtil | undefined {
        return this.sahPoolUtil;
    }

    /**
     * Load or create a database using the SAHPool VFS.
     * This is the preferred method for persistent storage — it supports WAL mode
     * and is significantly faster than alternatives.
     *
     * @param dbName - Virtual filename within the pool (e.g., "/trilium.db").
     *                 Must start with a slash.
     * @throws Error if SAHPool VFS is not installed
     */
    loadFromSahPool(dbName: string): void {
        this.ensureSqlite3();
        if (!this.sahPoolUtil) {
            throw new Error(
                "SAHPool VFS not installed. Call installSahPool() first."
            );
        }

        console.log(`[BrowserSqlProvider] Loading database from SAHPool: ${dbName}`);
        const startTime = performance.now();

        try {
            this.db = new this.sahPoolUtil.OpfsSAHPoolDb(dbName);
            this.sahPoolDbName = dbName;

            // SAHPool supports WAL mode
            this.db.exec("PRAGMA journal_mode = WAL");
            this.db.exec("PRAGMA synchronous = NORMAL");

            const loadTime = performance.now() - startTime;
            console.log(`[BrowserSqlProvider] SAHPool database loaded in ${loadTime.toFixed(2)}ms (WAL mode)`);
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            console.error(`[BrowserSqlProvider] Failed to load SAHPool database: ${error.message}`);
            throw error;
        }
    }

    /**
     * Whether the currently open database is using the SAHPool VFS.
     */
    get isUsingSahPool(): boolean {
        return this.sahPoolDbName !== undefined;
    }

    /**
     * Check if the currently open database is stored in OPFS (via SAHPool).
     */
    get isUsingOpfs(): boolean {
        return this.sahPoolDbName !== undefined;
    }

    /**
     * Get the OPFS path of the currently open database.
     * Returns undefined if not using OPFS.
     */
    get currentOpfsPath(): string | undefined {
        return this.sahPoolDbName;
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

    loadFromFile(_path: string, _isReadOnly: boolean): void {
        // Browser environment doesn't have direct file system access.
        // Use SAHPool or OPFS for persistent storage.
        throw new Error(
            "loadFromFile is not supported in browser environment. " +
            "Use loadFromMemory() for temporary databases, loadFromBuffer() to load from data, " +
            "or loadFromSahPool() for persistent storage."
        );
    }

    /**
     * Create an empty in-memory database.
     * Data will be lost when the page is closed.
     *
     * For persistent storage, use loadFromSahPool() instead.
     */
    loadFromMemory(): void {
        this.ensureSqlite3();
        console.log("[BrowserSqlProvider] Creating in-memory database...");
        const startTime = performance.now();

        this.db = new this.sqlite3!.oo1.DB(":memory:", "c");
        this.sahPoolDbName = undefined;
        this.db.exec("PRAGMA journal_mode = WAL");

        const loadTime = performance.now() - startTime;
        console.log(`[BrowserSqlProvider] In-memory database created in ${loadTime.toFixed(2)}ms`);
    }

    loadFromBuffer(buffer: Uint8Array): void {
        this.ensureSqlite3();
        // SQLite WASM's allocFromTypedArray rejects Node's Buffer (and other
        // non-Uint8Array typed arrays) with "expecting 8/16/32/64". Normalize
        // to a plain Uint8Array view over the same memory so callers can pass
        // anything readFileSync returns.
        const view = buffer instanceof Uint8Array && buffer.constructor === Uint8Array
            ? buffer
            : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const p = this.sqlite3!.wasm.allocFromTypedArray(view);
        try {
            // Cached statements reference the previous DB and become invalid
            // once we swap connections. Drop them so callers re-prepare.
            this.clearStatementCache();
            this.db = new this.sqlite3!.oo1.DB({ filename: ":memory:", flags: "c" });
            this.sahPoolDbName = undefined;

            const rc = this.sqlite3!.capi.sqlite3_deserialize(
                this.db.pointer!,
                "main",
                p,
                view.byteLength,
                view.byteLength,
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
        const wasmStatement = new WasmStatement(stmt, this.db!, this.sqlite3!, query);
        this.statementCache.set(query, wasmStatement);
        return wasmStatement;
    }

    transaction<T>(func: (statement: Statement) => T): Transaction {
        this.ensureDb();

        const self = this;
        let savepointCounter = 0;

        // Helper function to execute within a transaction
        const executeTransaction = (beginStatement: string, ...args: unknown[]): T => {
            // If we're already in a transaction (either tracked via JS flag or via actual SQLite
            // autocommit state), use SAVEPOINTs for nesting — this handles the case where a manual
            // BEGIN was issued directly (e.g. transactionalAsync) without going through transaction().
            const sqliteInTransaction = self.db?.pointer !== undefined
                && (self.sqlite3!.capi as any).sqlite3_get_autocommit(self.db!.pointer) === 0;
            if (self._inTransaction || sqliteInTransaction) {
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

    private clearStatementCache(): void {
        for (const statement of this.statementCache.values()) {
            try {
                statement.finalize();
            } catch (e) {
                // Ignore errors during cleanup
                console.warn("Error finalizing statement during cleanup:", e);
            }
        }
        this.statementCache.clear();
    }

    close(): void {
        this.clearStatementCache();

        if (this.db) {
            this.db.close();
            this.db = undefined;
        }

        this.sahPoolDbName = undefined;
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
            throw new Error(
                "Database not opened. Call loadFromMemory(), loadFromBuffer(), " +
                "loadFromSahPool() first."
            );
        }
    }
}
