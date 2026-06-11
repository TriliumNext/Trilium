import type { HiddenSubtreeItem } from "@triliumnext/commons";
import { InAppHelpProvider, options } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import { RESOURCE_DIR } from "./services/resource_dir.js";

const DOC_NOTES_DIR = path.join(RESOURCE_DIR, "doc_notes");

// `docName` values originate from our own hidden-subtree definitions, but validate defensively
// against path traversal before touching the filesystem. Mirrors `isValidDocName` on the client.
const VALID_DOC_NAME = /^[a-zA-Z0-9_/\- ()]+$/;

export default class NodejsInAppHelpProvider extends InAppHelpProvider {

    getHelpHiddenSubtreeData(): HiddenSubtreeItem[] {
        const helpDir = path.join(DOC_NOTES_DIR, "en", "User Guide");
        const metaFilePath = path.join(helpDir, "!!!meta.json");

        try {
            return JSON.parse(fs.readFileSync(metaFilePath).toString("utf-8"));
        } catch (e) {
            console.warn(e);
            return [];
        }
    }

    override getDocContent(docName: string): string | null {
        if (!docName || !VALID_DOC_NAME.test(docName)) {
            return null;
        }

        // The User Guide ships in English only (see doc_renderer); other docs may be localized.
        const language = docName.includes("User Guide") ? "en" : (options.getOptionOrNull("locale") ?? "en");

        return readDocFile(language, docName) ?? readDocFile("en", docName);
    }
}

function readDocFile(language: string, docName: string): string | null {
    try {
        return fs.readFileSync(path.join(DOC_NOTES_DIR, language, `${docName}.html`)).toString("utf-8");
    } catch {
        return null;
    }
}
