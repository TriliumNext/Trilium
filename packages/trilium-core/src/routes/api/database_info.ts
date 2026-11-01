import type { DatabaseInfoResponse } from "@triliumnext/commons";

import becca from "../../becca/becca.js";
import { getDatabaseSizeBytes } from "../../services/database_size.js";
import { getPlatform } from "../../services/platform.js";
import { getContentCounts } from "../../services/space_usage.js";

/**
 * What the Database options page states about the knowledge base as a whole.
 *
 * Everything here is read from the database itself, which is what lets the page read the same on a
 * platform whose database is not a file at all. The two exceptions are answered by the platform: the
 * path, where there is one, and the root note standing in for the database's own age — SQLite
 * records nothing about when a file was made, and the root is created once, by the very first
 * startup that had no database to open.
 */
function getDatabaseInfo() {
    return {
        filePath: getPlatform().getDatabasePath?.() ?? null,
        utcDateCreated: becca.getNoteOrThrow("root").utcDateCreated,
        ...getContentCounts(),
        sizeBytes: getDatabaseSizeBytes()
    } satisfies DatabaseInfoResponse;
}

export default {
    getDatabaseInfo
};
