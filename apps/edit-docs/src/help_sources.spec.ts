import { readdirSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { buildHelpMeta, type HelpSources } from "./help_meta_generator.js";

/**
 * The in-app help checked against the markdown it is built from.
 *
 * The tree that ships carries no trace of which file produced each page — that mapping is a build
 * concern and stays here — so these run the generator over the committed export instead, which
 * also means they check the export as it is now rather than the artifact as it was last written.
 */

const DOCS_ROOT = path.join(__dirname, "..", "..", "..", "docs", "User Guide");

describe("in-app help sources", () => {
    const { sources } = buildHelpMeta(JSON.parse(readFileSync(path.join(DOCS_ROOT, "!!!meta.json"), "utf-8")));
    const pages = sourcePaths(sources);

    // A walk that reached nothing would pass every check below on emptiness alone.
    it("finds the guide", () => {
        expect(pages.length).toBeGreaterThan(100);
    });

    // The server filesystem is case-sensitive. A page whose title casing was changed on a
    // case-insensitive OS (Windows/macOS) can be committed with a stale-cased filename that git's
    // core.ignorecase hides, so the export points at one casing while the file on disk has
    // another → the page ships empty.
    it("names a file that exists, with the casing it is stored under", () => {
        const problems = pages.filter((source) => !existsWithExactCase(DOCS_ROOT, source));

        if (problems.length) {
            expect.fail(
                `The following help sources do not resolve to an on-disk file with exact casing ` +
                `(the export and the committed filename disagree — likely a case-only rename dropped ` +
                `by git core.ignorecase):\n` +
                problems.map((p) => `  - ${p}`).join("\n")
            );
        }
    });

    // Help pages link to each other by relative markdown path. If the target is not part of the
    // in-app help (e.g. a link into the Technical Guide subtree, which lives in docs/ but is not
    // shipped), the link dead-ends once the pages are rendered. `#root/…` hrefs are intentional
    // runtime deep-links to real system notes and are deliberately not validated here.
    it("links only to pages that ship with it", () => {
        const shipped = new Set(pages.map(normalizeSourcePath));
        const broken: string[] = [];

        for (const source of pages) {
            const markdown = readFileSync(path.join(DOCS_ROOT, source), "utf-8");
            for (const match of markdown.matchAll(/<a\b[^>]*class="reference-link"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs)) {
                const href = decodeURIComponent(match[1].split(/[#?]/)[0]);
                if (href.startsWith("#root/")) {
                    continue;
                }

                const target = normalizeSourcePath(path.posix.join(path.posix.dirname(toPosix(source)), href));

                // Markdown targets must be pages of the guide; anything else (an attachment such as
                // a .dat or .js file, or a folder) only has to exist on disk.
                const resolves = href.endsWith(".md")
                    ? shipped.has(target)
                    : existsWithExactCase(DOCS_ROOT, target) || existsWithExactCase(DOCS_ROOT, `${target}.md`);

                if (!resolves) {
                    broken.push(`${source}: "${match[2].trim()}" -> ${href}`);
                }
            }
        }

        if (broken.length) {
            expect.fail(
                `The following in-app help links point to pages that are not part of the in-app help. ` +
                `Either bring the target page into the help tree or remove/repoint the link:\n` +
                broken.map((b) => `  - ${b}`).join("\n")
            );
        }
    });
});

/** The content file of every page that has one; folders contribute only a directory. */
function sourcePaths(sources: HelpSources): string[] {
    return Object.values(sources)
        .map(({ source }) => source)
        .filter((source): source is string => !!source);
}

/**
 * Resolves `relativePath` under `rootDir` one segment at a time via `readdirSync`, which reports the
 * real on-disk names regardless of filesystem case sensitivity. `fs.existsSync` alone would wrongly
 * pass a mis-cased path on case-insensitive dev machines, so this makes the check meaningful everywhere.
 */
function existsWithExactCase(rootDir: string, relativePath: string): boolean {
    let current = rootDir;
    for (const segment of relativePath.split("/")) {
        let entries: string[];
        try {
            entries = readdirSync(current);
        } catch {
            return false;
        }
        if (!entries.includes(segment)) {
            return false;
        }
        current = path.join(current, segment);
    }
    return true;
}

const toPosix = (filePath: string) => filePath.split(path.sep).join("/");

/** Sources are compared as posix paths so link targets and meta entries line up on Windows too. */
const normalizeSourcePath = (filePath: string) => path.posix.normalize(toPosix(filePath));
