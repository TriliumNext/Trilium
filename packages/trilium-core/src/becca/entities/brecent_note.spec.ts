import { describe, expect, it } from "vitest";

import BRecentNote from "./brecent_note.js";

describe("BRecentNote static metadata", () => {
    it("exposes entityName, primaryKeyName and hashedProperties", () => {
        expect(BRecentNote.entityName).toBe("recent_notes");
        expect(BRecentNote.primaryKeyName).toBe("noteId");
        expect(BRecentNote.hashedProperties).toContain("noteId");
        expect(BRecentNote.hashedProperties).toContain("notePath");
    });
});

describe("BRecentNote instance", () => {
    it("populates fields from the row and keeps the supplied utcDateCreated", () => {
        const recentNote = new BRecentNote({
            noteId: "brecent-spec-1",
            notePath: "root/brecent-spec-1",
            utcDateCreated: "2025-06-27 14:10:39.688+0300"
        });

        expect(recentNote.noteId).toBe("brecent-spec-1");
        expect(recentNote.notePath).toBe("root/brecent-spec-1");
        expect(recentNote.utcDateCreated).toBe("2025-06-27 14:10:39.688+0300");
    });

    it("defaults utcDateCreated to the current time when empty", () => {
        const recentNote = new BRecentNote({
            noteId: "brecent-spec-2",
            notePath: "root/brecent-spec-2",
            utcDateCreated: ""
        });

        expect(typeof recentNote.utcDateCreated).toBe("string");
        expect(recentNote.utcDateCreated.length).toBeGreaterThan(0);
    });

    it("getPojo returns the expected shape", () => {
        const recentNote = new BRecentNote({
            noteId: "brecent-spec-3",
            notePath: "root/brecent-spec-3",
            utcDateCreated: "2025-06-27 14:10:39.688+0300"
        });

        expect(recentNote.getPojo()).toEqual({
            noteId: "brecent-spec-3",
            notePath: "root/brecent-spec-3",
            utcDateCreated: "2025-06-27 14:10:39.688+0300"
        });
    });
});
