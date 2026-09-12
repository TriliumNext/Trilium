import type { DatabaseCheckIntegrityResponse } from "@triliumnext/commons";

import { getLog } from "./log.js";
import { getSql } from "./sql/index.js";

/**
 * Asking SQLite whether the database is sound, which every platform can do: the check is a statement
 * the engine answers about itself, with no file to reach for.
 *
 * Logged as well as returned. The reply to a check that failed is a list of what was found, which is
 * of no use once the message that carried it is gone.
 */
export function checkIntegrity(): DatabaseCheckIntegrityResponse {
    const results = getSql().getRows<{ integrity_check: string }>("PRAGMA integrity_check");

    getLog().info(`Integrity check result: ${JSON.stringify(results)}`);

    return { results };
}
