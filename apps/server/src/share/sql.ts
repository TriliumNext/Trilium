"use strict";

import Database from "better-sqlite3";
import dataDir from "../services/data_dir.js";
import sql_init from "../services/sql_init.js";

let dbConnection!: Database.Database;

sql_init.dbReady.then(() => {
    dbConnection = new Database(dataDir.DOCUMENT_PATH, {
        readonly: true,
        nativeBinding: process.env.BETTERSQLITE3_NATIVE_PATH || undefined
    });

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

function getRawRows<T>(query: string, params = []): T[] {
    return dbConnection.prepare(query).raw().all(params) as T[];
}

function getRow<T>(query: string, params: string[] = []): T {
    return dbConnection.prepare(query).get(params) as T;
}

function getColumn<T>(query: string, params: string[] = []): T[] {
    return dbConnection.prepare(query).pluck().all(params) as T[];
}

export default {
    getRawRows,
    getRow,
    getColumn
};
