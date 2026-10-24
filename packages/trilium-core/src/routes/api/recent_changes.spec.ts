import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { RecentChangeRow } from "@triliumnext/commons";

import protectedSessionService from "../../services/protected_session";
import { getSql } from "../../services/sql/index";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core recent-changes route through {@link CoreApiTester}
 * (no Express), so this spec runs under both the node and standalone (WASM)
 * suites against the same seeded demo DB.
 */
let api: CoreApiTester;

describe("Recent changes API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("returns recent changes for the root ancestor", async () => {
        const res = await api.get<RecentChangeRow[]>("/api/recent-changes/root");

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);

        const first = res.body[0];
        expect(typeof first.noteId).toBe("string");
        expect(typeof first.title).toBe("string");
        expect(typeof first.utcDate).toBe("string");
    });

    it("is sorted by utcDate descending", async () => {
        const res = await api.get<RecentChangeRow[]>("/api/recent-changes/root");

        expect(res.status).toBe(200);
        // Guard against a vacuous pass: the demo fixture has many recent changes.
        expect(res.body.length).toBeGreaterThan(1);
        for (let i = 1; i < res.body.length; i++) {
            expect(res.body[i - 1].utcDate >= res.body[i].utcDate).toBe(true);
        }
    });

    it("includes a freshly created note in the root recent changes", async () => {
        const { noteId } = await createTextNote(api, { title: "Recent change probe" });

        const res = await api.get<RecentChangeRow[]>("/api/recent-changes/root");

        expect(res.status).toBe(200);
        const entry = res.body.find((change) => change.noteId === noteId);
        expect(entry).toBeTruthy();
    });

    it("filters recent changes by a specific ancestor subtree", async () => {
        const parent = await createTextNote(api, { title: "Ancestor parent" });
        const child = await createTextNote(api, {
            parentNoteId: parent.noteId,
            title: "Descendant note"
        });

        const res = await api.get<RecentChangeRow[]>(
            `/api/recent-changes/${parent.noteId}`
        );

        expect(res.status).toBe(200);
        const noteIds = res.body.map((change) => change.noteId);
        expect(noteIds).toContain(child.noteId);
    });

    it("reports canBeUndeleted for a soft-deleted note", async () => {
        const { noteId } = await createTextNote(api, { title: "Soon deleted" });

        const del = await api.delete(`/api/notes/${noteId}`, {
            query: { taskId: "recent-changes-delete", last: "true" }
        });
        expect(del.status).toBe(204);

        const res = await api.get<RecentChangeRow[]>("/api/recent-changes/root");
        expect(res.status).toBe(200);

        const deletedEntries = res.body.filter(
            (change) => change.noteId === noteId && change.current_isDeleted
        );
        expect(deletedEntries.length).toBeGreaterThan(0);
        expect(deletedEntries.every((change) => change.canBeUndeleted === true)).toBe(true);
    });

    describe("deletedOnly filter", () => {
        it("returns only deleted notes when deletedOnly=true", async () => {
            const live = await createTextNote(api, { title: "Live for deletedOnly" });
            const { noteId: deletedId } = await createTextNote(api, { title: "Deleted for deletedOnly" });
            const del = await api.delete(`/api/notes/${deletedId}`, {
                query: { taskId: "recent-changes-deletedOnly", last: "true" }
            });
            expect(del.status).toBe(204);

            const res = await api.get<RecentChangeRow[]>("/api/recent-changes/root", {
                query: { deletedOnly: "true" }
            });

            expect(res.status).toBe(200);
            expect(res.body.length).toBeGreaterThan(0);
            // Every returned change is for a deleted note...
            expect(res.body.every((change) => !!change.current_isDeleted)).toBe(true);
            // ...the deleted note is present, and the live one is filtered out.
            expect(res.body.some((change) => change.noteId === deletedId)).toBe(true);
            expect(res.body.some((change) => change.noteId === live.noteId)).toBe(false);
            // Each deleted note appears exactly once (only its deletion point, not creation/revisions).
            expect(res.body.filter((change) => change.noteId === deletedId)).toHaveLength(1);
        });

        it("includes live notes when deletedOnly is not set", async () => {
            const { noteId } = await createTextNote(api, { title: "Live by default" });

            const res = await api.get<RecentChangeRow[]>("/api/recent-changes/root");

            expect(res.status).toBe(200);
            expect(res.body.some((change) => change.noteId === noteId && !change.current_isDeleted)).toBe(true);
        });
    });

    it("returns an empty list for a non-existent ancestor", async () => {
        const res = await api.get<RecentChangeRow[]>("/api/recent-changes/missingAncestor123");

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBe(0);
    });

    describe("recently changed note IDs", () => {
        function setModified(noteId: string, utcDateModified: string) {
            getSql().execute(
                "UPDATE notes SET utcDateModified = ? WHERE noteId = ?",
                [ utcDateModified, noteId ]
            );
        }

        function getNoteIds(ancestorNoteId: string, limit?: string) {
            return api.get<string[]>(`/api/recent-changes/${ancestorNoteId}/note-ids`, {
                query: limit === undefined ? {} : { limit }
            });
        }

        it("lists live notes under the ancestor once each, newest first", async () => {
            const parent = await createTextNote(api, { title: "Changed parent" });
            const createChild = (title: string) =>
                createTextNote(api, { parentNoteId: parent.noteId, title });
            const oldest = await createChild("Oldest");
            const newest = await createChild("Newest");
            const middle = await createChild("Middle");
            const deleted = await createChild("Deleted");
            const cloneTarget = await createChild("Clone target");
            const clonePath = `/api/notes/${newest.noteId}/clone-to-note/${cloneTarget.noteId}`;
            expect((await api.put(clonePath, { body: {} })).status).toBe(200);
            setModified(oldest.noteId, "2099-01-01 00:00:01.000Z");
            setModified(middle.noteId, "2099-01-01 00:00:02.000Z");
            setModified(newest.noteId, "2099-01-01 00:00:03.000Z");
            const del = await api.delete(`/api/notes/${deleted.noteId}`, {
                query: { taskId: "recent-changes-note-ids", last: "true" }
            });
            expect(del.status).toBe(204);
            setModified(deleted.noteId, "2099-01-01 00:00:04.000Z");

            const res = await getNoteIds(parent.noteId, "2");
            expect(res.status).toBe(200);
            expect(res.body).toEqual([ newest.noteId, middle.noteId ]);

            const all = await getNoteIds(parent.noteId, "10");
            expect(all.body.slice(0, 3)).toEqual([ newest.noteId, middle.noteId, oldest.noteId ]);
            expect(all.body).toHaveLength(4);
            expect(all.body).not.toContain(parent.noteId);
        });

        it("leaves out the hidden subtree under root", async () => {
            const visible = await createTextNote(api, { title: "Visible change" });
            const hidden = await createTextNote(api, { parentNoteId: "_search", title: "Hidden" });
            setModified(visible.noteId, "2099-02-01 00:00:01.000Z");
            setModified(hidden.noteId, "2099-02-01 00:00:02.000Z");
            setModified("_hidden", "2099-02-01 00:00:03.000Z");

            const res = await getNoteIds("root", "1");
            expect(res.status).toBe(200);
            expect(res.body).toEqual([ visible.noteId ]);
            expect((await getNoteIds("_hidden", "1")).body).toEqual([ hidden.noteId ]);
        });

        it("rejects a missing or non-positive limit", async () => {
            expect((await getNoteIds("root")).status).toBe(400);
            expect((await getNoteIds("root", "0")).status).toBe(400);
        });
    });

    describe("protected notes", () => {
        let protectedNoteId: string;

        beforeAll(async () => {
            const created = await createTextNote(api, { title: "Secret note" });
            protectedNoteId = created.noteId;
            // Flag the note as protected directly in the DB so it surfaces in the
            // recent-changes feed with current_isProtected set, without needing a
            // real protected session for note creation.
            getSql().execute("UPDATE notes SET isProtected = 1 WHERE noteId = ?", [ protectedNoteId ]);
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("masks protected titles when no protected session is available", async () => {
            vi.spyOn(protectedSessionService, "isProtectedSessionAvailable").mockReturnValue(false);

            const res = await api.get<RecentChangeRow[]>("/api/recent-changes/root");
            expect(res.status).toBe(200);

            const entry = res.body.find((change) => change.noteId === protectedNoteId);
            expect(entry).toBeTruthy();
            expect(entry?.title).toBe("[protected]");
            expect(entry?.current_title).toBe("[protected]");
        });

        it("decrypts protected titles when a protected session is available", async () => {
            vi.spyOn(protectedSessionService, "isProtectedSessionAvailable").mockReturnValue(true);
            vi.spyOn(protectedSessionService, "decryptString").mockReturnValue("Decrypted secret");

            const res = await api.get<RecentChangeRow[]>("/api/recent-changes/root");
            expect(res.status).toBe(200);

            const entry = res.body.find((change) => change.noteId === protectedNoteId);
            expect(entry).toBeTruthy();
            expect(entry?.title).toBe("Decrypted secret");
            expect(entry?.current_title).toBe("Decrypted secret");
        });
    });
});
