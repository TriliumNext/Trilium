import type { HiddenSubtreeItem } from "@triliumnext/commons";
import { InAppHelpProvider } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import { RESOURCE_DIR } from "./services/resource_dir.js";

export default class NodejsInAppHelpProvider extends InAppHelpProvider {

    getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
        const helpDir = path.join(RESOURCE_DIR, "doc_notes", "en", "User Guide");
        const metaFilePath = path.join(helpDir, "!!!meta.json");

        try {
            return JSON.parse(fs.readFileSync(metaFilePath).toString("utf-8"));
        } catch (e) {
            console.warn(e);
            return [];
        }
    }
}
