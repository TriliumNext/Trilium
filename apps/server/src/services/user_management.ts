/**
 * User Management Service
 * 
 * Handles all user-related operations including creation, updates, authentication,
 * and role management for multi-user support.
 * 
 * Works with existing user_data table (from OAuth migration v229):
 * - tmpID: Primary key (INTEGER)
 * - username: User's login name
 * - email: Email address
 * - userIDVerificationHash: Password hash for verification
 * - salt: Salt for password hashing
 * - derivedKey: Salt for deriving encryption key
 * - userIDEncryptedDataKey: Encrypted data key
 * - isSetup: 'true' or 'false' string
 * - role: 'admin', 'user', or 'viewer'
 * - isActive: 1 or 0
 */

import sql from "./sql.js";
import { randomSecureToken, toBase64, fromBase64 } from "./utils.js";
import crypto from "crypto";

/**
 * User roles with different permission levels
 */
export enum UserRole {
    ADMIN = 'admin',
    USER = 'user',
    VIEWER = 'viewer'
}

/**
 * User interface representing a Trilium user in user_data table
 */
export interface User {
    tmpID: number;
    username: string;
    email: string | null;
    userIDVerificationHash: string;
    salt: string;
    derivedKey: string;
    userIDEncryptedDataKey: string | null;
    isSetup: string;
    role: UserRole;
    isActive: number;
    utcDateCreated: string;
    utcDateModified: string;
}

export interface UserCreateData {
    username: string;
    email?: string;
    password: string;
    role?: UserRole;
}

export interface UserUpdateData {
    email?: string;
    password?: string;
    isActive?: boolean;
    role?: UserRole;
}

export interface UserListItem {
    tmpID: number;
    username: string;
    email: string | null;
    isActive: number;
    role: UserRole;
    utcDateCreated: string;
}

/**
 * Hash password using scrypt (matching Trilium's method)
 */
function hashPassword(password: string, salt: string): string {
    const hashed = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
    return toBase64(hashed);
}

/**
 * Helper function to map database row to User object
 */
function mapRowToUser(user: any): User {
    return {
        tmpID: user.tmpID,
        username: user.username,
        email: user.email,
        userIDVerificationHash: user.userIDVerificationHash,
        salt: user.salt,
        derivedKey: user.derivedKey,
        userIDEncryptedDataKey: user.userIDEncryptedDataKey,
        isSetup: user.isSetup || 'true',
        role: user.role || UserRole.USER,
        isActive: user.isActive !== undefined ? user.isActive : 1,
        utcDateCreated: user.utcDateCreated || new Date().toISOString(),
        utcDateModified: user.utcDateModified || new Date().toISOString()
    };
}

/**
 * Validate username format
 */
function validateUsername(username: string): void {
    if (!username || typeof username !== 'string') {
        throw new Error("Username is required");
    }
    
    const trimmed = username.trim();
    if (trimmed.length === 0) {
        throw new Error("Username cannot be empty");
    }
    
    if (trimmed.length < 3) {
        throw new Error("Username must be at least 3 characters long");
    }
    
    if (trimmed.length > 50) {
        throw new Error("Username must be at most 50 characters long");
    }
    
    // Allow alphanumeric, underscore, hyphen, and dot
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
        throw new Error("Username can only contain letters, numbers, dots, underscores, and hyphens");
    }
}

/**
 * Validate password strength
 */
function validatePassword(password: string): void {
    if (!password || typeof password !== 'string') {
        throw new Error("Password is required");
    }
    
    if (password.length < 8) {
        throw new Error("Password must be at least 8 characters long");
    }
    
    if (password.length > 100) {
        throw new Error("Password must be at most 100 characters long");
    }
}

/**
 * Create a new user
 */
function createUser(userData: UserCreateData): User {
    validateUsername(userData.username);
    validatePassword(userData.password);
    
    const now = new Date().toISOString();
    
    // Get next tmpID
    const maxId = sql.getValue(`SELECT MAX(tmpID) as maxId FROM user_data`) as number || 0;
    const tmpID = maxId + 1;
    
    // Generate password components using Trilium's scrypt parameters
    const passwordSalt = randomSecureToken(32);
    const derivedKeySalt = randomSecureToken(32);
    const passwordHash = hashPassword(userData.password, passwordSalt);
    
    sql.execute(`
        INSERT INTO user_data (
            tmpID, username, email, userIDVerificationHash, salt,
            derivedKey, userIDEncryptedDataKey, isSetup, role,
            isActive, utcDateCreated, utcDateModified
        )
        VALUES (?, ?, ?, ?, ?, ?, '', 'true', ?, 1, ?, ?)
    `, [
        tmpID,
        userData.username,
        userData.email || null,
        passwordHash,
        passwordSalt,
        derivedKeySalt,
        userData.role || UserRole.USER,
        now,
        now
    ]);
    
    return getUserById(tmpID)!;
}

/**
 * Get user by ID (tmpID)
 */
function getUserById(tmpID: number): User | null {
    const user = sql.getRow(`
        SELECT * FROM user_data WHERE tmpID = ?
    `, [tmpID]) as any;
    
    return user ? mapRowToUser(user) : null;
}

/**
 * Get user by username
 */
function getUserByUsername(username: string): User | null {
    const user = sql.getRow(`
        SELECT * FROM user_data WHERE username = ? COLLATE NOCASE
    `, [username]) as any;
    
    return user ? mapRowToUser(user) : null;
}

/**
 * Update user
 */
function updateUser(tmpID: number, updates: UserUpdateData): User | null {
    const user = getUserById(tmpID);
    if (!user) return null;
    
    // Validate password if provided
    if (updates.password !== undefined) {
        validatePassword(updates.password);
    }
    
    // Validate email format if provided
    if (updates.email !== undefined && updates.email !== null && updates.email.trim() !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(updates.email)) {
            throw new Error("Invalid email format");
        }
        if (updates.email.length > 100) {
            throw new Error("Email must be at most 100 characters long");
        }
    }
    
    const now = new Date().toISOString();
    const updateParts: string[] = [];
    const values: any[] = [];
    
    if (updates.email !== undefined) {
        updateParts.push('email = ?');
        values.push(updates.email || null);
    }
    
    if (updates.password !== undefined) {
        // Generate new password hash
        const passwordSalt = randomSecureToken(32);
        const derivedKeySalt = randomSecureToken(32);
        const passwordHash = hashPassword(updates.password, passwordSalt);
        
        updateParts.push('userIDVerificationHash = ?', 'salt = ?', 'derivedKey = ?');
        values.push(passwordHash, passwordSalt, derivedKeySalt);
    }
    
    if (updates.isActive !== undefined) {
        updateParts.push('isActive = ?');
        values.push(updates.isActive ? 1 : 0);
    }
    
    if (updates.role !== undefined) {
        updateParts.push('role = ?');
        values.push(updates.role);
    }
    
    if (updateParts.length > 0) {
        updateParts.push('utcDateModified = ?');
        values.push(now, tmpID);
        
        sql.execute(`
            UPDATE user_data SET ${updateParts.join(', ')}
            WHERE tmpID = ?
        `, values);
    }
    
    return getUserById(tmpID);
}

/**
 * Delete user (soft delete by setting isActive = 0)
 */
function deleteUser(tmpID: number): boolean {
    const user = getUserById(tmpID);
    if (!user) return false;
    
    // Prevent deleting the last admin
    if (user.role === UserRole.ADMIN) {
        const adminCount = sql.getValue(`
            SELECT COUNT(*) FROM user_data 
            WHERE role = 'admin' AND isActive = 1
        `) as number;
        if (adminCount <= 1) {
            throw new Error("Cannot delete the last admin user");
        }
    }
    
    const now = new Date().toISOString();
    sql.execute(`
        UPDATE user_data SET isActive = 0, utcDateModified = ?
        WHERE tmpID = ?
    `, [now, tmpID]);
    
    return true;
}

/**
 * List all users
 */
function listUsers(includeInactive: boolean = false): UserListItem[] {
    const whereClause = includeInactive ? '' : 'WHERE isActive = 1';
    
    const users = sql.getRows(`
        SELECT tmpID, username, email, isActive, role, utcDateCreated
        FROM user_data
        ${whereClause}
        ORDER BY username
    `);
    
    return users.map((user: any) => ({
        tmpID: user.tmpID,
        username: user.username,
        email: user.email,
        isActive: user.isActive,
        role: user.role || UserRole.USER,
        utcDateCreated: user.utcDateCreated
    }));
}

/**
 * Validate user credentials
 * Uses constant-time comparison to prevent timing attacks
 */
function validateCredentials(username: string, password: string): User | null {
    const user = getUserByUsername(username);
    if (!user || user.isActive !== 1) {
        // Perform dummy hash computation to prevent timing attack via early exit
        const dummySalt = 'dummy_salt_for_timing_protection_only';
        hashPassword(password, dummySalt);
        return null;
    }
    
    // Verify password using scrypt
    const expectedHash = hashPassword(password, user.salt);
    
    // Use constant-time comparison to prevent timing attacks
    const expectedBuffer = Buffer.from(expectedHash);
    const actualBuffer = Buffer.from(user.userIDVerificationHash);
    
    // crypto.timingSafeEqual requires buffers of same length
    if (expectedBuffer.length !== actualBuffer.length) {
        return null;
    }
    
    if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
        return null;
    }
    
    return user;
}

/**
 * Check if user is admin
 */
function isAdmin(tmpID: number): boolean {
    const user = getUserById(tmpID);
    return user?.role === UserRole.ADMIN;
}

/**
 * Check if user can access a note (basic ownership check)
 */
function canAccessNote(tmpID: number, noteId: string): boolean {
    const user = getUserById(tmpID);
    if (!user) return false;
    
    // Admins can access all notes
    if (user.role === UserRole.ADMIN) return true;
    
    // Check if user owns the note
    const note = sql.getRow(`SELECT userId FROM notes WHERE noteId = ?`, [noteId]) as any;
    return note && note.userId === tmpID;
}

/**
 * Get note permission for user (own, admin, or null)
 */
function getNotePermission(tmpID: number, noteId: string): string | null {
    const user = getUserById(tmpID);
    if (!user) return null;
    
    // Admins have full access
    if (user.role === UserRole.ADMIN) return 'admin';
    
    // Check if user owns the note
    const note = sql.getRow(`SELECT userId FROM notes WHERE noteId = ?`, [noteId]) as any;
    if (note && note.userId === tmpID) return 'own';
    
    return null;
}

export default {
    createUser,
    getUserById,
    getUserByUsername,
    updateUser,
    deleteUser,
    listUsers,
    validateCredentials,
    validateUsername,
    validatePassword,
    isAdmin,
    canAccessNote,
    getNotePermission,
    UserRole
};
