import { AppInfo } from "@triliumnext/commons";
import path from "path";

import packageJson from "../../package.json" with { type: "json" };
import { MAX_MIGRATION_VERSION } from "../migrations/migrations.js";
import build from "./build.js";
import dataDir from "./data_dir.js";

const SYNC_VERSION = 39;
const CLIPPER_PROTOCOL_VERSION = "1.0";

export default {
    appVersion: packageJson.version,
    dbVersion: MAX_MIGRATION_VERSION,
    nodeVersion: process.version,
    syncVersion: SYNC_VERSION,
    buildDate: build.buildDate,
    buildRevision: build.buildRevision,
    dataDirectory: path.resolve(dataDir.TRILIUM_DATA_DIR),
    clipperProtocolVersion: CLIPPER_PROTOCOL_VERSION,
    utcDateTime: new Date().toISOString()
} satisfies AppInfo;
