/**
 * User Management Service for Collaborative Multi-User Support
 * Handles user authentication, CRUD operations, and session management
 */

import sql from "./sql.js";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import groupManagement from "./group_management.js";

const scryptAsync = promisify(scrypt);

interface User {
    userId: number;
    username: string;
    email: string | null;
    passwordHash: string;
    salt: string;
    role: "admin" | "user";
    isActive: number;
    utcDateCreated: string;
    utcDateModified: string;
    lastLoginAt: string | null;
}

interface SafeUser {
    userId: number;
    username: string;
    email: string | null;
    role: "admin" | "user";
    isActive: number;
    utcDateCreated: string;
    utcDateModified: string;
    lastLoginAt: string | null;
}

/**
 * Create a new user
 * @param username - Username (must be unique)
 * @param password - Plain text password
 * @param email - Email address (optional)
 * @param role - User role (default: 'user')
 * @returns Created user ID
 */
export async function createUser(
    username: string,
    password: string,
    email: string | null = null,
    role: "admin" | "user" = "user"
): Promise<number> {
    // Validate username
    if (!username || username.length < 3) {
        throw new Error("Username must be at least 3 characters long");
    }

    // Validate password
    if (!password || password.length < 8) {
        throw new Error("Password must be at least 8 characters long");
    }

    // Check if username already exists
    const existingUser = sql.getValue<number>("SELECT COUNT(*) FROM users WHERE username = ?", [username]);

    if (existingUser) {
        throw new Error(`Username '${username}' is already taken`);
    }

    // Hash password
    const salt = randomBytes(16).toString("hex");
    const passwordHash = (await scryptAsync(password, salt, 64)) as Buffer;
    const now = new Date().toISOString();

    // Insert user
    sql.execute(
        `INSERT INTO users (username, email, passwordHash, salt, role, isActive, utcDateCreated, utcDateModified)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [username, email, passwordHash.toString("hex"), salt, role, now, now]
    );

    const userId = sql.getValue<number>("SELECT last_insert_rowid()");

    if (!userId) {
        throw new Error("Failed to create user");
    }

    // Add user to "All Users" group
    groupManagement.ensureUserInAllUsersGroup(userId);

    return userId;
}

/**
 * Authenticate a user with username and password
 * @param username - Username
 * @param password - Plain text password
 * @returns User object if authentication successful, null otherwise
 */
export async function validateCredentials(username: string, password: string): Promise<SafeUser | null> {
    const user = sql.getRow<User>("SELECT * FROM users WHERE username = ? AND isActive = 1", [username]);

    if (!user) {
        // Use constant time comparison to prevent timing attacks
        const dummySalt = randomBytes(16).toString("hex");
        await scryptAsync(password, dummySalt, 64);
        return null;
    }

    const passwordHash = Buffer.from(user.passwordHash, "hex");
    const derivedKey = (await scryptAsync(password, user.salt, 64)) as Buffer;

    // Timing-safe comparison
    if (!timingSafeEqual(passwordHash, derivedKey)) {
        return null;
    }

    // Update last login timestamp
    const now = new Date().toISOString();
    sql.execute("UPDATE users SET lastLoginAt = ? WHERE userId = ?", [now, user.userId]);

    return getSafeUser(user);
}

/**
 * Get user by ID
 * @param userId - User ID
 * @returns Safe user object (without password hash)
 */
export function getUser(userId: number): SafeUser | null {
    const user = sql.getRow<User>("SELECT * FROM users WHERE userId = ?", [userId]);
    return user ? getSafeUser(user) : null;
}

/**
 * Get user by username
 * @param username - Username
 * @returns Safe user object (without password hash)
 */
export function getUserByUsername(username: string): SafeUser | null {
    const user = sql.getRow<User>("SELECT * FROM users WHERE username = ?", [username]);
    return user ? getSafeUser(user) : null;
}

/**
 * Get all users
 * @param includeInactive - Include inactive users (default: false)
 * @returns Array of safe user objects
 */
export function getAllUsers(includeInactive: boolean = false): SafeUser[] {
    const query = includeInactive
        ? "SELECT * FROM users ORDER BY username"
        : "SELECT * FROM users WHERE isActive = 1 ORDER BY username";

    const users = sql.getRows<User>(query);
    return users.map((u) => getSafeUser(u));
}

/**
 * Update user information
 * @param userId - User ID
 * @param updates - Fields to update
 */
export function updateUser(
    userId: number,
    updates: {
        username?: string;
        email?: string | null;
        role?: "admin" | "user";
        isActive?: number;
    }
): void {
    const now = new Date().toISOString();
    const fields: string[] = [];
    const params: any[] = [];

    if (updates.username !== undefined) {
        // Check if username is taken by another user
        const existingUser = sql.getRow<User>(
            "SELECT * FROM users WHERE username = ? AND userId != ?",
            [updates.username, userId]
        );

        if (existingUser) {
            throw new Error(`Username '${updates.username}' is already taken`);
        }

        fields.push("username = ?");
        params.push(updates.username);
    }

    if (updates.email !== undefined) {
        fields.push("email = ?");
        params.push(updates.email);
    }

    if (updates.role !== undefined) {
        fields.push("role = ?");
        params.push(updates.role);
    }

    if (updates.isActive !== undefined) {
        fields.push("isActive = ?");
        params.push(updates.isActive);
    }

    if (fields.length === 0) {
        return; // Nothing to update
    }

    fields.push("utcDateModified = ?");
    params.push(now);
    params.push(userId);

    sql.execute(`UPDATE users SET ${fields.join(", ")} WHERE userId = ?`, params);
}

/**
 * Change user password
 * @param userId - User ID
 * @param newPassword - New password
 */
export async function changePassword(userId: number, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 8) {
        throw new Error("Password must be at least 8 characters long");
    }

    const salt = randomBytes(16).toString("hex");
    const passwordHash = (await scryptAsync(newPassword, salt, 64)) as Buffer;
    const now = new Date().toISOString();

    sql.execute(
        "UPDATE users SET passwordHash = ?, salt = ?, utcDateModified = ? WHERE userId = ?",
        [passwordHash.toString("hex"), salt, now, userId]
    );
}

/**
 * Delete a user
 * @param userId - User ID
 */
export function deleteUser(userId: number): void {
    // Prevent deleting the last admin
    const user = sql.getRow<User>("SELECT * FROM users WHERE userId = ?", [userId]);

    if (user && user.role === "admin") {
        const adminCount = sql.getValue<number>("SELECT COUNT(*) FROM users WHERE role = 'admin' AND isActive = 1");

        if (adminCount <= 1) {
            throw new Error("Cannot delete the last admin user");
        }
    }

    sql.execute("DELETE FROM users WHERE userId = ?", [userId]);
}

/**
 * Deactivate a user (soft delete)
 * @param userId - User ID
 */
export function deactivateUser(userId: number): void {
    updateUser(userId, { isActive: 0 });
}

/**
 * Activate a user
 * @param userId - User ID
 */
export function activateUser(userId: number): void {
    updateUser(userId, { isActive: 1 });
}

/**
 * Check if a user is an admin
 * @param userId - User ID
 * @returns True if user is admin
 */
export function isAdmin(userId: number): boolean {
    const role = sql.getValue<string>("SELECT role FROM users WHERE userId = ? AND isActive = 1", [userId]);
    return role === "admin";
}

/**
 * Get number of active users
 * @returns Count of active users
 */
export function getActiveUserCount(): number {
    return sql.getValue<number>("SELECT COUNT(*) FROM users WHERE isActive = 1") || 0;
}

/**
 * Remove sensitive fields from user object
 * @param user - User object with sensitive data
 * @returns Safe user object
 */
function getSafeUser(user: User): SafeUser {
    const { passwordHash, salt, ...safeUser } = user;
    return safeUser;
}

export default {
    createUser,
    validateCredentials,
    getUser,
    getUserByUsername,
    getAllUsers,
    updateUser,
    changePassword,
    deleteUser,
    deactivateUser,
    activateUser,
    isAdmin,
    getActiveUserCount
};
