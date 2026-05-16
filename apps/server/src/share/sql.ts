"use strict";

import Database from "better-sqlite3";
import { getIntegrationTestDbPath } from "../core_assets.js";
import dataDir from "../services/data_dir.js";
import sql_init from "../services/sql_init.js";

let dbConnection!: Database.Database;
let dbConnectionReady = false;

sql_init.dbReady.then(() => {
    // The share module opens its own read-only connection to the on-disk
    // database for isolation from the main read/write connection. In
    // integration test mode `dataDir.DOCUMENT_PATH` doesn't contain a real
    // database (the main connection is in-memory, loaded from a fixture
    // buffer), so we open the fixture file directly. getIntegrationTestDbPath
    // handles bundled-vs-source path resolution; see core_assets.ts.
    const dbPath = process.env.TRILIUM_INTEGRATION_TEST
        ? getIntegrationTestDbPath()
        : dataDir.DOCUMENT_PATH;

    dbConnection = new Database(dbPath, {
        readonly: true,
        nativeBinding: process.env.BETTERSQLITE3_NATIVE_PATH || undefined
    });
    dbConnectionReady = true;

    [`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `SIGTERM`].forEach((eventType) => {
        process.on(eventType, () => {
            if (dbConnection) {
                // closing connection is especially important to fold -wal file into the main DB file
                // (see https://sqlite.org/tempfiles.html for details)
                dbConnection.close();
            }
        });
    });
});

function assertDbReady(): void {
    if (!dbConnectionReady) {
        throw new Error("Share database connection is not yet ready. The application may still be initializing.");
    }
}

function getRawRows<T>(query: string, params = []): T[] {
    assertDbReady();
    return dbConnection.prepare(query).raw().all(params) as T[];
}

function getRow<T>(query: string, params: string[] = []): T {
    assertDbReady();
    return dbConnection.prepare(query).get(params) as T;
}

function getColumn<T>(query: string, params: string[] = []): T[] {
    assertDbReady();
    return dbConnection.prepare(query).pluck().all(params) as T[];
}

export function isShareDbReady(): boolean {
    return dbConnectionReady;
}

export default {
    getRawRows,
    getRow,
    getColumn
};
