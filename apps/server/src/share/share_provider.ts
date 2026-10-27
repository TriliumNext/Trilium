import { initShare } from "@triliumnext/core/src/share/index.js";
import { readFileSync, statSync } from "fs";
import { join } from "path";

import { isScriptingEnabled } from "../services/scripting_guard.js";
import { getResourceDir } from "../services/utils.js";
import sql, { isShareDbReady } from "./sql.js";

const templateCache = new Map<string, { template: string; modified: number }>();
let registered = false;

/**
 * Registers what the share subsystem needs from this platform: rows over the read-only connection
 * `sql.ts` opens beside the main one, and the share theme's templates from disk. Both the share
 * routes and the share-theme export call this, so it runs whichever of them is reached first.
 */
export function registerShareProvider() {
    if (registered) {
        return;
    }

    initShare({
        sql,
        readTemplate,
        isScriptingEnabled,
        isReady: isShareDbReady
    });
    registered = true;
}

/**
 * Reads a template of the share theme once. In development it reads the file again once its
 * modification time changes, so edits show at once.
 */
function readTemplate(name: string) {
    const path = getDefaultTemplatePath(name);
    const modified = process.env.NODE_ENV === "development" ? statSync(path).mtimeMs : 0;
    const cached = templateCache.get(path);
    if (cached?.modified === modified) {
        return cached.template;
    }

    const template = readFileSync(path, "utf-8");
    templateCache.set(path, { template, modified });
    return template;
}

function getDefaultTemplatePath(template: string) {
    return process.env.NODE_ENV === "development"
        ? join(__dirname, `../../../../packages/share-theme/src/templates/${template}.ejs`)
        : join(getResourceDir(), `share-theme/templates/${template}.ejs`);
}
