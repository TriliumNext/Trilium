import Database, { type Database as DatabaseType } from "better-sqlite3";
import { readFileSync } from "fs";

import dataDirs from "./data_dir";
import type { DatabaseProvider, Statement, Transaction } from "./sql";

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
        this.dbConnection = new Database(buffer, dbOpts);
    }

    backup(destinationFile: string) {
        this.dbConnection?.backup(destinationFile);
    }

    prepare(query: string): Statement {
        if (!this.dbConnection) throw new Error("DB not open.");
        return this.dbConnection.prepare(query);
    }

    transaction<T>(func: (statement: Statement) => T): Transaction {
        if (!this.dbConnection) throw new Error("DB not open.");
        return this.dbConnection.transaction(func);
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

function buildIntegrationTestDatabase(dbPath?: string) {
    const dbBuffer = readFileSync(dbPath ?? dataDirs.DOCUMENT_PATH);
    return new Database(dbBuffer, dbOpts);
}
