import fs from "fs";
import { convert as convertToText } from "html-to-text";
import path from "path";

/** Path (relative to the repo root) of the English doc-note HTML the index is built from. */
export const HELP_HTML_ROOT = "apps/server/src/assets/doc_notes/en";

/**
 * Paths (relative to the repo root) the index JSON is written to: the server asset the backend
 * reads for search, and the standalone asset the (web-based) worker bundles.
 */
export const HELP_CONTENT_INDEX_TARGETS = [
    "apps/server/src/assets/doc_notes/help_content.json",
    "apps/standalone/src/assets/help_content.json"
];

/**
 * Builds a `{ docName -> plain text }` search index from a tree of doc-note HTML files.
 *
 * `docName` is each file's POSIX path relative to `htmlRootDir`, minus the `.html` extension — i.e.
 * exactly the `docName` label the hidden subtree assigns to that note. The text is extracted with
 * `html-to-text` (the same library the share-theme export uses for its search index), so help
 * content is searchable identically across server, desktop, and the (web-based) standalone client,
 * which cannot read the HTML files from disk and instead bundles this index.
 */
export function generateHelpContentIndex(htmlRootDir: string): Record<string, string> {
    const index: Record<string, string> = {};
    collectInto(htmlRootDir, htmlRootDir, index);
    return index;
}

/**
 * Generates the help-content index from `htmlRootDir` and writes the JSON to each of `targetPaths`
 * (typically the server asset the backend reads and the standalone asset the worker bundles).
 */
export function writeHelpContentIndex(htmlRootDir: string, targetPaths: string[]) {
    const index = generateHelpContentIndex(htmlRootDir);
    const json = JSON.stringify(index);
    for (const target of targetPaths) {
        fs.writeFileSync(target, json);
    }
    return { entries: Object.keys(index).length, bytes: json.length };
}

function collectInto(rootDir: string, dir: string, index: Record<string, string>) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectInto(rootDir, fullPath, index);
        } else if (entry.isFile() && entry.name.endsWith(".html")) {
            const docName = path.relative(rootDir, fullPath).split(path.sep).join("/").replace(/\.html$/, "");
            const html = fs.readFileSync(fullPath, "utf-8");
            index[docName] = convertToText(html, {
                wordwrap: false,
                // Keep headings as written (html-to-text upper-cases them by default) so search snippets
                // read naturally; matching is case-insensitive regardless.
                selectors: ["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({ selector, options: { uppercase: false } }))
            }).trim();
        }
    }
}
