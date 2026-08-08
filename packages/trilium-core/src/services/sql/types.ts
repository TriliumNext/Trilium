export type Params = any;

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
    lastInsertRowid: number;
}

export interface DatabaseProvider {
    loadFromFile(path: string, isReadOnly: boolean): void;
    loadFromMemory(): void;
    loadFromBuffer(buffer: Uint8Array): void;
    /** Copies the database to the given file, resolving only once the copy has fully completed. */
    backup(destinationFile: string): void | Promise<void>;
    /**
     * Serialize the database to a byte array.
     * Optional - only implemented by browser-based providers.
     */
    serialize?(): Uint8Array;
    /**
     * Releases the database file, leaving the provider with no connection until a `loadFrom*` call
     * gives it one again. Every later query fails until then, deliberately: it is the caller's job to
     * re-attach, and a silent reconnection would hide a swap that went wrong.
     *
     * Optional - only implemented where the database is a file that can be replaced underneath.
     */
    detach?(): void;
    /**
     * Whether there is a connection at all. Answers `false` between a {@link detach} and the
     * `loadFrom*` that follows it, which is a window a restore runs inside and an erased database
     * never leaves.
     *
     * Optional, and treated as "attached" where a provider does not answer.
     */
    isAttached?(): boolean;
    prepare(query: string): Statement;
    transaction<T>(func: (statement: Statement) => T): Transaction;
    get inTransaction(): boolean;
    exec(query: string): void;
    close(): void;
}
