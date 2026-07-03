import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as cls from "./context.js";
import { getSql } from "./sql/index.js";
import dateUtils from "./utils/date.js";
import { newEntityId } from "./utils/index.js";
import permissionService from "./permission_service.js";

function now() {
    return dateUtils.utcNowDateTime();
}

function insertUser(userId: string, isAdmin = 0) {
    const n = now();
    getSql().execute(
        `INSERT OR IGNORE INTO users (userId, username, isAdmin, isDeleted, dateCreated, utcDateModified)
         VALUES (?, ?, ?, 0, ?, ?)`,
        [userId, `user-${userId.slice(0, 4)}`, isAdmin, n, n]
    );
}

function insertNote(noteId: string, ownerId: string | null) {
    const n = now();
    getSql().execute(
        `INSERT OR IGNORE INTO notes (noteId, title, type, mime, isProtected, isDeleted, dateCreated, dateModified, utcDateCreated, utcDateModified, ownerId)
         VALUES (?, 'test', 'text', 'text/html', 0, 0, ?, ?, ?, ?, ?)`,
        [noteId, n, n, n, n, ownerId]
    );
}

function insertBranch(noteId: string, parentNoteId: string) {
    const n = now();
    getSql().execute(
        `INSERT OR IGNORE INTO branches (branchId, noteId, parentNoteId, notePosition, isExpanded, isDeleted, utcDateModified)
         VALUES (?, ?, ?, 10, 0, 0, ?)`,
        [newEntityId(), noteId, parentNoteId, n]
    );
}

function insertGroup(groupId: string, name: string) {
    const n = now();
    getSql().execute(
        `INSERT OR IGNORE INTO user_groups (groupId, name, dateCreated, utcDateModified) VALUES (?, ?, ?, ?)`,
        [groupId, name, n, n]
    );
}

function addUserToGroup(userId: string, groupId: string) {
    getSql().execute(
        `INSERT OR IGNORE INTO user_group_members (userId, groupId, dateCreated) VALUES (?, ?, ?)`,
        [userId, groupId, now()]
    );
}

describe("permission_service", () => {
    let userId: string;
    let adminId: string;

    beforeAll(() => {
        expect(getSql()).toBeDefined();
    });

    beforeEach(() => {
        userId = newEntityId();
        adminId = newEntityId();
        insertUser(userId, 0);
        insertUser(adminId, 1);
        permissionService.clearPermissionCache();
    });

    afterEach(() => {
        permissionService.clearPermissionCache();
    });

    describe("canUserAccessNote", () => {
        it("owner can access their own note", () => {
            const noteId = newEntityId();
            insertNote(noteId, userId);
            const result = cls.init(() => permissionService.canUserAccessNote(noteId, userId));
            expect(result).toBe(true);
        });

        it("non-owner without permission cannot access", () => {
            const noteId = newEntityId();
            const otherId = newEntityId();
            insertUser(otherId, 0);
            insertNote(noteId, userId);
            const result = cls.init(() => permissionService.canUserAccessNote(noteId, otherId));
            expect(result).toBe(false);
        });

        it("admin can access any note", () => {
            const noteId = newEntityId();
            insertNote(noteId, userId);
            const result = cls.init(() => permissionService.canUserAccessNote(noteId, adminId));
            expect(result).toBe(true);
        });
    });

    describe("grantPermission / revokePermission", () => {
        it("grants read-only access to another user", () => {
            const noteId = newEntityId();
            const guestId = newEntityId();
            insertUser(guestId, 0);
            insertNote(noteId, userId);

            cls.init(() => permissionService.grantPermission(noteId, guestId, null, false));

            const canRead = cls.init(() => permissionService.canUserAccessNote(noteId, guestId));
            const canWrite = cls.init(() => permissionService.canUserWriteNote(noteId, guestId));
            expect(canRead).toBe(true);
            expect(canWrite).toBe(false);
        });

        it("grants read+write access to another user", () => {
            const noteId = newEntityId();
            const guestId = newEntityId();
            insertUser(guestId, 0);
            insertNote(noteId, userId);

            cls.init(() => permissionService.grantPermission(noteId, guestId, null, true));

            expect(cls.init(() => permissionService.canUserWriteNote(noteId, guestId))).toBe(true);
        });

        it("revoking permission removes access", () => {
            const noteId = newEntityId();
            const guestId = newEntityId();
            insertUser(guestId, 0);
            insertNote(noteId, userId);

            const permId = cls.init(() => permissionService.grantPermission(noteId, guestId, null, false));
            expect(cls.init(() => permissionService.canUserAccessNote(noteId, guestId))).toBe(true);

            cls.init(() => permissionService.revokePermission(permId));
            expect(cls.init(() => permissionService.canUserAccessNote(noteId, guestId))).toBe(false);
        });

        it("throws when neither userId nor groupId provided", () => {
            const noteId = newEntityId();
            insertNote(noteId, userId);
            expect(() =>
                cls.init(() => permissionService.grantPermission(noteId, null, null, false))
            ).toThrow();
        });
    });

    describe("permission inheritance", () => {
        it("grants access via ancestor note permission", () => {
            const parentId = newEntityId();
            const childId = newEntityId();
            const guestId = newEntityId();
            insertUser(guestId, 0);
            insertNote(parentId, userId);
            insertNote(childId, userId);
            insertBranch(childId, parentId);

            cls.init(() => permissionService.grantPermission(parentId, guestId, null, false));

            expect(cls.init(() => permissionService.canUserAccessNote(childId, guestId))).toBe(true);
        });

        it("highest privilege wins across multiple matching permissions", () => {
            const parentId = newEntityId();
            const childId = newEntityId();
            const guestId = newEntityId();
            insertUser(guestId, 0);
            insertNote(parentId, userId);
            insertNote(childId, userId);
            insertBranch(childId, parentId);

            // Read-only on parent, write on child
            cls.init(() => permissionService.grantPermission(parentId, guestId, null, false));
            cls.init(() => permissionService.grantPermission(childId, guestId, null, true));

            expect(cls.init(() => permissionService.canUserWriteNote(childId, guestId))).toBe(true);
        });
    });

    describe("getPermissionsForNote", () => {
        it("lists all permissions for a note", () => {
            const noteId = newEntityId();
            const guestId = newEntityId();
            insertUser(guestId, 0);
            insertNote(noteId, userId);

            cls.init(() => permissionService.grantPermission(noteId, guestId, null, true));
            const rows = cls.init(() => permissionService.getPermissionsForNote(noteId));
            expect(rows.length).toBe(1);
            expect(rows[0].userId).toBe(guestId);
            expect(rows[0].canWrite).toBe(1);
        });
    });

    describe("group-based permissions", () => {
        it("grants access via group membership", () => {
            const noteId = newEntityId();
            const guestId = newEntityId();
            const groupId = newEntityId();
            insertUser(guestId, 0);
            insertNote(noteId, userId);
            insertGroup(groupId, "testers");
            addUserToGroup(guestId, groupId);

            cls.init(() => permissionService.grantPermission(noteId, null, groupId, false));

            expect(cls.init(() => permissionService.canUserAccessNote(noteId, guestId))).toBe(true);
            expect(cls.init(() => permissionService.canUserWriteNote(noteId, guestId))).toBe(false);
        });
    });

    describe("multi-parent clone graphs", () => {
        it("inherits permission from either parent of a cloned note", () => {
            const parent1Id = newEntityId();
            const parent2Id = newEntityId();
            const cloneId = newEntityId();
            const guestId = newEntityId();
            insertUser(guestId, 0);
            insertNote(parent1Id, userId);
            insertNote(parent2Id, userId);
            insertNote(cloneId, userId);
            insertBranch(cloneId, parent1Id);
            insertBranch(cloneId, parent2Id);

            // Grant access only via parent2
            cls.init(() => permissionService.grantPermission(parent2Id, guestId, null, true));

            expect(cls.init(() => permissionService.canUserAccessNote(cloneId, guestId))).toBe(true);
            expect(cls.init(() => permissionService.canUserWriteNote(cloneId, guestId))).toBe(true);
        });
    });

    describe("cache correctness", () => {
        it("cached result is returned on repeated calls", () => {
            const noteId = newEntityId();
            const guestId = newEntityId();
            insertUser(guestId, 0);
            insertNote(noteId, userId);

            cls.init(() => permissionService.grantPermission(noteId, guestId, null, false));

            const first = cls.init(() => permissionService.canUserAccessNote(noteId, guestId));
            const second = cls.init(() => permissionService.canUserAccessNote(noteId, guestId));
            expect(first).toBe(true);
            expect(second).toBe(true);
        });

        it("cache is cleared after revoking permission on a parent affects child", () => {
            const parentId = newEntityId();
            const childId = newEntityId();
            const guestId = newEntityId();
            insertUser(guestId, 0);
            insertNote(parentId, userId);
            insertNote(childId, userId);
            insertBranch(childId, parentId);

            const permId = cls.init(() => permissionService.grantPermission(parentId, guestId, null, false));
            expect(cls.init(() => permissionService.canUserAccessNote(childId, guestId))).toBe(true);

            cls.init(() => permissionService.revokePermission(permId));
            expect(cls.init(() => permissionService.canUserAccessNote(childId, guestId))).toBe(false);
        });
    });
});
