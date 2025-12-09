import { describe, expect, it } from "vitest";
import { byBookType, byNoteType } from "./in_app_help.js";
import fs from "fs";
import type { HiddenSubtreeItem } from "@triliumnext/commons";
import path from "path";

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
