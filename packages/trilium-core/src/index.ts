import { ExecutionContext, initContext } from "./services/context";
import { CryptoProvider, initCrypto } from "./services/encryption/crypto";
import { getLog, initLog } from "./services/log";
import { initSql } from "./services/sql/index";
import { SqlService, SqlServiceParams } from "./services/sql/sql";

export type * from "./services/sql/types";
export * from "./services/sql/index";
export * as protected_session from "./services/encryption/protected_session";
export { default as data_encryption } from "./services/encryption/data_encryption"
export * as binary_utils from "./services/utils/binary";
export { default as date_utils } from "./services/utils/date";
export { getContext, type ExecutionContext } from "./services/context";
export type { CryptoProvider } from "./services/encryption/crypto";

export function initializeCore({ dbConfig, executionContext, crypto }: {
    dbConfig: SqlServiceParams,
    executionContext: ExecutionContext,
    crypto: CryptoProvider
}) {
    initLog();
    initCrypto(crypto);
    initSql(new SqlService(dbConfig, getLog()));
    initContext(executionContext);
};
