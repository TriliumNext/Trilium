"use strict";

import Database from "better-sqlite3";
import { existsSync } from "fs";
import dataDir from "../services/data_dir.js";
import sql_init from "../services/sql_init.js";

let dbConnection!: Database.Database;
let dbConnectionReady = false;

function resolveDbPath(): string | null {
    // Prefer the on-disk DB at DOCUMENT_PATH (production + e2e tests).
    if (existsSync(dataDir.DOCUMENT_PATH)) {
        return dataDir.DOCUMENT_PATH;
    }

    // In unit tests the main connection is in-memory, so DOCUMENT_PATH
    // doesn't exist. Fall back to the fixture file from source.
    if (process.env.TRILIUM_INTEGRATION_TEST) {
        try {
            return require.resolve("@triliumnext/core/src/test/fixtures/document.db");
        } catch {
            // Not available (e.g. bundled build) — share will return 503.
        }
    }

    return null;
}

sql_init.dbReady.then(() => {
    const dbPath = resolveDbPath();
    if (!dbPath) {
        return;
    }

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
