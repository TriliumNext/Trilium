/**
 * Filesystem-backed resolution of `doc` notes, for the LLM tools.
 *
 * Kept out of `@triliumnext/core`'s LLM code because it is the one tool helper
 * that reads from `RESOURCE_DIR`: these pages ship as static HTML on disk, which
 * the browser-hosted (standalone) build has no way to read synchronously.
 */

import type { BNote } from "@triliumnext/core";
import { readFileSync } from "fs";
import path from "path";

import resourceDir from "../../resource_dir.js";

/**
 * Resolve the on-disk HTML of a `doc` note (identified by its `#docName` label),
 * or null if it cannot be resolved. The `en` tree is always used: the assistant
 * reads these pages to answer in its own words, so a translation would only
 * narrow what it can match against.
 */
export function getDocNoteHtml(note: BNote): string | null {
    const docName = note.getLabelValue("docName");
    if (!docName) {
        return null;
    }

    const docNotesDir = path.resolve(resourceDir.RESOURCE_DIR, "doc_notes");
    const filePath = path.resolve(docNotesDir, "en", `${docName}.html`);
    if (!filePath.startsWith(docNotesDir + path.sep)) {
        // Path traversal guard — the docName label is note data, not trusted input.
        return null;
    }

    try {
        return readFileSync(filePath, "utf-8");
    } catch {
        return null;
    }
}
