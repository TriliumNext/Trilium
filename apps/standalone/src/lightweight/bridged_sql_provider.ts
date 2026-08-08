import type { DatabaseProvider, RunResult, Statement, Transaction } from "@triliumnext/core";

/**
 * `DatabaseProvider` backed by a **native** SQLite database running inside a
 * desktop shell (e.g. the Deno Desktop prototype in `apps/desktop-deno`,
 * which uses `node:sqlite`). Statements are forwarded over the page's own
 * loopback origin with synchronous XHR — available in dedicated workers —
 * because the core `DatabaseProvider` contract is synchronous.
 *
 * This makes the database an ordinary file on the host filesystem, giving
 * durable persistence in webviews without OPFS (where the SAHPool VFS is
 * unavailable), with none of the snapshot-sync compromises of
 * `desktop_persistence.ts`.
 *
 * Protocol (see `apps/desktop-deno/main.ts` for the shell side):
 * - `GET /desktop-sql` → `{ desktopSqlBridge: true, ... }` (probe)
 * - `POST /desktop-sql` with `{ op, sql?, params?, raw?, pluck? }` where op
 *   is `exec` | `run` | `get` | `all` | `status` | `serialize`. Errors come
 *   back as non-200 with `{ error }`.
 *
 * Values are JSON with blobs wrapped as `{ "__trilium_blob__": <base64> }`;
 * booleans are normalized to 0/1 (native SQLite refuses to bind booleans,
 * unlike SQLite WASM).
 */
export default class BridgedSqlProvider implements DatabaseProvider {
    private _inTransaction = false;

    prepare(query: string): Statement {
        // Statements are prepared (and cached) shell-side on first use, so
        // this needs no round trip.
        return new BridgedStatement(query);
    }

    exec(query: string): void {
        callBridge({ op: "exec", sql: query });
    }

    transaction<T>(func: (statement: Statement) => T): Transaction {
        const self = this;
        let savepointCounter = 0;

        const executeTransaction = (beginStatement: string, ...args: unknown[]): T => {
            // Mirrors BrowserSqlProvider: nest via SAVEPOINT when a
            // transaction is already open — tracked locally or started
            // directly with a manual BEGIN (e.g. transactionalAsync), which
            // only the shell knows about.
            const shellInTransaction = callBridge({ op: "status" }).inTransaction === true;
            if (self._inTransaction || shellInTransaction) {
                const savepointName = `sp_${++savepointCounter}_${Date.now()}`;
                self.exec(`SAVEPOINT ${savepointName}`);
                try {
                    const result = func.apply(null, args as [Statement]);
                    self.exec(`RELEASE SAVEPOINT ${savepointName}`);
                    return result;
                } catch (e) {
                    self.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
                    throw e;
                }
            }

            self._inTransaction = true;
            self.exec(beginStatement);
            try {
                const result = func.apply(null, args as [Statement]);
                self.exec("COMMIT");
                return result;
            } catch (e) {
                self.exec("ROLLBACK");
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
        return this._inTransaction;
    }

    // The shell owns the database file; there is nothing to load or close on
    // this side.
    loadFromFile(): void {}
    loadFromMemory(): void {}
    loadFromBuffer(): void {}
    close(): void {}

    backup(): void {
        throw new Error("backup to file is not supported by the desktop SQL bridge. Use serialize() instead.");
    }

    serialize(): Uint8Array {
        const response = callBridge({ op: "serialize" });
        if (typeof response.blob !== "string") {
            throw new Error("Desktop SQL bridge returned no database image");
        }
        return base64ToBytes(response.blob);
    }
}

// Local base64 helpers instead of core's binary_utils: those route through
// getCrypto(), which is only available after initializeCore() — and this
// provider must already work during core initialization (initSql).
function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

const SQL_ENDPOINT = "/desktop-sql";

/** Checks whether the hosting shell offers the native SQL bridge. */
export async function probeDesktopSqlBridge(): Promise<boolean> {
    try {
        const response = await fetch(SQL_ENDPOINT);
        if (!response.ok) {
            return false;
        }
        // Static hosts may answer with the SPA fallback page; json() throwing
        // on it is handled by the catch below.
        const body = await response.json();
        return body?.desktopSqlBridge === true;
    } catch {
        return false;
    }
}

class BridgedStatement implements Statement {
    private isRawMode = false;
    private isPluckMode = false;

    constructor(private sql: string) {}

    run(...params: unknown[]): RunResult {
        const response = callBridge({ op: "run", sql: this.sql, params: normalizeParams(params) });
        return {
            changes: Number(response.changes ?? 0),
            lastInsertRowid: Number(response.lastInsertRowid ?? 0)
        };
    }

    get(params: unknown): unknown {
        const args = params === undefined ? [] : [params];
        const response = callBridge({
            op: "get",
            sql: this.sql,
            params: normalizeParams(args),
            raw: this.isRawMode,
            pluck: this.isPluckMode
        });
        return decodeResult(response.row);
    }

    all(...params: unknown[]): unknown[] {
        const response = callBridge({
            op: "all",
            sql: this.sql,
            params: normalizeParams(params),
            raw: this.isRawMode,
            pluck: this.isPluckMode
        });
        return ((response.rows ?? []) as unknown[]).map(decodeResult);
    }

    iterate(...params: unknown[]): IterableIterator<unknown> {
        // The bridge is request/response, so fetch eagerly and iterate the
        // buffered rows (callers only use this for moderate result sets).
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
}

function callBridge(payload: Record<string, unknown>): Record<string, any> {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", SQL_ENDPOINT, false); // synchronous — see class docs
    xhr.setRequestHeader("content-type", "application/json");
    xhr.send(JSON.stringify(payload));

    if (xhr.status !== 200) {
        let message = `Desktop SQL bridge request failed (HTTP ${xhr.status})`;
        try {
            message = JSON.parse(xhr.responseText).error ?? message;
        } catch {
            // Keep the generic message.
        }
        throw new Error(message);
    }
    return JSON.parse(xhr.responseText);
}

/**
 * Mirrors WasmStatement's parameter handling: a single object argument means
 * named parameters (sent as `{named}`), anything else is positional.
 */
function normalizeParams(params: unknown[]): unknown {
    if (params.length === 1 && Array.isArray(params[0])) {
        return params[0].map(encodeValue);
    }
    if (
        params.length === 1 &&
        typeof params[0] === "object" &&
        params[0] !== null &&
        !(params[0] instanceof Uint8Array)
    ) {
        const named: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params[0])) {
            named[key] = encodeValue(value);
        }
        return { named };
    }
    return params.map(encodeValue);
}

function encodeValue(value: unknown): unknown {
    if (value instanceof Uint8Array) {
        return { __trilium_blob__: bytesToBase64(value) };
    }
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    if (value === undefined) {
        return null;
    }
    return value;
}

function decodeValue(value: unknown): unknown {
    if (value && typeof value === "object" && "__trilium_blob__" in value) {
        return base64ToBytes((value as { __trilium_blob__: string }).__trilium_blob__);
    }
    return value;
}

/** Decodes a row in object, raw-array, or plucked-scalar form. */
function decodeResult(row: unknown): unknown {
    if (row === null || row === undefined) {
        return undefined;
    }
    if (Array.isArray(row)) {
        return row.map(decodeValue);
    }
    if (typeof row === "object" && !("__trilium_blob__" in row)) {
        const decoded: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
            decoded[key] = decodeValue(value);
        }
        return decoded;
    }
    return decodeValue(row);
}
