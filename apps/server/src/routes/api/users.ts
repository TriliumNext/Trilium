/**
 * User Management API
 * 
 * Provides endpoints for managing users in multi-user installations.
 * All endpoints require authentication and most require admin privileges.
 * 
 * Works with user_data table (tmpID as primary key).
 */

import { Request } from "express";
import ValidationError from "../../errors/validation_error.js";
import userManagement from "../../services/user_management.js";

/**
 * Get list of all users
 * Requires: Admin access
 */
function getUsers(req: Request): any {
    const includeInactive = req.query.includeInactive === 'true';
    return userManagement.listUsers(includeInactive);
}

/**
 * Get a specific user by ID (tmpID)
 * Requires: Admin access or own user
 */
function getUser(req: Request): any {
    const tmpID = parseInt(req.params.userId);
    const currentUserId = req.session.userId;
    
    const currentUser = currentUserId ? userManagement.getUserById(currentUserId) : null;
    if (!currentUser) {
        throw new ValidationError("Not authenticated");
    }
    
    if (tmpID !== currentUserId && currentUserId && !userManagement.isAdmin(currentUserId)) {
        throw new ValidationError("Access denied");
    }
    
    const user = userManagement.getUserById(tmpID);
    if (!user) {
        throw new ValidationError("User not found");
    }
    
    const { userIDVerificationHash, salt, derivedKey, userIDEncryptedDataKey, ...safeUser } = user;
    return safeUser;
}

/**
 * Create a new user
 * Requires: Admin access
 */
function createUser(req: Request): any {
    const { username, email, password, role } = req.body;
    
    if (!username || !password) {
        throw new ValidationError("Username and password are required");
    }
    
    const existing = userManagement.getUserByUsername(username);
    if (existing) {
        throw new ValidationError("Username already exists");
    }
    
    if (password.length < 4) {
        throw new ValidationError("Password must be at least 4 characters long");
    }
    
    const user = userManagement.createUser({
        username,
        email,
        password,
        role: role || userManagement.UserRole.USER
    });
    
    const { userIDVerificationHash, salt, derivedKey, userIDEncryptedDataKey, ...safeUser } = user;
    return safeUser;
}

/**
 * Update an existing user
 * Requires: Admin access or own user (with limited fields)
 */
function updateUser(req: Request): any {
    const tmpID = parseInt(req.params.userId);
    const currentUserId = req.session.userId;
    const { email, password, isActive, role } = req.body;
    
    const currentUser = currentUserId ? userManagement.getUserById(currentUserId) : null;
    if (!currentUser) {
        throw new ValidationError("Not authenticated");
    }
    
    const isSelf = tmpID === currentUserId;
    const isAdminUser = currentUserId ? userManagement.isAdmin(currentUserId) : false;
    
    if (!isAdminUser && !isSelf) {
        throw new ValidationError("Access denied");
    }
    
    if (!isAdminUser && (isActive !== undefined || role !== undefined)) {
        throw new ValidationError("Only admins can change user status or role");
    }
    
    if (password && password.length < 4) {
        throw new ValidationError("Password must be at least 4 characters long");
    }
    
    const updates: any = {};
    if (email !== undefined) updates.email = email;
    if (password !== undefined) updates.password = password;
    if (isAdminUser && isActive !== undefined) updates.isActive = isActive;
    if (isAdminUser && role !== undefined) updates.role = role;
    
    const user = userManagement.updateUser(tmpID, updates);
    if (!user) {
        throw new ValidationError("User not found");
    }
    
    const { userIDVerificationHash, salt, derivedKey, userIDEncryptedDataKey, ...safeUser } = user;
    return safeUser;
}

/**
 * Delete a user (soft delete)
 * Requires: Admin access
 */
function deleteUser(req: Request): any {
    const tmpID = parseInt(req.params.userId);
    const currentUserId = req.session.userId;
    
    if (tmpID === currentUserId) {
        throw new ValidationError("Cannot delete your own account");
    }
    
    const success = userManagement.deleteUser(tmpID);
    if (!success) {
        throw new ValidationError("User not found");
    }
    
    return { success: true };
}

/**
 * Get current user info
 */
function getCurrentUser(req: Request): any {
    const userId = req.session.userId;
    if (!userId) {
        throw new ValidationError("Not authenticated");
    }
    
    const user = userManagement.getUserById(userId);
    if (!user) {
        throw new ValidationError("User not found");
    }
    
    const { userIDVerificationHash, salt, derivedKey, userIDEncryptedDataKey, ...safeUser } = user;
    return safeUser;
}

/**
 * Check if a username is available
 */
function checkUsername(req: Request): any {
    const username = req.query.username as string;
    if (!username) {
        throw new ValidationError("Username is required");
    }
    
    const existing = userManagement.getUserByUsername(username);
    return {
        available: !existing
    };
}

export default {
    getUsers,
    getUser,
    createUser,
    updateUser,
    deleteUser,
    getCurrentUser,
    checkUsername
};
