/**
 * Filesystem-backed resolution of in-app help pages, for the help tools.
 *
 * Kept out of `@triliumnext/core`'s LLM code because it is the one tool helper
 * that reads from `RESOURCE_DIR`: the User Guide ships as static HTML on disk,
 * which the browser-hosted (standalone) build has no way to read synchronously.
 */

import type { BNote } from "@triliumnext/core";
import { readFileSync } from "fs";
import path from "path";

import resourceDir from "../../resource_dir.js";

/**
 * Resolve the on-disk HTML of a `doc` note (in-app help / User Guide pages,
 * identified by their `#docName` label), or null if it cannot be resolved.
 * The User Guide ships in English only, so the `en` tree is always used
 * (mirroring the client's doc_renderer behaviour).
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
