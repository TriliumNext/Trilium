import { AppInfo } from "@triliumnext/commons";
import { app_info as coreAppInfo } from "@triliumnext/core";
import path from "path";

import dataDir from "./data_dir.js";

export default {
    ...coreAppInfo,
    nodeVersion: process.version,
    dataDirectory: path.resolve(dataDir.TRILIUM_DATA_DIR),
} satisfies AppInfo;
