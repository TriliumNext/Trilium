import type { DatabaseProvider, Statement, Transaction } from "@triliumnext/core";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { unlinkSync } from "fs";

const dbOpts: Database.Options = {
    nativeBinding: process.env.BETTERSQLITE3_NATIVE_PATH || undefined
};

export default class BetterSqlite3Provider implements DatabaseProvider {

    private dbConnection?: DatabaseType;

    constructor() {
        [`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `SIGTERM`].forEach((eventType) => {
            // closing connection is especially important to fold -wal file into the main DB file
            // (see https://sqlite.org/tempfiles.html for details)
            process.on(eventType, () => this.close());
        });
    }

    loadFromFile(path: string, isReadOnly: boolean) {
        this.dbConnection = new Database(path, {
            ...dbOpts,
            readonly: isReadOnly
        });
        this.dbConnection.pragma("journal_mode = WAL");
    }

    loadFromMemory() {
        this.dbConnection = new Database(":memory:", dbOpts);
    }

    loadFromBuffer(buffer: NonSharedBuffer) {
        // Close any existing connection so its file handles are released
        // before we replace it. Important for repeated rebuilds in tests
        // (each call would otherwise leak the previous handle).
        this.dbConnection?.close();
        this.dbConnection = new Database(buffer, dbOpts);
    }

    backup(destinationFile: string) {
        try {
            unlinkSync(destinationFile);
        } catch (e) { } // unlink throws exception if the file did not exist

        this.dbConnection?.backup(destinationFile);
    }

    prepare(query: string): Statement {
        if (!this.dbConnection) throw new Error("DB not open.");
        // Cast is safe: better-sqlite3 only returns bigint when safeIntegers() is enabled, which we don't use.
        return this.dbConnection.prepare(query) as unknown as Statement;
    }

    transaction<T>(func: (statement: Statement) => T): Transaction {
        if (!this.dbConnection) throw new Error("DB not open.");
        return this.dbConnection.transaction(func) as any;
    }

    get inTransaction() {
        if (!this.dbConnection) throw new Error("DB not open.");
        return this.dbConnection.inTransaction;
    }

    exec(query: string): void {
        this.dbConnection?.exec(query);
    }

    close() {
        this.dbConnection?.close();
    }

}
