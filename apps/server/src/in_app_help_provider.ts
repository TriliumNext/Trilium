import type { HelpBundle, HiddenSubtreeItem } from "@triliumnext/commons";
import { InAppHelpProvider } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import { assetUrlFragment } from "./services/asset_path.js";
import { RESOURCE_DIR } from "./services/resource_dir.js";
import { isDev } from "./services/utils.js";

/**
 * Serves the in-app help from the two artifacts `edit-docs` builds out of `docs/User Guide`:
 * the note tree and the rendered content of its pages.
 */
export default class NodejsInAppHelpProvider extends InAppHelpProvider {

    /** The guide only changes with the application, so both files are read once per process. */
    private helpMeta: HiddenSubtreeItem[] | null = null;
    private helpContent: HelpBundle | null = null;

    /**
     * The tree is asked for on every becca load, of which there are several in a session — a
     * restore, an import, a consistency check — so it is worth not re-reading a fifth of a
     * megabyte each time. Callers only read it: the injection builds notes from the items rather
     * than writing to them.
     */
    getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
        if (!this.helpMeta) {
            this.helpMeta = readHelpFile<HiddenSubtreeItem[]>("help_meta.json") ?? [];
        }
        return this.helpMeta;
    }

    getHelpContent(): HelpBundle {
        if (!this.helpContent) {
            this.helpContent = readHelpFile<HelpBundle>("help_content.json") ?? {};
        }
        return this.helpContent;
    }

    getHelpAssetBase(): string {
        return `${assetUrlFragment}/help`;
    }

    async getHelpAsset(assetPath: string): Promise<Uint8Array | null> {
        const root = path.resolve(getHelpAssetDir());
        const filePath = path.resolve(root, assetPath);
        if (!filePath.startsWith(root + path.sep)) {
            return null;
        }

        try {
            return await fs.promises.readFile(filePath);
        } catch {
            return null;
        }
    }
}

/**
 * Where the in-app help's images and attachments live: the Markdown export in a source checkout,
 * the copy the build makes (see `copyServerAssets()`) in a packaged one.
 */
export function getHelpAssetDir() {
    if (isDev) {
        return path.join(RESOURCE_DIR, "..", "..", "..", "..", "docs", "User Guide");
    }
    return path.join(RESOURCE_DIR, "help");
}

function readHelpFile<T>(fileName: string): T | null {
    const filePath = path.join(RESOURCE_DIR, "help", fileName);

    try {
        return JSON.parse(fs.readFileSync(filePath).toString("utf-8")) as T;
    } catch (e) {
        console.warn(e);
        return null;
    }
}
