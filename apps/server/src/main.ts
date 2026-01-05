/*
 * Make sure not to import any modules that depend on localized messages via i18next here, as the initializations
 * are loaded later and will result in an empty string.
 */

import { initializeCore } from "@triliumnext/core";

import { initializeTranslations } from "./services/i18n.js";
import BetterSqlite3Provider from "./sql_provider.js";

async function startApplication() {
    await initializeTranslations();
    const config = (await import("./services/config.js")).default;
    initializeCore({
        dbConfig: {
            provider: new BetterSqlite3Provider(),
            isReadOnly: config.General.readOnly,
            async onTransactionCommit() {
                const ws = (await import("./services/ws.js")).default;
                ws.sendTransactionEntityChangesToAllClients();
            },
            async onTransactionRollback() {
                const cls = (await import("./services/cls.js")).default;
                const becca_loader = (await import("./becca/becca_loader.js")).default;
                const entity_changes = (await import("./services/entity_changes.js")).default;
                const log = (await import("./services/log")).default;

                const entityChangeIds = cls.getAndClearEntityChangeIds();

                if (entityChangeIds.length > 0) {
                    log.info("Transaction rollback dirtied the becca, forcing reload.");

                    becca_loader.load();
                }

                // the maxEntityChangeId has been incremented during failed transaction, need to recalculate
                entity_changes.recalculateMaxEntityChangeId();
            }
        }
    });
    const startTriliumServer = (await import("./www.js")).default;
    await startTriliumServer();
}

startApplication();
