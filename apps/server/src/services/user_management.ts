/**
 * User Management Service
 * 
 * Handles all user-related operations including creation, updates, authentication,
 * and role management for multi-user support.
 */

import sql from "./sql.js";
import { randomSecureToken, toBase64 } from "./utils.js";
import dataEncryptionService from "./encryption/data_encryption.js";
import crypto from "crypto";

export interface User {
    userId: string;
    username: string;
    email: string | null;
    passwordHash: string;
    passwordSalt: string;
    derivedKeySalt: string;
    encryptedDataKey: string | null;
    isActive: boolean;
    isAdmin: boolean;
    utcDateCreated: string;
    utcDateModified: string;
}

export interface UserCreateData {
    username: string;
    email?: string;
    password: string;
    isAdmin?: boolean;
}

export interface UserUpdateData {
    email?: string;
    password?: string;
    oldPassword?: string; // Required when changing password to decrypt existing data
    isActive?: boolean;
    isAdmin?: boolean;
}

export interface UserListItem {
    userId: string;
    username: string;
    email: string | null;
    isActive: boolean;
    isAdmin: boolean;
    roles: string[];
    utcDateCreated: string;
}

/**
 * Hash password using scrypt (synchronous)
 */
function hashPassword(password: string, salt: string): string {
    const hashed = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
    return toBase64(hashed);
}

/**
 * Create a new user
 */
function createUser(userData: UserCreateData): User {
    const userId = 'user_' + randomSecureToken(20);
    const now = new Date().toISOString();
    
    // Generate password salt and hash
    const passwordSalt = randomSecureToken(32);
    const derivedKeySalt = randomSecureToken(32);
    
    // Hash the password using scrypt
    const passwordHash = hashPassword(userData.password, passwordSalt);
    
    // Generate data encryption key for this user
    const dataKey = randomSecureToken(16);
    // derive a binary key for encrypting the user's data key
    const passwordDerivedKey = crypto.scryptSync(userData.password, derivedKeySalt, 32, { N: 16384, r: 8, p: 1 });
    // dataEncryptionService.encrypt expects Buffer key and Buffer|string payload
    const encryptedDataKey = dataEncryptionService.encrypt(passwordDerivedKey, Buffer.from(dataKey));
    
    sql.execute(`
        INSERT INTO users (
            userId, username, email, passwordHash, passwordSalt,
            derivedKeySalt, encryptedDataKey, isActive, isAdmin,
            utcDateCreated, utcDateModified
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `, [
        userId,
        userData.username,
        userData.email || null,
        passwordHash,
        passwordSalt,
        derivedKeySalt,
        encryptedDataKey,
        userData.isAdmin ? 1 : 0,
        now,
        now
    ]);
    
    // Assign default role
    const defaultRoleId = userData.isAdmin ? 'role_admin' : 'role_user';
    sql.execute(`
        INSERT INTO user_roles (userId, roleId, utcDateAssigned)
        VALUES (?, ?, ?)
    `, [userId, defaultRoleId, now]);
    
    return getUserById(userId)!;
}

/**
 * Helper function to map database row to User object
 */
function mapRowToUser(user: any): User {
    return {
        userId: user.userId,
        username: user.username,
        email: user.email,
        passwordHash: user.passwordHash,
        passwordSalt: user.passwordSalt,
        derivedKeySalt: user.derivedKeySalt,
        encryptedDataKey: user.encryptedDataKey,
        isActive: Boolean(user.isActive),
        isAdmin: Boolean(user.isAdmin),
        utcDateCreated: user.utcDateCreated,
        utcDateModified: user.utcDateModified
    };
}

/**
 * Get user by ID
 */
function getUserById(userId: string): User | null {
    const user = sql.getRow(`
        SELECT * FROM users WHERE userId = ?
    `, [userId]) as any;
    
    return user ? mapRowToUser(user) : null;
}

/**
 * Get user by username
 */
function getUserByUsername(username: string): User | null {
    const user = sql.getRow(`
        SELECT * FROM users WHERE username = ? COLLATE NOCASE
    `, [username]) as any;
    
    return user ? mapRowToUser(user) : null;
}

/**
 * Update user
 */
function updateUser(userId: string, updates: UserUpdateData): User | null {
    const user = getUserById(userId);
    if (!user) return null;
    
    const now = new Date().toISOString();
    const updateParts: string[] = [];
    const values: any[] = [];
    
    if (updates.email !== undefined) {
        updateParts.push('email = ?');
        values.push(updates.email || null);
    }
    
    if (updates.password !== undefined && updates.oldPassword !== undefined) {
        // Validate that user has existing encrypted data
        if (!user.derivedKeySalt || !user.encryptedDataKey) {
            throw new Error("Cannot change password: user has no encrypted data");
        }
        
        // First, decrypt the existing dataKey with the old password
        const oldPasswordDerivedKey = crypto.scryptSync(
            updates.oldPassword, 
            user.derivedKeySalt, 
            32, 
            { N: 16384, r: 8, p: 1 }
        );
        const dataKey = dataEncryptionService.decrypt(
            oldPasswordDerivedKey, 
            user.encryptedDataKey
        );
        
        if (!dataKey) {
            throw new Error("Cannot change password: failed to decrypt existing data key with old password");
        }
        
        // Generate new password hash
        const passwordSalt = randomSecureToken(32);
        const derivedKeySalt = randomSecureToken(32);
        const passwordHash = hashPassword(updates.password, passwordSalt);
        
        // Re-encrypt the same dataKey with new password
        const passwordDerivedKey = crypto.scryptSync(
            updates.password, 
            derivedKeySalt, 
            32, 
            { N: 16384, r: 8, p: 1 }
        );
        const encryptedDataKey = dataEncryptionService.encrypt(
            passwordDerivedKey, 
            dataKey
        );
        
        updateParts.push('passwordHash = ?', 'passwordSalt = ?', 'derivedKeySalt = ?', 'encryptedDataKey = ?');
        values.push(passwordHash, passwordSalt, derivedKeySalt, encryptedDataKey);
    }
    
    if (updates.isActive !== undefined) {
        updateParts.push('isActive = ?');
        values.push(updates.isActive ? 1 : 0);
    }
    
    if (updates.isAdmin !== undefined) {
        updateParts.push('isAdmin = ?');
        values.push(updates.isAdmin ? 1 : 0);
        
        // Update role assignment
        sql.execute(`DELETE FROM user_roles WHERE userId = ?`, [userId]);
        sql.execute(`
            INSERT INTO user_roles (userId, roleId, utcDateAssigned)
            VALUES (?, ?, ?)
        `, [userId, updates.isAdmin ? 'role_admin' : 'role_user', now]);
    }
    
    if (updateParts.length > 0) {
        updateParts.push('utcDateModified = ?');
        values.push(now, userId);
        
        sql.execute(`
            UPDATE users SET ${updateParts.join(', ')}
            WHERE userId = ?
        `, values);
    }
    
    return getUserById(userId);
}

/**
 * Delete user (soft delete by setting isActive = 0)
 */
function deleteUser(userId: string): boolean {
    const user = getUserById(userId);
    if (!user) return false;
    
    // Prevent deleting the last admin
    if (user.isAdmin) {
        const adminCount = sql.getValue(`SELECT COUNT(*) FROM users WHERE isAdmin = 1 AND isActive = 1`) as number;
        if (adminCount <= 1) {
            throw new Error("Cannot delete the last admin user");
        }
    }
    
    const now = new Date().toISOString();
    sql.execute(`
        UPDATE users SET isActive = 0, utcDateModified = ?
        WHERE userId = ?
    `, [now, userId]);
    
    return true;
}

/**
 * List all users
 */
function listUsers(includeInactive: boolean = false): UserListItem[] {
    const whereClause = includeInactive ? '' : 'WHERE u.isActive = 1';
    
    const users = sql.getRows(`
        SELECT 
            u.userId,
            u.username,
            u.email,
            u.isActive,
            u.isAdmin,
            u.utcDateCreated,
            GROUP_CONCAT(r.name) as roles
        FROM users u
        LEFT JOIN user_roles ur ON u.userId = ur.userId
        LEFT JOIN roles r ON ur.roleId = r.roleId
        ${whereClause}
        GROUP BY u.userId
        ORDER BY u.username
    `);
    
    return users.map((user: any) => ({
        userId: user.userId,
        username: user.username,
        email: user.email,
        isActive: Boolean(user.isActive),
        isAdmin: Boolean(user.isAdmin),
        roles: user.roles ? user.roles.split(',') : [],
        utcDateCreated: user.utcDateCreated
    }));
}

/**
 * Validate user credentials
 */
function validateCredentials(username: string, password: string): User | null {
    const user = getUserByUsername(username);
    if (!user || !user.isActive) {
        return null;
    }
    
    // Verify password using scrypt
    const expectedHash = hashPassword(password, user.passwordSalt);
    
    if (expectedHash !== user.passwordHash) {
        return null;
    }
    
    return user;
}

/**
 * Get user's roles
 */
function getUserRoles(userId: string): string[] {
    const roles = sql.getRows(`
        SELECT r.name
        FROM user_roles ur
        JOIN roles r ON ur.roleId = r.roleId
        WHERE ur.userId = ?
    `, [userId]);
    
    return roles.map((r: any) => r.name);
}

/**
 * Check if user has a specific permission
 */
function hasPermission(userId: string, resource: string, action: string): boolean {
    const user = getUserById(userId);
    if (!user) return false;
    
    // Admins have all permissions
    if (user.isAdmin) return true;
    
    const roles = sql.getRows(`
        SELECT r.permissions
        FROM user_roles ur
        JOIN roles r ON ur.roleId = r.roleId
        WHERE ur.userId = ?
    `, [userId]);
    
    for (const role of roles) {
        try {
            const permissions = JSON.parse((role as any).permissions);
            if (permissions[resource] && permissions[resource].includes(action)) {
                return true;
            }
        } catch (e) {
            console.error('Error parsing role permissions:', e);
        }
    }
    
    return false;
}

/**
 * Check if user can access a note
 */
function canAccessNote(userId: string, noteId: string): boolean {
    const user = getUserById(userId);
    if (!user) return false;
    
    // Admins can access all notes
    if (user.isAdmin) return true;
    
    // Check if user owns the note
    const note = sql.getRow(`SELECT userId FROM notes WHERE noteId = ?`, [noteId]) as any;
    if (note && note.userId === userId) return true;
    
    // Check if note is shared with user
    const share = sql.getRow(`
        SELECT * FROM note_shares 
        WHERE noteId = ? AND sharedWithUserId = ? AND isDeleted = 0
    `, [noteId, userId]);
    
    return !!share;
}

/**
 * Get note permission for user (own, read, write, or null)
 */
function getNotePermission(userId: string, noteId: string): string | null {
    const user = getUserById(userId);
    if (!user) return null;
    
    // Admins have full access
    if (user.isAdmin) return 'admin';
    
    // Check if user owns the note
    const note = sql.getRow(`SELECT userId FROM notes WHERE noteId = ?`, [noteId]) as any;
    if (note && note.userId === userId) return 'own';
    
    // Check if note is shared with user
    const share = sql.getRow(`
        SELECT permission FROM note_shares 
        WHERE noteId = ? AND sharedWithUserId = ? AND isDeleted = 0
    `, [noteId, userId]) as any;
    
    return share ? share.permission : null;
}

export default {
    createUser,
    getUserById,
    getUserByUsername,
    updateUser,
    deleteUser,
    listUsers,
    validateCredentials,
    getUserRoles,
    hasPermission,
    canAccessNote,
    getNotePermission
};
