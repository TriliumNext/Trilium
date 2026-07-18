import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getSql } from "../../services/sql/index";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core recent-notes route through {@link CoreApiTester} (no
 * Express), so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

function getRecentNote(noteId: string): { notePath: string; utcDateCreated: string } | null {
    return getSql().getRowOrNull<{ notePath: string; utcDateCreated: string }>(
        "SELECT notePath, utcDateCreated FROM recent_notes WHERE noteId = ?",
        [ noteId ]
    );
}

describe("Recent notes API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("records a recent note and persists it to the DB", async () => {
        const { noteId } = await createTextNote(api, { title: "Recently visited" });
        const notePath = `root/${noteId}`;

        const res = await api.post("/api/recent-notes", {
            body: { noteId, notePath }
        });
        expect(res.status).toBe(204);
        expect(res.body).toBeUndefined();

        const row = getRecentNote(noteId);
        expect(row).not.toBeNull();
        expect(row?.notePath).toBe(notePath);
        expect(row?.utcDateCreated).toBeTruthy();
    });

    it("upserts on the noteId primary key when the same note is revisited", async () => {
        const { noteId } = await createTextNote(api, { title: "Revisited" });

        const first = await api.post("/api/recent-notes", {
            body: { noteId, notePath: `root/${noteId}` }
        });
        expect(first.status).toBe(204);

        const updatedPath = `root/otherParent/${noteId}`;
        const second = await api.post("/api/recent-notes", {
            body: { noteId, notePath: updatedPath }
        });
        expect(second.status).toBe(204);

        const row = getRecentNote(noteId);
        expect(row?.notePath).toBe(updatedPath);

        const count = getSql().getValue<number>(
            "SELECT COUNT(*) FROM recent_notes WHERE noteId = ?",
            [ noteId ]
        );
        expect(count).toBe(1);
    });

    it("prunes stale recent notes when the random cutoff sweep fires", async () => {
        // The handler only runs the cutoff DELETE when `Math.random() < 0.05`;
        // force it deterministically so the prune branch is exercised. Insert a
        // stale row (created over 24h ago) that the sweep should remove.
        const staleNoteId = "staleRecentNote";
        getSql().execute(
            "INSERT OR REPLACE INTO recent_notes (noteId, notePath, utcDateCreated) VALUES (?, ?, ?)",
            [ staleNoteId, `root/${staleNoteId}`, "2000-01-01 00:00:00.000Z" ]
        );

        const { noteId } = await createTextNote(api, { title: "Triggers prune" });
        vi.spyOn(Math, "random").mockReturnValue(0);

        const res = await api.post("/api/recent-notes", {
            body: { noteId, notePath: `root/${noteId}` }
        });
        expect(res.status).toBe(204);

        expect(getRecentNote(staleNoteId)).toBeNull();
        expect(getRecentNote(noteId)).not.toBeNull();
    });
});
