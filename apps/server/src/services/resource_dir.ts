import path from "path";
import fs from "fs";

import { getResourceDir } from "./utils.js";
export const RESOURCE_DIR = path.join(getResourceDir(), "assets");

// where the "trilium" executable is
const ELECTRON_APP_ROOT_DIR = path.resolve(RESOURCE_DIR, "../..");
const DB_INIT_DIR = path.resolve(RESOURCE_DIR, "db");

if (!fs.existsSync(DB_INIT_DIR)) {
    console.error(`Could not find DB initialization directory: ${DB_INIT_DIR}`);
    process.exit(1);
}

export default {
    RESOURCE_DIR,
    DB_INIT_DIR,
    ELECTRON_APP_ROOT_DIR
};
