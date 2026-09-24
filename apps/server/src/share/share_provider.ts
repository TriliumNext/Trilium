import { initShare } from "@triliumnext/core/src/share/index.js";
import { readFileSync } from "fs";
import { join } from "path";

import { isScriptingEnabled } from "../services/scripting_guard.js";
import { getResourceDir } from "../services/utils.js";
import sql, { isShareDbReady } from "./sql.js";

const templateCache: Map<string, string> = new Map();
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

function readTemplate(name: string) {
    const path = getDefaultTemplatePath(name);
    const cachedTemplate = templateCache.get(path);

    if (cachedTemplate) {
        return cachedTemplate;
    }

    const templateString = readFileSync(path, "utf-8");
    templateCache.set(path, templateString);

    return templateString;
}

function getDefaultTemplatePath(template: string) {
    return process.env.NODE_ENV === "development"
        ? join(__dirname, `../../../../packages/share-theme/src/templates/${template}.ejs`)
        : join(getResourceDir(), `share-theme/templates/${template}.ejs`);
}
