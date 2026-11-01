import { getSql } from "./sql/index.js";
import dateUtils from "./utils/date.js";
import { newEntityId } from "./utils/index.js";
import optionService from "./options.js";
import { evictUser } from "../becca/becca_cache.js";

export class PrimaryAdminDeletionError extends Error {
    readonly code = "PRIMARY_ADMIN_DELETION" as const;
    constructor() {
        super("Cannot delete the primary admin user.");
        this.name = "PrimaryAdminDeletionError";
    }
}

export class PrimaryAdminDemotionError extends Error {
    readonly code = "PRIMARY_ADMIN_DEMOTION" as const;
    constructor() {
        super("Cannot remove admin rights from the primary admin user.");
        this.name = "PrimaryAdminDemotionError";
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

export interface UserChanges {
    username?: string;
    email?: string | null;
    isAdmin?: boolean;
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

function isUserAdmin(userId: string): boolean {
    return !!getSql().getValue<number>(
        "SELECT isAdmin FROM users WHERE userId = ? AND isDeleted = 0", [userId]
    );
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

function updateUser(userId: string, changes: UserChanges): void {
    // Demoting the seeded admin would leave every login holding a filtered, non-admin view.
    if (changes.isAdmin === false && userId === getAdminUserId()) {
        throw new PrimaryAdminDemotionError();
    }

    const user = getUserById(userId);
    if (!user) {
        return;
    }

    getSql().execute(
        `UPDATE users SET username = ?, email = ?, isAdmin = ?, utcDateModified = ? WHERE userId = ?`,
        [
            changes.username ?? user.username,
            changes.email !== undefined ? changes.email : user.email,
            changes.isAdmin !== undefined ? (changes.isAdmin ? 1 : 0) : user.isAdmin,
            dateUtils.utcNowDateTime(),
            userId
        ]
    );

    // Admins read the unfiltered Becca; a cached filtered one must not outlive a role change.
    if (changes.isAdmin !== undefined && !!user.isAdmin !== changes.isAdmin) {
        evictUser(userId);
    }
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
    evictUser(userId);
}

export default { getAdminUserId, getUserById, isUserAdmin, listUsers, createUser, updateUser, deleteUser };
