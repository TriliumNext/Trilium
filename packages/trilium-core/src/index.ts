import { ExecutionContext, initContext } from "./services/context";
import { CryptoProvider, initCrypto } from "./services/encryption/crypto";
import { getLog, initLog } from "./services/log";
import { initSql } from "./services/sql/index";
import { SqlService, SqlServiceParams } from "./services/sql/sql";

export type * from "./services/sql/types";
export * from "./services/sql/index";
export * as protected_session from "./services/protected_session";
export { default as data_encryption } from "./services/encryption/data_encryption"
export * as binary_utils from "./services/utils/binary";
export * as utils from "./services/utils/index";
export * from "./services/build";
export { default as date_utils } from "./services/utils/date";
export { default as events } from "./services/events";
export { default as blob } from "./services/blob";
export { default as options } from "./services/options";
export { default as options_init } from "./services/options_init";
export { default as app_info } from "./services/app_info";
export { default as keyboard_actions } from "./services/keyboard_actions";
export { default as entity_changes } from "./services/entity_changes";
export { default as hidden_subtree } from "./services/hidden_subtree";
export { getContext, type ExecutionContext } from "./services/context";
export * as cls from "./services/context";
export * from "./errors";
export { default as getInstanceId } from "./services/instance_id";
export type { CryptoProvider } from "./services/encryption/crypto";
export { default as note_types } from "./services/note_types";
export { default as tree } from "./services/tree";
export { default as cloning } from "./services/cloning";
export { default as handlers } from "./services/handlers";

export { default as becca } from "./becca/becca";
export { default as becca_loader } from "./becca/becca_loader";
export { default as becca_service } from "./becca/becca_service";
export { default as entity_constructor } from "./becca/entity_constructor";
export { default as similarity } from "./becca/similarity";
export { default as BAttachment } from "./becca/entities/battachment";
export { default as BAttribute } from "./becca/entities/battribute";
export { default as BBlob } from "./becca/entities/bblob";
export { default as BBranch } from "./becca/entities/bbranch";
export { default as BEtapiToken } from "./becca/entities/betapi_token";
export { default as BNote, NOTE_TYPE_ICONS } from "./becca/entities/bnote";
export { default as BOption } from "./becca/entities/boption";
export { default as BRecentNote } from "./becca/entities/brecent_note";
export { default as BRevision } from "./becca/entities/brevision";
export { default as AbstractBeccaEntity } from "./becca/entities/abstract_becca_entity";
export { default as Becca } from "./becca/becca-interface";
export type { NotePojo } from "./becca/becca-interface";

export { default as NoteSet } from "./services/search/note_set";
export { default as note_service, NoteParams } from "./services/notes";
export * as sanitize from "./services/sanitizer";

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
