import { getSql } from "./sql/index.js";
import dateUtils from "./utils/date.js";
import { newEntityId, randomSecureToken } from "./utils/index.js";
import { encodeBase64 } from "./utils/binary.js";
import optionService from "./options.js";
import { getCrypto } from "./encryption/crypto.js";
import scrypt from "./encryption/scrypt.js";
import { evictUser } from "../becca/becca_cache.js";

/** How long a setup link stays usable after it is created. */
const SETUP_LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

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
    /** Whether the user has chosen a password, through a setup link. */
    hasPassword: number;
    /** When the user's current setup link stops working, or null when there is none. */
    setupTokenExpiresAt: string | null;
}

/** A setup link as handed to the admin: the token is shown once and only its hash is stored. */
export interface SetupLink {
    token: string;
    expiresAt: string;
}

export interface UserChanges {
    username?: string;
    email?: string | null;
    isAdmin?: boolean;
}

const USER_COLUMNS = "userId, username, email, isAdmin, isDeleted, dateCreated, utcDateModified, "
    + "passwordHash IS NOT NULL AS hasPassword, setupTokenExpiresAt";

function getAdminUserId(): string {
    return optionService.getOption("adminUserId");
}

function getUserById(userId: string): User | null {
    return getSql().getRow<User>(
        `SELECT ${USER_COLUMNS}
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
        `SELECT ${USER_COLUMNS}
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

/**
 * Issues a new setup link for the user, replacing any earlier one. Following it lets them choose a
 * password; for a user who already has one, it serves as a reset.
 */
function createSetupLink(userId: string): SetupLink {
    const token = toHex(getCrypto().randomBytes(32));
    const expiresAt = dateUtils.utcDateTimeStr(new Date(Date.now() + SETUP_LINK_LIFETIME_MS));

    getSql().execute(
        `UPDATE users SET setupTokenHash = ?, setupTokenExpiresAt = ?, utcDateModified = ? WHERE userId = ?`,
        [hashSetupToken(token), expiresAt, dateUtils.utcNowDateTime(), userId]
    );

    return { token, expiresAt };
}

/** The user a setup token belongs to, provided the link has not expired nor been used. */
function getUserBySetupToken(token: string): User | null {
    if (!token) {
        return null;
    }

    return getSql().getRow<User>(
        `SELECT ${USER_COLUMNS}
           FROM users
          WHERE setupTokenHash = ? AND isDeleted = 0 AND setupTokenExpiresAt > ?`,
        [hashSetupToken(token), dateUtils.utcNowDateTime()]
    ) ?? null;
}

/**
 * Sets the password of the user the setup token belongs to and spends the token.
 * @returns false when the link is invalid, expired or was already used.
 */
async function completeSetup(token: string, password: string): Promise<boolean> {
    const user = getUserBySetupToken(token);
    if (!user) {
        return false;
    }

    const salt = randomSecureToken(32);
    const passwordHash = encodeBase64(await scrypt.getScryptHash(password, salt));

    // Matching on the token hash again keeps a link that was used or replaced while the hash was
    // being computed from being spent twice.
    const { changes } = getSql().execute(
        `UPDATE users
            SET passwordHash = ?, passwordSalt = ?, setupTokenHash = NULL, setupTokenExpiresAt = NULL, utcDateModified = ?
          WHERE userId = ? AND setupTokenHash = ?`,
        [passwordHash, salt, dateUtils.utcNowDateTime(), user.userId, hashSetupToken(token)]
    );

    return changes > 0;
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

export default {
    getAdminUserId, getUserById, isUserAdmin, listUsers, createUser, updateUser, deleteUser,
    createSetupLink, getUserBySetupToken, completeSetup
};

function hashSetupToken(token: string) {
    return encodeBase64(getCrypto().createHash("sha512", token));
}

function toHex(bytes: Uint8Array) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
