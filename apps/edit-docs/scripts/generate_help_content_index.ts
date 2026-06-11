/**
 * Regenerates the help-content search index (`help_content.json`) from the committed doc-note HTML.
 *
 * Run via `tsx apps/edit-docs/scripts/generate_help_content_index.ts` whenever the help HTML under
 * `apps/server/src/assets/doc_notes/en` changes. `edit-docs` also calls the underlying generator
 * automatically after exporting the User Guide.
 */
import path from "path";
import { fileURLToPath } from "url";

import { HELP_CONTENT_INDEX_TARGETS, HELP_HTML_ROOT, writeHelpContentIndex } from "../src/help_content_generator.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const htmlRoot = path.join(repoRoot, HELP_HTML_ROOT);
const targets = HELP_CONTENT_INDEX_TARGETS.map((target) => path.join(repoRoot, target));

const { entries, bytes } = writeHelpContentIndex(htmlRoot, targets);
console.log(`Wrote ${entries} entries (${(bytes / 1024).toFixed(0)} KiB) to:\n  ${targets.join("\n  ")}`);
