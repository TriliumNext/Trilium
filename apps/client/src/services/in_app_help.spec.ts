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
});

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
