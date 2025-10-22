/**
 * Permission Management API Routes
 * Handles note sharing and access control
 */

import permissions from "../../services/permissions.js";
import type { Request, Response } from "express";

/**
 * Get all permissions for a specific note
 * GET /api/notes/:noteId/permissions
 */
function getNotePermissions(req: Request, res: Response) {
    const { noteId } = req.params;
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    // Check if user has admin permission on note
    if (!permissions.checkNoteAccess(userId, noteId, "admin")) {
        return res.status(403).json({ error: "You don't have permission to view permissions for this note" });
    }

    const notePermissions = permissions.getNotePermissions(noteId);
    const owner = permissions.getNoteOwner(noteId);

    res.json({
        noteId,
        owner,
        permissions: notePermissions
    });
}

/**
 * Share a note with a user or group
 * POST /api/notes/:noteId/share
 * Body: { granteeType: 'user'|'group', granteeId: number, permission: 'read'|'write'|'admin' }
 */
function shareNote(req: Request, res: Response) {
    const { noteId } = req.params;
    const { granteeType, granteeId, permission } = req.body;
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    // Validate input
    if (!granteeType || !granteeId || !permission) {
        return res.status(400).json({ error: "Missing required fields: granteeType, granteeId, permission" });
    }

    if (!['user', 'group'].includes(granteeType)) {
        return res.status(400).json({ error: "Invalid granteeType. Must be 'user' or 'group'" });
    }

    if (!['read', 'write', 'admin'].includes(permission)) {
        return res.status(400).json({ error: "Invalid permission. Must be 'read', 'write', or 'admin'" });
    }

    // Check if user has admin permission on note
    if (!permissions.checkNoteAccess(userId, noteId, "admin")) {
        return res.status(403).json({ error: "You don't have permission to share this note" });
    }

    try {
        permissions.grantPermission(noteId, granteeType as any, granteeId, permission as any, userId);

        res.json({
            success: true,
            message: `Note shared with ${granteeType} ${granteeId} with ${permission} permission`
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
}

/**
 * Revoke permission on a note
 * DELETE /api/notes/:noteId/permissions/:permissionId
 */
function revokePermission(req: Request, res: Response) {
    const { noteId, permissionId } = req.params;
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    // Check if user has admin permission on note
    if (!permissions.checkNoteAccess(userId, noteId, "admin")) {
        return res.status(403).json({ error: "You don't have permission to revoke permissions on this note" });
    }

    try {
        // Get the permission to revoke
        const allPermissions = permissions.getNotePermissions(noteId);
        const permToRevoke = allPermissions.find(p => p.permissionId === parseInt(permissionId));

        if (!permToRevoke) {
            return res.status(404).json({ error: "Permission not found" });
        }

        permissions.revokePermission(noteId, permToRevoke.granteeType, permToRevoke.granteeId);

        res.json({
            success: true,
            message: "Permission revoked successfully"
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
}

/**
 * Get all notes accessible by current user
 * GET /api/notes/accessible
 */
function getAccessibleNotes(req: Request, res: Response) {
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    const minPermission = (req.query.minPermission as any) || 'read';

    if (!['read', 'write', 'admin'].includes(minPermission)) {
        return res.status(400).json({ error: "Invalid minPermission. Must be 'read', 'write', or 'admin'" });
    }

    const accessibleNotes = permissions.getUserAccessibleNotes(userId, minPermission as any);

    res.json({
        userId,
        minPermission,
        noteIds: accessibleNotes,
        count: accessibleNotes.length
    });
}

/**
 * Check user's permission level on a specific note
 * GET /api/notes/:noteId/my-permission
 */
function getMyPermission(req: Request, res: Response) {
    const { noteId } = req.params;
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    const permissionLevel = permissions.getUserPermissionLevel(userId, noteId);
    const isOwner = permissions.getNoteOwner(noteId) === userId;

    res.json({
        noteId,
        userId,
        permission: permissionLevel,
        isOwner
    });
}

/**
 * Transfer note ownership
 * POST /api/notes/:noteId/transfer-ownership
 * Body: { newOwnerId: number }
 */
function transferOwnership(req: Request, res: Response) {
    const { noteId } = req.params;
    const { newOwnerId } = req.body;
    const userId = req.session.userId;

    if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    if (!newOwnerId) {
        return res.status(400).json({ error: "Missing required field: newOwnerId" });
    }

    // Check if user is the current owner
    const currentOwner = permissions.getNoteOwner(noteId);
    if (currentOwner !== userId && !permissions.isAdmin(userId)) {
        return res.status(403).json({ error: "Only the owner or admin can transfer ownership" });
    }

    try {
        permissions.transferOwnership(noteId, newOwnerId);

        res.json({
            success: true,
            message: `Ownership transferred to user ${newOwnerId}`
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
}

export default {
    getNotePermissions,
    shareNote,
    revokePermission,
    getAccessibleNotes,
    getMyPermission,
    transferOwnership
};
