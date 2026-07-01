import { cls, getSql, permission_service, user_service } from "@triliumnext/core";
import type { Request } from "express";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import sqlInit from "../../services/sql_init.js";
import permissionsRoute from "./permissions.js";

function req(body: Record<string, unknown> = {}, params: Record<string, string> = {}, session: Record<string, unknown> = {}) {
    return { body, params, session } as unknown as Request<Record<string, string>>;
}

function adminSession(): Record<string, unknown> {
    const adminUserId = getSql().getValue<string>("SELECT value FROM options WHERE name = 'adminUserId'");
    return { userId: adminUserId };
}

function insertNote(noteId: string, ownerId: string | null) {
    const n = new Date().toISOString();
    getSql().execute(
        `INSERT OR IGNORE INTO notes (noteId, title, type, mime, isProtected, isDeleted, dateCreated, dateModified, utcDateCreated, utcDateModified, ownerId)
         VALUES (?, 'perm-test', 'text', 'text/html', 0, 0, ?, ?, ?, ?, ?)`,
        [noteId, n, n, n, n, ownerId]
    );
}

describe("Permissions API", () => {
    let guestId: string;

    beforeAll(async () => {
        sqlInit.initializeDb();
        await sqlInit.dbReady;
    });

    beforeEach(() => {
        guestId = cls.init(() => user_service.createUser(`perm-guest-${Date.now()}`, null, false));
        cls.init(() => permission_service.clearPermissionCache());
    });

    afterEach(() => {
        cls.init(() => {
            try { user_service.deleteUser(guestId); } catch { /* may throw if guestId is somehow the primary admin */ }
            permission_service.clearPermissionCache();
        });
    });

    describe("listPermissions", () => {
        it("returns 403 without admin session", () => {
            const result = cls.init(() => permissionsRoute.listPermissions(req({}, { noteId: "root" })));
            expect(Array.isArray(result) && result[0]).toBe(403);
        });

        it("returns permissions for a note as admin", () => {
            const noteId = "root";
            const result = cls.init(() => permissionsRoute.listPermissions(req({}, { noteId }, adminSession())));
            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe("createPermission", () => {
        it("returns 403 without admin session", () => {
            const result = cls.init(() => permissionsRoute.createPermission(req({ noteId: "root", userId: guestId })));
            expect(Array.isArray(result) && result[0]).toBe(403);
        });

        it("returns 400 when noteId is missing", () => {
            const result = cls.init(() => permissionsRoute.createPermission(req({ userId: guestId }, {}, adminSession())));
            expect(Array.isArray(result) && result[0]).toBe(400);
        });

        it("returns 400 when neither userId nor groupId provided", () => {
            const result = cls.init(() => permissionsRoute.createPermission(req({ noteId: "root" }, {}, adminSession())));
            expect(Array.isArray(result) && result[0]).toBe(400);
        });

        it("grants permission and returns permissionId", () => {
            const noteId = "note-perm-create-test";
            const adminUserId = getSql().getValue<string>("SELECT value FROM options WHERE name = 'adminUserId'");
            insertNote(noteId, adminUserId);

            const result = cls.init(() =>
                permissionsRoute.createPermission(
                    req({ noteId, userId: guestId, canWrite: false }, {}, adminSession())
                )
            );
            expect(typeof (result as Record<string, string>).permissionId).toBe("string");

            const perms = cls.init(() => permission_service.getPermissionsForNote(noteId));
            expect(perms.length).toBe(1);
            expect(perms[0].userId).toBe(guestId);
        });
    });

    describe("deletePermission", () => {
        it("returns 403 without admin session", () => {
            const result = cls.init(() => permissionsRoute.deletePermission(req({}, { permissionId: "fake" })));
            expect(Array.isArray(result) && result[0]).toBe(403);
        });

        it("revokes an existing permission", () => {
            const noteId = "note-perm-delete-test";
            const adminUserId = getSql().getValue<string>("SELECT value FROM options WHERE name = 'adminUserId'");
            insertNote(noteId, adminUserId);

            const permissionId = cls.init(() =>
                permission_service.grantPermission(noteId, guestId, null, false)
            );

            cls.init(() =>
                permissionsRoute.deletePermission(req({}, { permissionId }, adminSession()))
            );

            const perms = cls.init(() => permission_service.getPermissionsForNote(noteId));
            expect(perms.length).toBe(0);
        });
    });
});
