/**
 * Group Management Service
 * Handles creation, modification, and deletion of user groups
 * Groups allow organizing users for easier permission management
 */

import sql from "./sql.js";

interface Group {
    groupId: number;
    groupName: string;
    description: string | null;
    createdBy: number;
    utcDateCreated: string;
    utcDateModified: string;
}

interface GroupMember {
    id: number;
    groupId: number;
    userId: number;
    addedBy: number;
    utcDateAdded: string;
}

interface GroupWithMembers extends Group {
    members: Array<{
        userId: number;
        username: string;
        email: string | null;
        addedAt: string;
    }>;
}

/**
 * Create a new group
 * @param groupName - Unique group name
 * @param description - Optional description
 * @param createdBy - User ID creating the group
 * @returns Created group ID
 */
export function createGroup(groupName: string, description: string | null, createdBy: number): number {
    const now = new Date().toISOString();

    // Check if group name already exists
    const existingGroup = sql.getValue<number>("SELECT COUNT(*) FROM groups WHERE groupName = ?", [groupName]);

    if (existingGroup) {
        throw new Error(`Group '${groupName}' already exists`);
    }

    sql.execute(
        `INSERT INTO groups (groupName, description, createdBy, utcDateCreated, utcDateModified)
         VALUES (?, ?, ?, ?, ?)`,
        [groupName, description, createdBy, now, now]
    );

    const groupId = sql.getValue<number>("SELECT last_insert_rowid()");

    if (!groupId) {
        throw new Error("Failed to create group");
    }

    return groupId;
}

/**
 * Get group by ID
 * @param groupId - Group ID
 * @returns Group or null if not found
 */
export function getGroup(groupId: number): Group | null {
    return sql.getRow<Group>("SELECT * FROM groups WHERE groupId = ?", [groupId]);
}

/**
 * Get group by name
 * @param groupName - Group name
 * @returns Group or null if not found
 */
export function getGroupByName(groupName: string): Group | null {
    return sql.getRow<Group>("SELECT * FROM groups WHERE groupName = ?", [groupName]);
}

/**
 * Get all groups
 * @returns Array of all groups
 */
export function getAllGroups(): Group[] {
    return sql.getRows<Group>("SELECT * FROM groups ORDER BY groupName");
}

/**
 * Get groups a user belongs to
 * @param userId - User ID
 * @returns Array of groups
 */
export function getUserGroups(userId: number): Group[] {
    return sql.getRows<Group>(
        `SELECT g.* FROM groups g
         JOIN group_members gm ON g.groupId = gm.groupId
         WHERE gm.userId = ?
         ORDER BY g.groupName`,
        [userId]
    );
}

/**
 * Get group with its members
 * @param groupId - Group ID
 * @returns Group with members or null if not found
 */
export function getGroupWithMembers(groupId: number): GroupWithMembers | null {
    const group = getGroup(groupId);

    if (!group) {
        return null;
    }

    const members = sql.getRows<{
        userId: number;
        username: string;
        email: string | null;
        addedAt: string;
    }>(
        `SELECT u.userId, u.username, u.email, gm.utcDateAdded as addedAt
         FROM group_members gm
         JOIN users u ON gm.userId = u.userId
         WHERE gm.groupId = ?
         ORDER BY u.username`,
        [groupId]
    );

    return {
        ...group,
        members
    };
}

/**
 * Update group information
 * @param groupId - Group ID
 * @param groupName - New group name (optional)
 * @param description - New description (optional)
 */
export function updateGroup(
    groupId: number,
    groupName?: string,
    description?: string | null
): void {
    const now = new Date().toISOString();
    const updates: string[] = [];
    const params: any[] = [];

    if (groupName !== undefined) {
        // Check if new name conflicts with existing group
        const existingGroup = sql.getRow<Group>(
            "SELECT * FROM groups WHERE groupName = ? AND groupId != ?",
            [groupName, groupId]
        );

        if (existingGroup) {
            throw new Error(`Group name '${groupName}' is already taken`);
        }

        updates.push("groupName = ?");
        params.push(groupName);
    }

    if (description !== undefined) {
        updates.push("description = ?");
        params.push(description);
    }

    if (updates.length === 0) {
        return; // Nothing to update
    }

    updates.push("utcDateModified = ?");
    params.push(now);

    params.push(groupId);

    sql.execute(`UPDATE groups SET ${updates.join(", ")} WHERE groupId = ?`, params);
}

/**
 * Delete a group
 * @param groupId - Group ID
 */
export function deleteGroup(groupId: number): void {
    // Check if it's a system group
    const group = getGroup(groupId);
    
    if (group && group.groupName === "All Users") {
        throw new Error("Cannot delete system group 'All Users'");
    }

    // Delete group (cascade will handle group_members and note_permissions)
    sql.execute("DELETE FROM groups WHERE groupId = ?", [groupId]);
}

/**
 * Add a user to a group
 * @param groupId - Group ID
 * @param userId - User ID to add
 * @param addedBy - User ID performing the action
 */
export function addUserToGroup(groupId: number, userId: number, addedBy: number): void {
    const now = new Date().toISOString();

    // Check if user is already in group
    const existing = sql.getValue<number>(
        "SELECT COUNT(*) FROM group_members WHERE groupId = ? AND userId = ?",
        [groupId, userId]
    );

    if (existing) {
        throw new Error("User is already a member of this group");
    }

    // Check if user exists
    const userExists = sql.getValue<number>("SELECT COUNT(*) FROM users WHERE userId = ?", [userId]);

    if (!userExists) {
        throw new Error("User does not exist");
    }

    sql.execute(
        `INSERT INTO group_members (groupId, userId, addedBy, utcDateAdded)
         VALUES (?, ?, ?, ?)`,
        [groupId, userId, addedBy, now]
    );
}

/**
 * Remove a user from a group
 * @param groupId - Group ID
 * @param userId - User ID to remove
 */
export function removeUserFromGroup(groupId: number, userId: number): void {
    // Check if it's the "All Users" group
    const group = getGroup(groupId);
    
    if (group && group.groupName === "All Users") {
        throw new Error("Cannot remove users from system group 'All Users'");
    }

    sql.execute("DELETE FROM group_members WHERE groupId = ? AND userId = ?", [groupId, userId]);
}

/**
 * Get all members of a group
 * @param groupId - Group ID
 * @returns Array of user IDs
 */
export function getGroupMembers(groupId: number): number[] {
    return sql.getColumn<number>("SELECT userId FROM group_members WHERE groupId = ?", [groupId]);
}

/**
 * Check if a user is a member of a group
 * @param groupId - Group ID
 * @param userId - User ID
 * @returns True if user is a member
 */
export function isUserInGroup(groupId: number, userId: number): boolean {
    const count = sql.getValue<number>(
        "SELECT COUNT(*) FROM group_members WHERE groupId = ? AND userId = ?",
        [groupId, userId]
    );

    return count > 0;
}

/**
 * Get number of members in a group
 * @param groupId - Group ID
 * @returns Member count
 */
export function getGroupMemberCount(groupId: number): number {
    return sql.getValue<number>("SELECT COUNT(*) FROM group_members WHERE groupId = ?", [groupId]) || 0;
}

/**
 * Ensure user is added to "All Users" group
 * @param userId - User ID
 */
export function ensureUserInAllUsersGroup(userId: number): void {
    const allUsersGroup = getGroupByName("All Users");

    if (!allUsersGroup) {
        return; // Group doesn't exist yet
    }

    try {
        addUserToGroup(allUsersGroup.groupId, userId, 1); // Added by admin
    } catch (e: any) {
        // Ignore if already member
        if (!e.message?.includes("already a member")) {
            throw e;
        }
    }
}

export default {
    createGroup,
    getGroup,
    getGroupByName,
    getAllGroups,
    getUserGroups,
    getGroupWithMembers,
    updateGroup,
    deleteGroup,
    addUserToGroup,
    removeUserFromGroup,
    getGroupMembers,
    isUserInGroup,
    getGroupMemberCount,
    ensureUserInAllUsersGroup
};
