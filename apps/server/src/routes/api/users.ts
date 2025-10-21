/**
 * User Management API
 * 
 * Provides endpoints for managing users in multi-user installations.
 * All endpoints require authentication and most require admin privileges.
 */

import userManagement from "../../services/user_management.js";
import type { Request, Response } from "express";
import ValidationError from "../../errors/validation_error.js";

/**
 * Get list of all users
 * Requires: Admin access
 */
function getUsers(req: Request): any {
    const includeInactive = req.query.includeInactive === 'true';
    return userManagement.listUsers(includeInactive);
}

/**
 * Get a specific user by ID
 * Requires: Admin access or own user
 */
function getUser(req: Request): any {
    const userId = req.params.userId;
    const currentUserId = req.session.userId;
    
    // Allow users to view their own profile, admins can view anyone
    const currentUser = currentUserId ? userManagement.getUserById(currentUserId) : null;
    if (!currentUser) {
        throw new ValidationError("Not authenticated");
    }
    
    if (userId !== currentUserId && !currentUser.isAdmin) {
        throw new ValidationError("Access denied");
    }
    
    const user = userManagement.getUserById(userId);
    if (!user) {
        throw new ValidationError("User not found");
    }
    
    // Don't send sensitive data
    const { passwordHash, passwordSalt, derivedKeySalt, encryptedDataKey, ...safeUser } = user;
    return safeUser;
}

/**
 * Create a new user
 * Requires: Admin access
 */
function createUser(req: Request): any {
    const { username, email, password, isAdmin } = req.body;
    
    if (!username || !password) {
        throw new ValidationError("Username and password are required");
    }
    
    // Check if username already exists
    const existing = userManagement.getUserByUsername(username);
    if (existing) {
        throw new ValidationError("Username already exists");
    }
    
    // Validate password strength
    if (password.length < 8) {
        throw new ValidationError("Password must be at least 8 characters long");
    }
    
    const user = userManagement.createUser({
        username,
        email,
        password,
        isAdmin: isAdmin === true
    });
    
    // Don't send sensitive data
    const { passwordHash, passwordSalt, derivedKeySalt, encryptedDataKey, ...safeUser } = user;
    return safeUser;
}

/**
 * Update an existing user
 * Requires: Admin access or own user (with limited fields)
 */
function updateUser(req: Request): any {
    const userId = req.params.userId;
    const currentUserId = req.session.userId;
    const { email, password, isActive, isAdmin } = req.body;
    
    const currentUser = currentUserId ? userManagement.getUserById(currentUserId) : null;
    if (!currentUser) {
        throw new ValidationError("Not authenticated");
    }
    
    const isSelf = userId === currentUserId;
    const isAdminUser = currentUser.isAdmin;
    
    // Regular users can only update their own email and password
    if (!isAdminUser && !isSelf) {
        throw new ValidationError("Access denied");
    }
    
    // Only admins can change isActive and isAdmin flags
    if (!isAdminUser && (isActive !== undefined || isAdmin !== undefined)) {
        throw new ValidationError("Only admins can change user status or admin privileges");
    }
    
    // Validate password if provided
    if (password && password.length < 8) {
        throw new ValidationError("Password must be at least 8 characters long");
    }
    
    const updates: any = {};
    if (email !== undefined) updates.email = email;
    if (password !== undefined) updates.password = password;
    if (isAdminUser && isActive !== undefined) updates.isActive = isActive;
    if (isAdminUser && isAdmin !== undefined) updates.isAdmin = isAdmin;
    
    const user = userManagement.updateUser(userId, updates);
    if (!user) {
        throw new ValidationError("User not found");
    }
    
    // Don't send sensitive data
    const { passwordHash, passwordSalt, derivedKeySalt, encryptedDataKey, ...safeUser } = user;
    return safeUser;
}

/**
 * Delete a user (soft delete)
 * Requires: Admin access
 */
function deleteUser(req: Request): any {
    const userId = req.params.userId;
    const currentUserId = req.session.userId;
    
    // Cannot delete yourself
    if (userId === currentUserId) {
        throw new ValidationError("Cannot delete your own account");
    }
    
    const success = userManagement.deleteUser(userId);
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
    
    const roles = userManagement.getUserRoles(userId);
    
    // Don't send sensitive data
    const { passwordHash, passwordSalt, derivedKeySalt, encryptedDataKey, ...safeUser } = user;
    return {
        ...safeUser,
        roles
    };
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
