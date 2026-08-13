import type { HelpBundle, HiddenSubtreeItem } from "@triliumnext/commons";
import { InAppHelpProvider } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import { assetUrlFragment } from "./services/asset_path.js";
import { RESOURCE_DIR } from "./services/resource_dir.js";

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
