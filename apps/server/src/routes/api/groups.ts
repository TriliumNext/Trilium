/**
 * Group Management API Routes
 * Handles user group creation, modification, and membership
 */

import groupManagement from "../../services/group_management.js";
import permissions from "../../services/permissions.js";
import type { Request, Response } from "express";

/**
 * Create a new group
 * POST /api/groups
 * Body: { groupName: string, description?: string }
 */
function createGroup(req: Request, res: Response) {
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    const { groupName, description } = req.body;

    if (!groupName) {
        return res.status(400).json({ error: "Missing required field: groupName" });
    }

    try {
        const groupId = groupManagement.createGroup(groupName, description || null, userId);

        res.json({
            success: true,
            groupId,
            message: `Group '${groupName}' created successfully`
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
}

/**
 * Get all groups
 * GET /api/groups
 */
function getAllGroups(req: Request, res: Response) {
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    const groups = groupManagement.getAllGroups();

    res.json({
        groups,
        count: groups.length
    });
}

/**
 * Get a specific group with members
 * GET /api/groups/:groupId
 */
function getGroup(req: Request, res: Response) {
    const userId = req.session.userId;
    const { groupId } = req.params;

    if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    const group = groupManagement.getGroupWithMembers(parseInt(groupId));

    if (!group) {
        return res.status(404).json({ error: "Group not found" });
    }

    res.json(group);
}

/**
 * Get groups the current user belongs to
 * GET /api/groups/my
 */
function getMyGroups(req: Request, res: Response) {
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    const groups = groupManagement.getUserGroups(userId);

    res.json({
        userId,
        groups,
        count: groups.length
    });
}

/**
 * Update group information
 * PUT /api/groups/:groupId
 * Body: { groupName?: string, description?: string }
 */
function updateGroup(req: Request, res: Response) {
    const userId = req.session.userId;
    const { groupId } = req.params;
    const { groupName, description } = req.body;

    if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    // Check if user is admin or group creator
    const group = groupManagement.getGroup(parseInt(groupId));
    if (!group) {
        return res.status(404).json({ error: "Group not found" });
    }

    if (group.createdBy !== userId && !permissions.isAdmin(userId)) {
        return res.status(403).json({ error: "Only the group creator or admin can update the group" });
    }

    try {
        groupManagement.updateGroup(parseInt(groupId), groupName, description);

        res.json({
            success: true,
            message: "Group updated successfully"
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
}

/**
 * Delete a group
 * DELETE /api/groups/:groupId
 */
function deleteGroup(req: Request, res: Response) {
    const userId = req.session.userId;
    const { groupId } = req.params;

    if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    // Check if user is admin or group creator
    const group = groupManagement.getGroup(parseInt(groupId));
    if (!group) {
        return res.status(404).json({ error: "Group not found" });
    }

    if (group.createdBy !== userId && !permissions.isAdmin(userId)) {
        return res.status(403).json({ error: "Only the group creator or admin can delete the group" });
    }

    try {
        groupManagement.deleteGroup(parseInt(groupId));

        res.json({
            success: true,
            message: "Group deleted successfully"
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
}

/**
 * Add a user to a group
 * POST /api/groups/:groupId/members
 * Body: { userId: number }
 */
function addMember(req: Request, res: Response) {
    const currentUserId = req.session.userId;
    const { groupId } = req.params;
    const { userId } = req.body;

    if (!currentUserId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    if (!userId) {
        return res.status(400).json({ error: "Missing required field: userId" });
    }

    // Check if user is admin or group creator
    const group = groupManagement.getGroup(parseInt(groupId));
    if (!group) {
        return res.status(404).json({ error: "Group not found" });
    }

    if (group.createdBy !== currentUserId && !permissions.isAdmin(currentUserId)) {
        return res.status(403).json({ error: "Only the group creator or admin can add members" });
    }

    try {
        groupManagement.addUserToGroup(parseInt(groupId), userId, currentUserId);

        res.json({
            success: true,
            message: `User ${userId} added to group successfully`
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
}

/**
 * Remove a user from a group
 * DELETE /api/groups/:groupId/members/:userId
 */
function removeMember(req: Request, res: Response) {
    const currentUserId = req.session.userId;
    const { groupId, userId } = req.params;

    if (!currentUserId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    // Check if user is admin or group creator
    const group = groupManagement.getGroup(parseInt(groupId));
    if (!group) {
        return res.status(404).json({ error: "Group not found" });
    }

    if (group.createdBy !== currentUserId && !permissions.isAdmin(currentUserId)) {
        return res.status(403).json({ error: "Only the group creator or admin can remove members" });
    }

    try {
        groupManagement.removeUserFromGroup(parseInt(groupId), parseInt(userId));

        res.json({
            success: true,
            message: `User ${userId} removed from group successfully`
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
}

export default {
    createGroup,
    getAllGroups,
    getGroup,
    getMyGroups,
    updateGroup,
    deleteGroup,
    addMember,
    removeMember
};
