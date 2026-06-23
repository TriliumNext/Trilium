import { getSql } from "./sql/index.js";
import dateUtils from "./utils/date.js";
import { newEntityId } from "./utils/index.js";
import optionService from "./options.js";

export class PrimaryAdminDeletionError extends Error {
    readonly code = "PRIMARY_ADMIN_DELETION" as const;
    constructor() {
        super("Cannot delete the primary admin user.");
        this.name = "PrimaryAdminDeletionError";
    }
}

export interface User {
    userId: string;
    username: string;
    email: string | null;
    isAdmin: number;
    isDeleted: number;
    dateCreated: string;
    utcDateModified: string;
}

function getAdminUserId(): string {
    return optionService.getOption("adminUserId");
}

function getUserById(userId: string): User | null {
    return getSql().getRow<User>(
        `SELECT userId, username, email, isAdmin, isDeleted, dateCreated, utcDateModified
           FROM users WHERE userId = ? AND isDeleted = 0`,
        [userId]
    ) ?? null;
}

function listUsers(): User[] {
    return getSql().getRows<User>(
        `SELECT userId, username, email, isAdmin, isDeleted, dateCreated, utcDateModified
           FROM users WHERE isDeleted = 0 ORDER BY dateCreated`
    );
}

function createUser(username: string, email: string | null, isAdmin: boolean): string {
    const userId = newEntityId();
    const now = dateUtils.utcNowDateTime();
    getSql().execute(
        `INSERT INTO users (userId, username, email, isAdmin, isDeleted, dateCreated, utcDateModified)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        [userId, username, email, isAdmin ? 1 : 0, now, now]
    );
    return userId;
}

function deleteUser(userId: string): void {
    // Deleting the seeded admin breaks session propagation until the next restart reseeds it.
    if (userId === getAdminUserId()) {
        throw new PrimaryAdminDeletionError();
    }
    getSql().execute(
        `UPDATE users SET isDeleted = 1, utcDateModified = ? WHERE userId = ?`,
        [dateUtils.utcNowDateTime(), userId]
    );
}

export default { getAdminUserId, getUserById, listUsers, createUser, deleteUser };
