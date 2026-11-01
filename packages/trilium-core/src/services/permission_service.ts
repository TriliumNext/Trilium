import { getSql } from "./sql/index.js";
import { getLog } from "./log.js";
import { newEntityId } from "./utils/index.js";
import dateUtils from "./utils/date.js";
import userService from "./user_service.js";
import { evictUser } from "../becca/becca_cache.js";

interface PermissionRow {
    permissionId: string;
    noteId: string;
    userId: string | null;
    groupId: string | null;
    canRead: number;
    canWrite: number;
    dateCreated: string;
    utcDateModified: string;
}

interface EffectivePermission {
    canRead: boolean;
    canWrite: boolean;
}

const PERMISSION_COLS = "permissionId, noteId, userId, groupId, canRead, canWrite, dateCreated, utcDateModified";

// In-memory cache: noteId + "\0" + userId -> EffectivePermission | null (null = no access)
const permCache = new Map<string, EffectivePermission | null>();

function cacheKey(noteId: string, userId: string) {
    return `${noteId}\0${userId}`;
}

// Collects permissions from the note and all its ancestors across every branch (handles clones).
function collectAncestorPermissions(noteId: string, userId: string): PermissionRow[] {
    return getSql().getRows<PermissionRow>(
        `WITH RECURSIVE ancestors(noteId) AS (
             SELECT ?
             UNION
             SELECT b.parentNoteId
               FROM branches b
               JOIN ancestors a ON b.noteId = a.noteId
              WHERE b.isDeleted = 0 AND b.parentNoteId != 'none'
         )
         SELECT ${PERMISSION_COLS}
           FROM note_permissions
          WHERE noteId IN ancestors
            AND (userId = ? OR groupId IN (SELECT groupId FROM user_group_members WHERE userId = ?))`,
        [noteId, userId, userId]
    );
}

function getEffectivePermission(noteId: string, userId: string): EffectivePermission | null {
    if (userService.isUserAdmin(userId)) {
        return { canRead: true, canWrite: true };
    }

    const note = getSql().getRowOrNull<{ ownerId: string | null }>(
        "SELECT ownerId FROM notes WHERE noteId = ? AND isDeleted = 0",
        [noteId]
    );

    if (!note) return null;

    if (note.ownerId === userId) {
        return { canRead: true, canWrite: true };
    }

    const key = cacheKey(noteId, userId);
    if (permCache.has(key)) {
        return permCache.get(key)!;
    }

    const rows = collectAncestorPermissions(noteId, userId);

    if (rows.length === 0) {
        permCache.set(key, null);
        return null;
    }

    // Merge: highest privilege wins across all matching rows.
    let canRead = false;
    let canWrite = false;
    for (const row of rows) {
        if (row.canRead) canRead = true;
        if (row.canWrite) canWrite = true;
        if (canRead && canWrite) break;
    }

    // Write implies read; normalize so callers never see canWrite without canRead.
    const result: EffectivePermission = { canRead: canRead || canWrite, canWrite };
    permCache.set(key, result);
    return result;
}

function canUserAccessNote(noteId: string, userId: string): boolean {
    return getEffectivePermission(noteId, userId)?.canRead ?? false;
}

function canUserWriteNote(noteId: string, userId: string): boolean {
    return getEffectivePermission(noteId, userId)?.canWrite ?? false;
}

function evictAffectedUsers(userId: string | null, groupId: string | null): void {
    if (userId) {
        evictUser(userId);
    }
    if (groupId) {
        const members = getSql().getColumn<string>(
            "SELECT userId FROM user_group_members WHERE groupId = ?", [groupId]
        );
        for (const memberId of members) {
            evictUser(memberId);
        }
    }
}

function grantPermission(
    noteId: string,
    userId: string | null,
    groupId: string | null,
    canWrite: boolean
): string {
    if (!userId && !groupId) {
        throw new Error("permission_service.grantPermission: userId or groupId is required");
    }

    const permissionId = newEntityId();
    const now = dateUtils.utcNowDateTime();

    getSql().execute(
        `INSERT INTO note_permissions (permissionId, noteId, userId, groupId, canRead, canWrite, dateCreated, utcDateModified)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        [permissionId, noteId, userId, groupId, canWrite ? 1 : 0, now, now]
    );

    // Permission changes affect the whole inheritance chain; clear everything.
    clearPermissionCache();
    evictAffectedUsers(userId, groupId);
    return permissionId;
}

function revokePermission(permissionId: string): void {
    const row = getSql().getRowOrNull<{ noteId: string; userId: string | null; groupId: string | null }>(
        "SELECT noteId, userId, groupId FROM note_permissions WHERE permissionId = ?",
        [permissionId]
    );

    if (!row) {
        getLog().warn(`permission_service.revokePermission: permissionId not found: ${permissionId}`);
        return;
    }

    getSql().execute("DELETE FROM note_permissions WHERE permissionId = ?", [permissionId]);
    // Permission changes affect the whole inheritance chain; clear everything.
    clearPermissionCache();
    evictAffectedUsers(row.userId, row.groupId);
}

function getPermissionsForNote(noteId: string): PermissionRow[] {
    return getSql().getRows<PermissionRow>(
        `SELECT ${PERMISSION_COLS}
           FROM note_permissions WHERE noteId = ?`,
        [noteId]
    );
}

function clearPermissionCache(): void {
    permCache.clear();
}

export default {
    canUserAccessNote,
    canUserWriteNote,
    getEffectivePermission,
    grantPermission,
    revokePermission,
    getPermissionsForNote,
    clearPermissionCache
};
