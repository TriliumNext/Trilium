/**
 * Migration to add multi-user support to Trilium.
 * 
 * This migration:
 * 1. Extends existing user_data table with multi-user fields
 * 2. Migrates existing password to first user record
 * 3. Adds userId columns to relevant tables (notes, branches, etapi_tokens, recent_notes)
 * 4. Associates all existing data with the default user
 * 
 * Note: This reuses the existing user_data table from migration 229 (OAuth)
 */

import sql from "../services/sql.js";
import optionService from "../services/options.js";

export default async () => {
    console.log("Starting multi-user support migration (v234)...");

    // 1. Extend user_data table with additional fields for multi-user support
    const addColumnIfNotExists = (tableName: string, columnName: string, columnDef: string) => {
        const columns = sql.getRows(`PRAGMA table_info(${tableName})`);
        const hasColumn = columns.some((col: any) => col.name === columnName);
        
        if (!hasColumn) {
            sql.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
            console.log(`Added ${columnName} column to ${tableName}`);
        }
    };

    // Add role/permission tracking
    addColumnIfNotExists('user_data', 'role', 'TEXT DEFAULT "admin"');
    addColumnIfNotExists('user_data', 'isActive', 'INTEGER DEFAULT 1');
    addColumnIfNotExists('user_data', 'utcDateCreated', 'TEXT');
    addColumnIfNotExists('user_data', 'utcDateModified', 'TEXT');

    // Create index on username for faster lookups
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_user_data_username ON user_data (username)`);

    // 2. Add userId columns to existing tables (if they don't exist)
    const addUserIdColumn = (tableName: string) => {
        addColumnIfNotExists(tableName, 'userId', 'INTEGER');
    };

    addUserIdColumn('notes');
    addUserIdColumn('branches');
    addUserIdColumn('recent_notes');
    addUserIdColumn('etapi_tokens');
    
    // Create indexes for userId columns for better performance
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_notes_userId ON notes (userId)`);
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_branches_userId ON branches (userId)`);
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_etapi_tokens_userId ON etapi_tokens (userId)`);
    sql.execute(`CREATE INDEX IF NOT EXISTS IDX_recent_notes_userId ON recent_notes (userId)`);

    // 3. Migrate existing single-user setup to first user in user_data table
    const existingUser = sql.getValue(`SELECT COUNT(*) as count FROM user_data`) as number;
    
    if (existingUser === 0) {
        // Get existing password components from options
        const passwordVerificationHash = optionService.getOption('passwordVerificationHash');
        const passwordVerificationSalt = optionService.getOption('passwordVerificationSalt');
        const passwordDerivedKeySalt = optionService.getOption('passwordDerivedKeySalt');
        const encryptedDataKey = optionService.getOption('encryptedDataKey');

        if (passwordVerificationHash && passwordVerificationSalt) {
            const now = new Date().toISOString();
            
            // Create default admin user from existing credentials
            sql.execute(`
                INSERT INTO user_data (
                    tmpID, username, email, userIDVerificationHash, salt, 
                    derivedKey, userIDEncryptedDataKey, isSetup, role, 
                    isActive, utcDateCreated, utcDateModified
                )
                VALUES (1, 'admin', NULL, ?, ?, ?, ?, 'true', 'admin', 1, ?, ?)
            `, [
                passwordVerificationHash,
                passwordVerificationSalt,
                passwordDerivedKeySalt,
                encryptedDataKey || '',
                now,
                now
            ]);

            console.log("Migrated existing password to default admin user (tmpID=1)");
            
            // 4. Associate all existing data with the default user (tmpID=1)
            sql.execute(`UPDATE notes SET userId = 1 WHERE userId IS NULL`);
            sql.execute(`UPDATE branches SET userId = 1 WHERE userId IS NULL`);
            sql.execute(`UPDATE etapi_tokens SET userId = 1 WHERE userId IS NULL`);
            sql.execute(`UPDATE recent_notes SET userId = 1 WHERE userId IS NULL`);
            
            console.log("Associated all existing data with default admin user");
        } else {
            console.log("No existing password found. User will be created on first login.");
        }
    } else {
        console.log(`Found ${existingUser} existing user(s) in user_data table`);
        
        // Ensure existing users have the new fields populated
        sql.execute(`UPDATE user_data SET role = 'admin' WHERE role IS NULL`);
        sql.execute(`UPDATE user_data SET isActive = 1 WHERE isActive IS NULL`);
        sql.execute(`UPDATE user_data SET utcDateCreated = ? WHERE utcDateCreated IS NULL`, [new Date().toISOString()]);
        sql.execute(`UPDATE user_data SET utcDateModified = ? WHERE utcDateModified IS NULL`, [new Date().toISOString()]);
        
        // Associate data with first user if not already associated
        sql.execute(`UPDATE notes SET userId = 1 WHERE userId IS NULL`);
        sql.execute(`UPDATE branches SET userId = 1 WHERE userId IS NULL`);
        sql.execute(`UPDATE etapi_tokens SET userId = 1 WHERE userId IS NULL`);
        sql.execute(`UPDATE recent_notes SET userId = 1 WHERE userId IS NULL`);
    }

    console.log("Multi-user support migration completed successfully!");
};
