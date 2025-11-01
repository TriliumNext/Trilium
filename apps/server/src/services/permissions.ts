/**
 * Permission Service
 * Handles note-level access control for collaborative multi-user support
 * 
 * Permission Levels:
 * - read: Can view note and its content
 * - write: Can edit note content and attributes
 * - admin: Can edit, delete, and share note with others
 * 
 * Permission Resolution:
 * 1. Owner has implicit 'admin' permission
 * 2. Direct user permissions override group permissions
 * 3. Group permissions are inherited from group membership
 * 4. Higher permission level wins (admin > write > read)
 */

import sql from "./sql.js";
import becca from "../becca/becca.js";

export type PermissionLevel = "read" | "write" | "admin";
export type GranteeType = "user" | "group";

interface Permission {
    permissionId: number;
    noteId: string;
    granteeType: GranteeType;
    granteeId: number;
    permission: PermissionLevel;
    grantedBy: number;
    utcDateGranted: string;
    utcDateModified: string;
}

interface NoteOwnership {
    noteId: string;
    ownerId: number;
    utcDateCreated: string;
}

/**
 * Check if a user has a specific permission level on a note
 * @param userId - User ID to check
 * @param noteId - Note ID to check
 * @param requiredPermission - Required permission level
 * @returns True if user has required permission or higher
 */
export function checkNoteAccess(userId: number, noteId: string, requiredPermission: PermissionLevel): boolean {
    // Check if user is the owner (implicit admin permission)
    const ownership = sql.getRow<NoteOwnership>(
        "SELECT * FROM note_ownership WHERE noteId = ? AND ownerId = ?",
        [noteId, userId]
    );

    if (ownership) {
        return true; // Owner has all permissions
    }

    // Get user's effective permission level
    const effectivePermission = getUserPermissionLevel(userId, noteId);

    if (!effectivePermission) {
        return false; // No permission
    }

    // Check if effective permission meets or exceeds required level
    return comparePermissions(effectivePermission, requiredPermission) >= 0;
}

/**
 * Get the highest permission level a user has on a note
 * @param userId - User ID
 * @param noteId - Note ID
 * @returns Highest permission level or null if no access
 */
export function getUserPermissionLevel(userId: number, noteId: string): PermissionLevel | null {
    // Check ownership first
    const isOwner = sql.getValue<number>(
        "SELECT COUNT(*) FROM note_ownership WHERE noteId = ? AND ownerId = ?",
        [noteId, userId]
    );

    if (isOwner) {
        return "admin";
    }

    // Get direct user permission
    const userPermission = sql.getRow<Permission>(
        "SELECT * FROM note_permissions WHERE noteId = ? AND granteeType = 'user' AND granteeId = ?",
        [noteId, userId]
    );

    // Get group permissions
    const groupPermissions = sql.getRows<Permission>(
        `SELECT np.* FROM note_permissions np
         JOIN group_members gm ON np.granteeId = gm.groupId
         WHERE np.noteId = ? AND np.granteeType = 'group' AND gm.userId = ?`,
        [noteId, userId]
    );

    // Find highest permission level
    let highestPermission: PermissionLevel | null = null;

    if (userPermission) {
        highestPermission = userPermission.permission;
    }

    for (const groupPerm of groupPermissions) {
        if (!highestPermission || comparePermissions(groupPerm.permission, highestPermission) > 0) {
            highestPermission = groupPerm.permission;
        }
    }

    return highestPermission;
}

/**
 * Compare two permission levels
 * @returns Positive if p1 > p2, negative if p1 < p2, zero if equal
 */
function comparePermissions(p1: PermissionLevel, p2: PermissionLevel): number {
    const levels: Record<PermissionLevel, number> = {
        read: 1,
        write: 2,
        admin: 3
    };
    return levels[p1] - levels[p2];
}

/**
 * Get all notes a user has access to
 * @param userId - User ID
 * @param minPermission - Minimum permission level required (default: read)
 * @returns Array of note IDs the user can access
 */
export function getUserAccessibleNotes(userId: number, minPermission: PermissionLevel = "read"): string[] {
    // Get notes owned by user
    const ownedNotes = sql.getColumn<string>(
        "SELECT noteId FROM note_ownership WHERE ownerId = ?",
        [userId]
    );

    // Get notes with direct user permissions
    const directPermissionNotes = sql.getColumn<string>(
        `SELECT DISTINCT noteId FROM note_permissions
         WHERE granteeType = 'user' AND granteeId = ?`,
        [userId]
    );

    // Get notes accessible through group membership
    const groupPermissionNotes = sql.getColumn<string>(
        `SELECT DISTINCT np.noteId FROM note_permissions np
         JOIN group_members gm ON np.granteeId = gm.groupId
         WHERE np.granteeType = 'group' AND gm.userId = ?`,
        [userId]
    );

    // Combine all accessible notes
    const allAccessibleNotes = new Set<string>([...ownedNotes, ...directPermissionNotes, ...groupPermissionNotes]);

    // Filter by minimum permission level if not "read"
    if (minPermission === "read") {
        return Array.from(allAccessibleNotes);
    }

    return Array.from(allAccessibleNotes).filter((noteId) => {
        const permLevel = getUserPermissionLevel(userId, noteId);
        return permLevel && comparePermissions(permLevel, minPermission) >= 0;
    });
}

/**
 * Get all notes with their permission levels for a user (for sync filtering)
 * @param userId - User ID
 * @returns Map of noteId -> permission level
 */
export function getUserNotePermissions(userId: number): Map<string, PermissionLevel> {
    const permissionMap = new Map<string, PermissionLevel>();

    // Add owned notes (admin permission)
    const ownedNotes = sql.getRows<NoteOwnership>(
        "SELECT noteId FROM note_ownership WHERE ownerId = ?",
        [userId]
    );
    for (const note of ownedNotes) {
        permissionMap.set(note.noteId, "admin");
    }

    // Add direct user permissions
    const userPermissions = sql.getRows<Permission>(
        "SELECT * FROM note_permissions WHERE granteeType = 'user' AND granteeId = ?",
        [userId]
    );
    for (const perm of userPermissions) {
        const existing = permissionMap.get(perm.noteId);
        if (!existing || comparePermissions(perm.permission, existing) > 0) {
            permissionMap.set(perm.noteId, perm.permission);
        }
    }

    // Add group permissions
    const groupPermissions = sql.getRows<Permission>(
        `SELECT np.* FROM note_permissions np
         JOIN group_members gm ON np.granteeId = gm.groupId
         WHERE np.granteeType = 'group' AND gm.userId = ?`,
        [userId]
    );
    for (const perm of groupPermissions) {
        const existing = permissionMap.get(perm.noteId);
        if (!existing || comparePermissions(perm.permission, existing) > 0) {
            permissionMap.set(perm.noteId, perm.permission);
        }
    }

    return permissionMap;
}

/**
 * Grant permission on a note to a user or group
 * @param noteId - Note ID
 * @param granteeType - 'user' or 'group'
 * @param granteeId - User ID or Group ID
 * @param permission - Permission level
 * @param grantedBy - User ID granting the permission
 */
export function grantPermission(
    noteId: string,
    granteeType: GranteeType,
    granteeId: number,
    permission: PermissionLevel,
    grantedBy: number
): void {
    const now = new Date().toISOString();

    // Check if permission already exists
    const existingPerm = sql.getRow<Permission>(
        "SELECT * FROM note_permissions WHERE noteId = ? AND granteeType = ? AND granteeId = ?",
        [noteId, granteeType, granteeId]
    );

    if (existingPerm) {
        // Update existing permission
        sql.execute(
            `UPDATE note_permissions 
             SET permission = ?, grantedBy = ?, utcDateModified = ?
             WHERE permissionId = ?`,
            [permission, grantedBy, now, existingPerm.permissionId]
        );
    } else {
        // Insert new permission
        sql.execute(
            `INSERT INTO note_permissions (noteId, granteeType, granteeId, permission, grantedBy, utcDateGranted, utcDateModified)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [noteId, granteeType, granteeId, permission, grantedBy, now, now]
        );
    }
}

/**
 * Revoke permission on a note from a user or group
 * @param noteId - Note ID
 * @param granteeType - 'user' or 'group'
 * @param granteeId - User ID or Group ID
 */
export function revokePermission(noteId: string, granteeType: GranteeType, granteeId: number): void {
    sql.execute(
        "DELETE FROM note_permissions WHERE noteId = ? AND granteeType = ? AND granteeId = ?",
        [noteId, granteeType, granteeId]
    );
}

/**
 * Get all permissions for a specific note
 * @param noteId - Note ID
 * @returns Array of permissions
 */
export function getNotePermissions(noteId: string): Permission[] {
    return sql.getRows<Permission>("SELECT * FROM note_permissions WHERE noteId = ?", [noteId]);
}

/**
 * Get the owner of a note
 * @param noteId - Note ID
 * @returns Owner user ID or null if no owner
 */
export function getNoteOwner(noteId: string): number | null {
    return sql.getValue<number>("SELECT ownerId FROM note_ownership WHERE noteId = ?", [noteId]);
}

/**
 * Transfer note ownership to another user
 * @param noteId - Note ID
 * @param newOwnerId - New owner user ID
 */
export function transferOwnership(noteId: string, newOwnerId: number): void {
    sql.execute("UPDATE note_ownership SET ownerId = ? WHERE noteId = ?", [newOwnerId, noteId]);
}

/**
 * Check if user is admin (for system-wide operations)
 * @param userId - User ID
 * @returns True if user is admin
 */
export function isAdmin(userId: number): boolean {
    const role = sql.getValue<string>("SELECT role FROM users WHERE userId = ? AND isActive = 1", [userId]);
    return role === "admin";
}

/**
 * Filter entity changes for sync based on user permissions
 * Only includes notes the user has access to
 * @param userId - User ID
 * @param entityChanges - Array of entity changes
 * @returns Filtered entity changes
 */
export function filterEntityChangesForUser(userId: number, entityChanges: any[]): any[] {
    // Get all accessible note IDs for this user
    const accessibleNotes = new Set(getUserAccessibleNotes(userId));

    return entityChanges.filter((ec) => {
        // Always sync non-note entities (options, etc.)
        if (ec.entityName !== "notes" && ec.entityName !== "branches" && ec.entityName !== "attributes") {
            return true;
        }

        // For notes, check ownership or permissions
        if (ec.entityName === "notes") {
            return accessibleNotes.has(ec.entityId);
        }

        // For branches, check if the note is accessible
        if (ec.entityName === "branches") {
            const noteId = sql.getValue<string>("SELECT noteId FROM branches WHERE branchId = ?", [ec.entityId]);
            return noteId ? accessibleNotes.has(noteId) : false;
        }

        // For attributes, check if the note is accessible
        if (ec.entityName === "attributes") {
            const noteId = sql.getValue<string>("SELECT noteId FROM attributes WHERE attributeId = ?", [ec.entityId]);
            return noteId ? accessibleNotes.has(noteId) : false;
        }

        return false;
    });
}

export default {
    checkNoteAccess,
    getUserPermissionLevel,
    getUserAccessibleNotes,
    getUserNotePermissions,
    grantPermission,
    revokePermission,
    getNotePermissions,
    getNoteOwner,
    transferOwnership,
    isAdmin,
    filterEntityChangesForUser
};
