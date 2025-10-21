/**
 * Migration to add multi-user support to Trilium.
 * 
 * This migration:
 * 1. Creates users table
 * 2. Creates roles table
 * 3. Creates user_roles junction table
 * 4. Creates note_shares table for shared notes
 * 5. Adds userId column to existing tables (notes, branches, options, etapi_tokens, etc.)
 * 6. Creates a default admin user with existing password
 * 7. Associates all existing data with the admin user
 */

import sql from "../services/sql.js";
import optionService from "../services/options.js";
import { randomSecureToken } from "../services/utils.js";
import passwordEncryptionService from "../services/encryption/password_encryption.js";
import myScryptService from "../services/encryption/my_scrypt.js";
import { toBase64 } from "../services/utils.js";

export default async () => {
    console.log("Starting multi-user support migration (v234)...");

    // 1. Create users table
    sql.execute(`
        CREATE TABLE IF NOT EXISTS "users" (
            userId TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            email TEXT,
            passwordHash TEXT NOT NULL,
            passwordSalt TEXT NOT NULL,
            derivedKeySalt TEXT NOT NULL,
            encryptedDataKey TEXT,
            isActive INTEGER NOT NULL DEFAULT 1,
            isAdmin INTEGER NOT NULL DEFAULT 0,
            utcDateCreated TEXT NOT NULL,
            utcDateModified TEXT NOT NULL
        )
    `);

    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_users_username ON users (username)`);
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_users_email ON users (email)`);
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_users_isActive ON users (isActive)`);

    // 2. Create roles table
    sql.execute(`
        CREATE TABLE IF NOT EXISTS "roles" (
            roleId TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            permissions TEXT NOT NULL,
            utcDateCreated TEXT NOT NULL,
            utcDateModified TEXT NOT NULL
        )
    `);

    // 3. Create user_roles junction table
    sql.execute(`
        CREATE TABLE IF NOT EXISTS "user_roles" (
            userId TEXT NOT NULL,
            roleId TEXT NOT NULL,
            utcDateAssigned TEXT NOT NULL,
            PRIMARY KEY (userId, roleId),
            FOREIGN KEY (userId) REFERENCES users(userId) ON DELETE CASCADE,
            FOREIGN KEY (roleId) REFERENCES roles(roleId) ON DELETE CASCADE
        )
    `);

    // 4. Create note_shares table for sharing notes between users
    sql.execute(`
        CREATE TABLE IF NOT EXISTS "note_shares" (
            shareId TEXT PRIMARY KEY,
            noteId TEXT NOT NULL,
            ownerId TEXT NOT NULL,
            sharedWithUserId TEXT NOT NULL,
            permission TEXT NOT NULL DEFAULT 'read',
            utcDateCreated TEXT NOT NULL,
            utcDateModified TEXT NOT NULL,
            isDeleted INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (noteId) REFERENCES notes(noteId) ON DELETE CASCADE,
            FOREIGN KEY (ownerId) REFERENCES users(userId) ON DELETE CASCADE,
            FOREIGN KEY (sharedWithUserId) REFERENCES users(userId) ON DELETE CASCADE
        )
    `);

    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_note_shares_noteId ON note_shares (noteId)`);
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_note_shares_sharedWithUserId ON note_shares (sharedWithUserId)`);

    // 5. Add userId columns to existing tables (if they don't exist)
    const addUserIdColumn = (tableName: string) => {
        // Check if column already exists
        const columns = sql.getRows(`PRAGMA table_info(${tableName})`);
        const hasUserId = columns.some((col: any) => col.name === 'userId');
        
        if (!hasUserId) {
            sql.execute(`ALTER TABLE ${tableName} ADD COLUMN userId TEXT`);
            console.log(`Added userId column to ${tableName}`);
        }
    };

    addUserIdColumn('notes');
    addUserIdColumn('branches');
    addUserIdColumn('recent_notes');
    addUserIdColumn('etapi_tokens');
    
    // Create indexes for userId columns
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_notes_userId ON notes (userId)`);
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_branches_userId ON branches (userId)`);
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_etapi_tokens_userId ON etapi_tokens (userId)`);

    // 6. Create default roles
    const now = new Date().toISOString();
    
    const defaultRoles = [
        {
            roleId: 'role_admin',
            name: 'admin',
            description: 'Full system administrator with all permissions',
            permissions: JSON.stringify({
                notes: ['create', 'read', 'update', 'delete'],
                users: ['create', 'read', 'update', 'delete'],
                settings: ['read', 'update'],
                system: ['backup', 'restore', 'migrate']
            })
        },
        {
            roleId: 'role_user',
            name: 'user',
            description: 'Regular user with standard permissions',
            permissions: JSON.stringify({
                notes: ['create', 'read', 'update', 'delete'],
                users: ['read_self', 'update_self'],
                settings: ['read_self']
            })
        },
        {
            roleId: 'role_viewer',
            name: 'viewer',
            description: 'Read-only user',
            permissions: JSON.stringify({
                notes: ['read'],
                users: ['read_self']
            })
        }
    ];

    for (const role of defaultRoles) {
        sql.execute(`
            INSERT OR IGNORE INTO roles (roleId, name, description, permissions, utcDateCreated, utcDateModified)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [role.roleId, role.name, role.description, role.permissions, now, now]);
    }

    // 7. Create default admin user from existing password
    const adminUserId = 'user_admin_' + randomSecureToken(10);
    
    // Get existing password hash components
    const passwordVerificationHash = optionService.getOption('passwordVerificationHash');
    const passwordVerificationSalt = optionService.getOption('passwordVerificationSalt');
    const passwordDerivedKeySalt = optionService.getOption('passwordDerivedKeySalt');
    const encryptedDataKey = optionService.getOption('encryptedDataKey');

    if (passwordVerificationHash && passwordVerificationSalt && passwordDerivedKeySalt) {
        // Check if admin user already exists
        const existingAdmin = sql.getValue(`SELECT userId FROM users WHERE username = 'admin'`);
        
        if (!existingAdmin) {
            sql.execute(`
                INSERT INTO users (
                    userId, username, email, passwordHash, passwordSalt, 
                    derivedKeySalt, encryptedDataKey, isActive, isAdmin,
                    utcDateCreated, utcDateModified
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
            `, [
                adminUserId,
                'admin',
                null,
                passwordVerificationHash,
                passwordVerificationSalt,
                passwordDerivedKeySalt,
                encryptedDataKey || '',
                now,
                now
            ]);

            // Assign admin role to the user
            sql.execute(`
                INSERT INTO user_roles (userId, roleId, utcDateAssigned)
                VALUES (?, ?, ?)
            `, [adminUserId, 'role_admin', now]);

            console.log(`Created default admin user with ID: ${adminUserId}`);
        }
    } else {
        console.log("No existing password found, admin user will need to be created on first login");
    }

    // 8. Associate all existing data with the admin user
    sql.execute(`UPDATE notes SET userId = ? WHERE userId IS NULL`, [adminUserId]);
    sql.execute(`UPDATE branches SET userId = ? WHERE userId IS NULL`, [adminUserId]);
    sql.execute(`UPDATE etapi_tokens SET userId = ? WHERE userId IS NULL`, [adminUserId]);
    sql.execute(`UPDATE recent_notes SET userId = ? WHERE userId IS NULL`, [adminUserId]);

    console.log("Multi-user support migration completed successfully!");
};
