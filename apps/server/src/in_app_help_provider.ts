import type { HelpBundle, HiddenSubtreeItem } from "@triliumnext/commons";
import { InAppHelpProvider } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import { RESOURCE_DIR } from "./services/resource_dir.js";

/**
 * Serves the in-app help from the two artifacts `edit-docs` builds out of `docs/User Guide`:
 * the note tree and the rendered content of its pages.
 */
export default class NodejsInAppHelpProvider extends InAppHelpProvider {

    /** The guide only changes with the application, so both files are read once per process. */
    private helpContent: HelpBundle | null = null;

    getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
        return readHelpFile<HiddenSubtreeItem[]>("help_meta.json") ?? [];
    }

    getHelpContent(): HelpBundle {
        if (!this.helpContent) {
            this.helpContent = readHelpFile<HelpBundle>("help_content.json") ?? {};
        }
        return this.helpContent;
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
