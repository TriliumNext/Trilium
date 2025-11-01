/**
 * Migration for Collaborative Multi-User Support
 * 
 * This migration implements a collaborative model where:
 * - Users can share notes with other users/groups
 * - Notes have granular permissions (read, write, admin)
 * - Users can sync only notes they have access to
 * - Groups allow organizing users for easier permission management
 * 
 * Architecture:
 * - users: User accounts with authentication
 * - groups: Collections of users for permission management
 * - group_members: Many-to-many user-group relationships
 * - note_permissions: Granular access control per note
 * - note_ownership: Tracks who created each note
 */

import sql from "../services/sql.js";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

export default async function () {
    console.log("Starting collaborative multi-user migration (v234)...");

    // ============================================================
    // 1. CREATE USERS TABLE
    // ============================================================
    sql.execute(`
        CREATE TABLE IF NOT EXISTS users (
            userId INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT,
            passwordHash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
            isActive INTEGER DEFAULT 1,
            utcDateCreated TEXT NOT NULL,
            utcDateModified TEXT NOT NULL,
            lastLoginAt TEXT,
            UNIQUE(username COLLATE NOCASE)
        )
    `);

    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_users_username ON users(username COLLATE NOCASE)`);
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_users_isActive ON users(isActive)`);

    // ============================================================
    // 2. CREATE GROUPS TABLE
    // ============================================================
    sql.execute(`
        CREATE TABLE IF NOT EXISTS groups (
            groupId INTEGER PRIMARY KEY AUTOINCREMENT,
            groupName TEXT NOT NULL UNIQUE,
            description TEXT,
            createdBy INTEGER NOT NULL,
            utcDateCreated TEXT NOT NULL,
            utcDateModified TEXT NOT NULL,
            FOREIGN KEY (createdBy) REFERENCES users(userId) ON DELETE CASCADE
        )
    `);

    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_groups_groupName ON groups(groupName COLLATE NOCASE)`);
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_groups_createdBy ON groups(createdBy)`);

    // ============================================================
    // 3. CREATE GROUP_MEMBERS TABLE
    // ============================================================
    sql.execute(`
        CREATE TABLE IF NOT EXISTS group_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            groupId INTEGER NOT NULL,
            userId INTEGER NOT NULL,
            addedBy INTEGER NOT NULL,
            utcDateAdded TEXT NOT NULL,
            UNIQUE(groupId, userId),
            FOREIGN KEY (groupId) REFERENCES groups(groupId) ON DELETE CASCADE,
            FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE,
            FOREIGN KEY (addedBy) REFERENCES users(userId)
        )
    `);

    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_group_members_userId ON group_members(userId)`);
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_group_members_groupId ON group_members(groupId)`);

    // ============================================================
    // 4. CREATE NOTE_OWNERSHIP TABLE
    // ============================================================
    sql.execute(`
        CREATE TABLE IF NOT EXISTS note_ownership (
            noteId TEXT PRIMARY KEY,
            ownerId INTEGER NOT NULL,
            utcDateCreated TEXT NOT NULL,
            FOREIGN KEY (noteId) REFERENCES notes(noteId) ON DELETE CASCADE,
            FOREIGN KEY (ownerId) REFERENCES users(userId) ON DELETE CASCADE
        )
    `);

    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_note_ownership_ownerId ON note_ownership(ownerId)`);

    // ============================================================
    // 5. CREATE NOTE_PERMISSIONS TABLE
    // ============================================================
    sql.execute(`
        CREATE TABLE IF NOT EXISTS note_permissions (
            permissionId INTEGER PRIMARY KEY AUTOINCREMENT,
            noteId TEXT NOT NULL,
            granteeType TEXT NOT NULL CHECK(granteeType IN ('user', 'group')),
            granteeId INTEGER NOT NULL,
            permission TEXT NOT NULL CHECK(permission IN ('read', 'write', 'admin')),
            grantedBy INTEGER NOT NULL,
            utcDateGranted TEXT NOT NULL,
            utcDateModified TEXT NOT NULL,
            UNIQUE(noteId, granteeType, granteeId),
            FOREIGN KEY (noteId) REFERENCES notes(noteId) ON DELETE CASCADE,
            FOREIGN KEY (grantedBy) REFERENCES users(userId)
        )
    `);

    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_note_permissions_noteId ON note_permissions(noteId)`);
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_note_permissions_grantee ON note_permissions(granteeType, granteeId)`);
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_note_permissions_grantedBy ON note_permissions(grantedBy)`);

    // ============================================================
    // 6. MIGRATE EXISTING user_data TO users TABLE
    // ============================================================
    const existingUser = sql.getRow<{
        tmpID: number;
        username: string;
        salt: string;
        derivedKey: string;
        email: string;
    }>("SELECT tmpID, username, salt, derivedKey, email FROM user_data WHERE tmpID = 1");

    const now = new Date().toISOString();

    if (existingUser && existingUser.username) {
        // Migrate existing user from user_data table
        const userExists = sql.getValue<number>("SELECT COUNT(*) FROM users WHERE userId = ?", [
            existingUser.tmpID
        ]);

        if (!userExists) {
            sql.execute(
                `INSERT INTO users (userId, username, email, passwordHash, salt, role, isActive, utcDateCreated, utcDateModified)
                 VALUES (?, ?, ?, ?, ?, 'admin', 1, ?, ?)`,
                [
                    existingUser.tmpID,
                    existingUser.username,
                    existingUser.email || "admin@trilium.local",
                    existingUser.derivedKey,
                    existingUser.salt,
                    now,
                    now
                ]
            );

            console.log(`Migrated existing user '${existingUser.username}' from user_data table`);
        }
    } else {
        // Create default admin user if none exists
        const userCount = sql.getValue<number>("SELECT COUNT(*) FROM users");

        if (userCount === 0) {
            const adminPassword = "admin123"; // MUST be changed on first login
            const salt = randomBytes(16).toString("hex");
            const passwordHash = (await scryptAsync(adminPassword, salt, 64)) as Buffer;

            sql.execute(
                `INSERT INTO users (username, email, passwordHash, salt, role, isActive, utcDateCreated, utcDateModified)
                 VALUES ('admin', 'admin@trilium.local', ?, ?, 'admin', 1, ?, ?)`,
                [passwordHash.toString("hex"), salt, now, now]
            );

            console.log("Created default admin user (username: admin, password: admin123)");
        }
    }

    // ============================================================
    // 7. ASSIGN OWNERSHIP OF ALL EXISTING NOTES TO ADMIN (userId=1)
    // ============================================================
    const allNoteIds = sql.getColumn<string>("SELECT noteId FROM notes WHERE isDeleted = 0");

    for (const noteId of allNoteIds) {
        const ownershipExists = sql.getValue<number>(
            "SELECT COUNT(*) FROM note_ownership WHERE noteId = ?",
            [noteId]
        );

        if (!ownershipExists) {
            sql.execute(
                `INSERT INTO note_ownership (noteId, ownerId, utcDateCreated)
                 VALUES (?, 1, ?)`,
                [noteId, now]
            );
        }
    }

    console.log(`Assigned ownership of ${allNoteIds.length} existing notes to admin user`);

    // ============================================================
    // 8. CREATE DEFAULT "All Users" GROUP
    // ============================================================
    const allUsersGroupExists = sql.getValue<number>(
        "SELECT COUNT(*) FROM groups WHERE groupName = 'All Users'"
    );

    if (!allUsersGroupExists) {
        sql.execute(
            `INSERT INTO groups (groupName, description, createdBy, utcDateCreated, utcDateModified)
             VALUES ('All Users', 'Default group containing all users', 1, ?, ?)`,
            [now, now]
        );

        const allUsersGroupId = sql.getValue<number>("SELECT groupId FROM groups WHERE groupName = 'All Users'");

        // Add admin user to "All Users" group
        sql.execute(
            `INSERT INTO group_members (groupId, userId, addedBy, utcDateAdded)
             VALUES (?, 1, 1, ?)`,
            [allUsersGroupId, now]
        );

        console.log("Created default 'All Users' group");
    }

    console.log("Collaborative multi-user migration completed successfully!");
    console.log("");
    console.log("IMPORTANT NOTES:");
    console.log("- Default admin credentials: username='admin', password='admin123'");
    console.log("- All existing notes are owned by admin (userId=1)");
    console.log("- Use note_permissions table to grant access to other users/groups");
    console.log("- Owners have implicit 'admin' permission on their notes");
    console.log("");
}
