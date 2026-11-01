import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubShareSql } from "../../test/shaca_mocking.js";
import shaca from "./shaca.js";
import shacaLoader from "./shaca_loader.js";

const ROWS: Record<string, unknown[][]> = {
    notes: [
        [ "_share", "Shared", "text", "text/html", "blob1", "2025-01-01", false ],
        [ "open", "Open", "text", "text/html", "blob2", "2025-01-01", false ],
        [ "locked", "Secret", "text", "text/html", "blob3", "2025-01-01", true ]
    ],
    branches: [
        [ "_share_open", "open", "_share", "", false, "2025-01-01" ],
        [ "_share_locked", "locked", "_share", "", false, "2025-01-01" ]
    ],
    attributes: [
        [ "attr1", "_share", "label", "shareIndex", "", false, 10 ]
    ],
    attachments: [
        [ "openAttachment", "open", "file", "text/plain", "Notes", "blob4", "2025-01-01" ],
        [ "lockedAttachment", "locked", "file", "text/plain", "Keys", "blob5", "2025-01-01" ]
    ]
};

describe("shaca loader", () => {
    const getColumn = vi.fn(() => [ "_share", "open", "locked" ]);
    const getRawRows = vi.fn((query: string) => ROWS[/FROM (\w+)/.exec(query)?.[1] ?? ""]);
    let restore: () => void;

    beforeEach(() => {
        shaca.reset();
        getColumn.mockClear();
        getRawRows.mockClear();
        restore = stubShareSql({ getColumn, getRawRows });
    });

    afterEach(() => {
        restore();
        shaca.reset();
    });

    it("loads the share subtree and leaves protected notes' attachments out", () => {
        shacaLoader.load();

        expect(getColumn)
            .toHaveBeenCalledWith(expect.stringContaining("WITH RECURSIVE"), [ "_share" ]);
        for (const [ query ] of getRawRows.mock.calls) {
            expect(query).toContain("('_share','open','locked')");
        }
        expect(shaca.loaded).toBe(true);
        expect(Object.keys(shaca.notes)).toEqual([ "_share", "open", "locked" ]);
        expect(shaca.getNote("_share").getChildNotes().map((note) => note.noteId))
            .toEqual([ "open", "locked" ]);
        expect(shaca.getNote("locked").title).toBe("[protected]");
        expect(shaca.shareIndexEnabled).toBe(true);
        expect(Object.keys(shaca.attachments)).toEqual([ "openAttachment" ]);
        expect(shaca.getNote("open").getAttachments().map((a) => a.title)).toEqual([ "Notes" ]);
        expect(shaca.getNote("locked").getAttachments()).toEqual([]);
    });

    it("loads only while the cache is empty", () => {
        shacaLoader.ensureLoad();
        shacaLoader.ensureLoad();
        expect(getColumn).toHaveBeenCalledTimes(1);

        shaca.reset();
        shacaLoader.ensureLoad();
        expect(getColumn).toHaveBeenCalledTimes(2);
        expect(shaca.hasNote("open")).toBe(true);
    });
});
