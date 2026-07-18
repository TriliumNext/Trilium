import { describe, expect, it } from "vitest";
import { byBookType, byNoteType, getHelpUrlForNote } from "./in_app_help.js";
import fs from "fs";
import type { HiddenSubtreeItem } from "@triliumnext/commons";
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

        const metaPath = path.resolve(path.join(__dirname, "../../../server/src/assets/doc_notes/en/User Guide/!!!meta.json"));
        const meta: HiddenSubtreeItem[] = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        const allNoteIds = new Set(getNoteIds(meta));

        for (const helpNote of allHelpNotes) {
            if (!allNoteIds.has(`_help_${helpNote}`)) {
                expect.fail(`Help note with ID ${helpNote} does not exist in the in-app help.`);
            }
        }
    });

    // The in-app help client (doc_renderer.ts) requests `doc_notes/<lang>/<docName>.html`, and the
    // server filesystem is case-sensitive. A doc whose title casing was changed on a case-insensitive
    // OS (Windows/macOS) can be committed with a stale-cased filename that git's core.ignorecase hides,
    // so the meta points at one casing while the file on disk has another → 404 in production.
    it("Every docName resolves to an on-disk file with exact casing", () => {
        const docNotesEnRoot = path.resolve(path.join(__dirname, "../../../server/src/assets/doc_notes/en"));
        const meta: HiddenSubtreeItem[] = JSON.parse(fs.readFileSync(path.join(docNotesEnRoot, "User Guide/!!!meta.json"), "utf-8"));

        const problems: string[] = [];
        for (const docName of collectDocNames(meta)) {
            if (!existsWithExactCase(docNotesEnRoot, `${docName}.html`)) {
                problems.push(docName);
            }
        }

        if (problems.length) {
            expect.fail(
                `The following help docNames do not resolve to an on-disk .html file with exact casing ` +
                `(the meta and the committed filename disagree — likely a case-only rename dropped by git core.ignorecase):\n` +
                problems.map((p) => `  - ${p}`).join("\n")
            );
        }
    });

    // Internal help links are `href="#root/<notePath>/_help_<noteId>"`. If the target `_help_` note is
    // not exported into the in-app help (e.g. a link into the Technical Guide subtree, which lives in
    // docs/ but is not shipped as doc_notes), the link dead-ends — the export renders it as
    // "[missing note]". Links whose last segment is NOT a `_help_` note (e.g. `#root/_hidden/_options/…`)
    // are intentional runtime deep-links to real system notes and are deliberately not validated here.
    it("Every internal help link points to an existing help note", () => {
        const docNotesEnRoot = path.resolve(path.join(__dirname, "../../../server/src/assets/doc_notes/en"));
        const meta: HiddenSubtreeItem[] = JSON.parse(fs.readFileSync(path.join(docNotesEnRoot, "User Guide/!!!meta.json"), "utf-8"));
        const definedIds = new Set(collectHelpIds(meta));

        const broken: string[] = [];
        for (const htmlFile of collectHtmlFiles(docNotesEnRoot)) {
            const html = fs.readFileSync(htmlFile, "utf-8");
            const relFile = path.relative(docNotesEnRoot, htmlFile);
            // Match anchors so the failure message can quote the link text (often "[missing note]").
            for (const match of html.matchAll(/<a\b[^>]*href="#root\/([^"]+)"[^>]*>(.*?)<\/a>/gs)) {
                const notePath = match[1].split(/[#?]/)[0];
                const target = notePath.split("/").pop() ?? "";
                if (target.startsWith("_help_") && !definedIds.has(target)) {
                    broken.push(`${relFile}: "${match[2].trim()}" -> ${target}`);
                }
            }
        }

        if (broken.length) {
            expect.fail(
                `The following in-app help links point to notes that are not part of the in-app help ` +
                `(the target is not in !!!meta.json, so it renders as "[missing note]"). Either export the ` +
                `target page into the help tree or remove/repoint the link:\n` +
                broken.map((b) => `  - ${b}`).join("\n")
            );
        }
    });
});

/** Collects every `_help_*` note id defined in the help meta tree. */
function collectHelpIds(items: HiddenSubtreeItem[]): string[] {
    const ids: string[] = [];
    for (const item of items) {
        if (item.id) {
            ids.push(item.id);
        }
        if (item.children) {
            ids.push(...collectHelpIds(item.children as HiddenSubtreeItem[]));
        }
    }
    return ids;
}

/** Recursively lists every `.html` file under `dir`. */
function collectHtmlFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectHtmlFiles(full));
        } else if (entry.name.endsWith(".html")) {
            files.push(full);
        }
    }
    return files;
}

/** Collects every `docName` label value from the help meta tree. */
function collectDocNames(items: HiddenSubtreeItem[]): string[] {
    const docNames: string[] = [];
    for (const item of items) {
        const docName = item.attributes?.find((a) => a.name === "docName")?.value;
        if (docName) {
            docNames.push(docName);
        }
        if (item.children) {
            docNames.push(...collectDocNames(item.children as HiddenSubtreeItem[]));
        }
    }
    return docNames;
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
