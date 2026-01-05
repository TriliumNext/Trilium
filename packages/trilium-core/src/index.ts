import { ExecutionContext, initContext } from "./services/context";
import { getLog, initLog } from "./services/log";
import { initSql } from "./services/sql/index";
import { SqlService, SqlServiceParams } from "./services/sql/sql";

export type * from "./services/sql/types";
export * from "./services/sql/index";
export type { ExecutionContext } from "./services/context";

export function initializeCore({ dbConfig, executionContext }: {
    dbConfig: SqlServiceParams,
    executionContext: ExecutionContext
}) {
    initLog();
    initSql(new SqlService(dbConfig, getLog()));
    initContext(executionContext);
};
