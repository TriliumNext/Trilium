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

/** Reads `demo-<locale>.zip` from `<resourceDir>/db`, falling back to `demo.zip`. */
export function readDemoArchive(resourceDir: string, locale?: string): Buffer {
    const dbDir = path.join(resourceDir, "db");
    if (locale) {
        const localizedPath = path.join(dbDir, `demo-${locale}.zip`);
        if (fs.existsSync(localizedPath)) {
            return fs.readFileSync(localizedPath);
        }
    }
    return fs.readFileSync(path.join(dbDir, "demo.zip"));
}

export default {
    RESOURCE_DIR,
    DB_INIT_DIR,
    ELECTRON_APP_ROOT_DIR
};
