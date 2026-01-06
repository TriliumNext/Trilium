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
    lastInsertRowid: number | bigint;
}

export interface DatabaseProvider {
    loadFromFile(path: string, isReadOnly: boolean): void;
    loadFromMemory(): void;
    loadFromBuffer(buffer: Uint8Array): void;
    backup(destinationFile: string): void;
    prepare(query: string): Statement;
    transaction<T>(func: (statement: Statement) => T): Transaction;
    get inTransaction(): boolean;
    exec(query: string): void;
    close(): void;
}
