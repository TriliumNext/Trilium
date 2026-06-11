import type { HiddenSubtreeItem } from "@triliumnext/commons";
import { InAppHelpProvider } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import { RESOURCE_DIR } from "./services/resource_dir.js";

const DOC_NOTES_DIR = path.join(RESOURCE_DIR, "doc_notes");

export default class NodejsInAppHelpProvider extends InAppHelpProvider {

    private helpContentIndex: Record<string, string> | null = null;

    getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
        const metaFilePath = path.join(DOC_NOTES_DIR, "en", "User Guide", "!!!meta.json");

        try {
            return JSON.parse(fs.readFileSync(metaFilePath).toString("utf-8"));
        } catch (e) {
            console.warn(e);
            return [];
        }
    }

    override getDocContent(docName: string): string | null {
        return this.getHelpContentIndex()[docName] ?? null;
    }

    private getHelpContentIndex(): Record<string, string> {
        if (this.helpContentIndex) {
            return this.helpContentIndex;
        }

        const indexPath = path.join(DOC_NOTES_DIR, "help_content.json");
        let index: Record<string, string>;
        try {
            index = JSON.parse(fs.readFileSync(indexPath).toString("utf-8"));
        } catch (e) {
            console.warn(e);
            index = {};
        }

        this.helpContentIndex = index;
        return index;
    }
}
