import type { OptionRow } from "@triliumnext/commons";
import { sql_init as coreSqlInit } from "@triliumnext/core";

export type { OptionRow };

export const dbReady = coreSqlInit.dbReady;
export const getDbSize = coreSqlInit.getDbSize;

export default {
    dbReady: coreSqlInit.dbReady,
    schemaExists: coreSqlInit.schemaExists,
    isDbInitialized: coreSqlInit.isDbInitialized,
    createInitialDatabase: coreSqlInit.createInitialDatabase,
    createDatabaseForSync: coreSqlInit.createDatabaseForSync,
    setDbAsInitialized: coreSqlInit.setDbAsInitialized,
    getDbSize: coreSqlInit.getDbSize,
    initializeDb: coreSqlInit.initializeDb
};
