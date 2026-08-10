import { describe, expect, it } from "vitest";
import { byBookType, byNoteType, getHelpUrlForNote } from "./in_app_help.js";
import fs from "fs";
import type { HelpMetaItem, HiddenSubtreeItem } from "@triliumnext/commons";
import path from "path";
import { buildNote } from "../test/easy-froca.js";
import type FNote from "../entities/fnote.js";

describe("Help button", () => {
    it("All help notes are accessible", () => {
        function getNoteIds(item: HiddenSubtreeItem | HiddenSubtreeItem[]): string[] {
            const items: (string | string[])[] = [];

            if ("id" in item && item.id) {
                items.push(item.id);
            }

            const subitems = (Array.isArray(item) ? item : item.children);
            for (const child of subitems ?? []) {
                items.push(getNoteIds(child as (HiddenSubtreeItem | HiddenSubtreeItem[])));
            }
            return items.flat();
        }

        const allHelpNotes = [
            ...Object.values(byNoteType),
            ...Object.values(byBookType)
        ].filter((noteId) => noteId) as string[];

        const allNoteIds = new Set(getNoteIds(readHelpMeta() as unknown as HiddenSubtreeItem[]));

        for (const helpNote of allHelpNotes) {
            if (!allNoteIds.has(`_help_${helpNote}`)) {
                expect.fail(`Help note with ID ${helpNote} does not exist in the in-app help.`);
            }
        }
    });

    // Every help note is built from the markdown file its `source` names, and the server filesystem
    // is case-sensitive. A page whose title casing was changed on a case-insensitive OS
    // (Windows/macOS) can be committed with a stale-cased filename that git's core.ignorecase hides,
    // so the meta points at one casing while the file on disk has another → the page ships empty.
    it("Every source resolves to an on-disk file with exact casing", () => {
        const problems = collectSources(readHelpMeta())
            .filter((source) => !existsWithExactCase(DOCS_ROOT, source));

        if (problems.length) {
            expect.fail(
                `The following help sources do not resolve to an on-disk file with exact casing ` +
                `(the meta and the committed filename disagree — likely a case-only rename dropped by git core.ignorecase):\n` +
                problems.map((p) => `  - ${p}`).join("\n")
            );
        }
    });

    // Help pages link to each other by relative markdown path. If the target is not part of the
    // in-app help (e.g. a link into the Technical Guide subtree, which lives in docs/ but is not
    // shipped), the link dead-ends once the pages are rendered. `#root/…` hrefs are intentional
    // runtime deep-links to real system notes and are deliberately not validated here.
    it("Every internal help link points to a page that ships with the help", () => {
        const meta = readHelpMeta();
        const shipped = new Set(collectSources(meta).map(normalizeSourcePath));

        const broken: string[] = [];
        for (const source of collectSources(meta)) {
            const markdown = fs.readFileSync(path.join(DOCS_ROOT, source), "utf-8");
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

/** Root of the markdown the in-app help is built from. */
const DOCS_ROOT = path.resolve(path.join(__dirname, "../../../../docs/User Guide"));

/** The help tree as `edit-docs` writes it. */
function readHelpMeta(): HelpMetaItem[] {
    const metaPath = path.resolve(path.join(__dirname, "../../../server/src/assets/help/help_meta.json"));
    return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
}

/** Collects the source file of every help page that has one. */
function collectSources(items: HelpMetaItem[]): string[] {
    const sources: string[] = [];
    for (const item of items) {
        if (item.source) {
            sources.push(item.source);
        }
        if (item.children) {
            sources.push(...collectSources(item.children));
        }
    }
    return sources;
}

const toPosix = (filePath: string) => filePath.split(path.sep).join("/");

/** Sources are compared as posix paths so link targets and meta entries line up on Windows too. */
const normalizeSourcePath = (filePath: string) => path.posix.normalize(toPosix(filePath));

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
            entries = fs.readdirSync(current);
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

describe("getHelpUrlForNote", () => {
    it("returns undefined for null/undefined notes", () => {
        expect(getHelpUrlForNote(null)).toBeUndefined();
        expect(getHelpUrlForNote(undefined)).toBeUndefined();
    });

    it("returns the markdown help id for a markdown code note", () => {
        const note = buildNote({ title: "MD", type: "code" }) as FNote;
        note.mime = "text/markdown";
        expect(note.isMarkdown()).toBe(true);
        expect(getHelpUrlForNote(note)).toBe("6RM1Q7ppFVoj");
    });

    it("returns the per-note-type help id when one is defined", () => {
        const note = buildNote({ title: "Mermaid", type: "mermaid" });
        expect(getHelpUrlForNote(note)).toBe(byNoteType.mermaid);
        expect(getHelpUrlForNote(note)).toBe("s1aBHPd79XYj");
    });

    it("returns the calendarRoot help id for a note labelled calendarRoot", () => {
        // type with a null byNoteType entry so it falls through to the label checks
        const note = buildNote({ title: "Cal", type: "canvas", "#calendarRoot": "" });
        expect(getHelpUrlForNote(note)).toBe("l0tKav7yLHGF");
    });

    it("returns the textSnippet help id for a note labelled textSnippet", () => {
        const note = buildNote({ title: "Snippet", type: "text", "#textSnippet": "" });
        expect(getHelpUrlForNote(note)).toBe("pwc194wlRzcH");
    });

    it("returns the per-book-view help id for a book note with a viewType label", () => {
        const note = buildNote({ title: "Tbl", type: "book", "#viewType": "table" });
        expect(getHelpUrlForNote(note)).toBe(byBookType.table);
        expect(getHelpUrlForNote(note)).toBe("2FvYrpmOXm29");
    });

    it("falls back to the empty-string lookup for a book note without a viewType label", () => {
        const note = buildNote({ title: "PlainBook", type: "book" });
        // no viewType label -> getAttributeValue returns null -> "" -> byBookType[""] is undefined
        expect(getHelpUrlForNote(note)).toBeUndefined();
    });

    it("returns undefined for a plain text note with no special labels", () => {
        const note = buildNote({ title: "Plain", type: "text" });
        expect(getHelpUrlForNote(note)).toBeUndefined();
    });
});
