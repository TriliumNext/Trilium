import build from "./build.js";
import packageJson from "../../package.json" with { type: "json" };
import { AppInfo } from "@triliumnext/commons";
import { getMaxMigrationVersion } from "../migrations/migrations.js";

// 41: in-app help notes became virtual (never persisted/synced); un-migrated peers would
//     still push _help entity changes, so they must upgrade before syncing.
// 42: the handwriting note type; an older peer's consistency check turns notes of a type it
//     does not know into file notes and syncs the change.
const SYNC_VERSION = 42;
const CLIPPER_PROTOCOL_VERSION = "1.1";

const appInfo: AppInfo = {
    appVersion: packageJson.version,
    dbVersion: getMaxMigrationVersion(),
    syncVersion: SYNC_VERSION,
    buildDate: build.buildDate,
    buildRevision: build.buildRevision,
    clipperProtocolVersion: CLIPPER_PROTOCOL_VERSION,
    utcDateTime: new Date().toISOString()
}

export default appInfo;
