/**
 * SQLite Custom Functions Service
 *
 * This service manages custom SQLite functions for general database operations.
 * Functions are registered with better-sqlite3 to provide native-speed operations
 * directly within SQL queries.
 *
 * These functions are used by:
 * - Fuzzy search fallback (edit_distance)
 * - Regular expression matching (regex_match)
 */

import type { Database } from "better-sqlite3";
import log from "../log.js";

/**
 * Configuration for fuzzy search operations
 */
const FUZZY_CONFIG = {
    MAX_EDIT_DISTANCE: 2,
    MIN_TOKEN_LENGTH: 3,
    MAX_STRING_LENGTH: 1000, // Performance guard for edit distance
} as const;

/**
 * Interface for registering a custom SQL function
 */
interface SQLiteFunction {
    name: string;
    implementation: (...args: any[]) => any;
    options?: {
        deterministic?: boolean;
        varargs?: boolean;
        directOnly?: boolean;
    };
}

/**
 * Manages registration and lifecycle of custom SQLite functions
 */
export class SqliteFunctionsService {
    private static instance: SqliteFunctionsService | null = null;
    private registered = false;
    private functions: SQLiteFunction[] = [];

    private constructor() {
        // Initialize the function definitions
        this.initializeFunctions();
    }

    /**
     * Get singleton instance of the service
     */
    static getInstance(): SqliteFunctionsService {
        if (!SqliteFunctionsService.instance) {
            SqliteFunctionsService.instance = new SqliteFunctionsService();
        }
        return SqliteFunctionsService.instance;
    }

    /**
     * Initialize all custom function definitions
     */
    private initializeFunctions(): void {
        // Bind all methods to preserve 'this' context
        this.functions = [
            {
                name: "edit_distance",
                implementation: this.editDistance.bind(this),
                options: {
                    deterministic: true,
                    varargs: true  // Changed to true to handle variable arguments
                }
            },
            {
                name: "regex_match",
                implementation: this.regexMatch.bind(this),
                options: {
                    deterministic: true,
                    varargs: true  // Changed to true to handle variable arguments
                }
            }
        ];
    }

    /**
     * Register all custom functions with the database connection
     * 
     * @param db The better-sqlite3 database connection
     * @returns true if registration was successful, false otherwise
     */
    registerFunctions(db: Database): boolean {
        if (this.registered) {
            log.info("SQLite custom functions already registered");
            return true;
        }

        try {
            // Test if the database connection is valid first
            // This will throw if the database is closed
            db.pragma("user_version");
            
            log.info("Registering SQLite custom functions...");
            
            let successCount = 0;
            for (const func of this.functions) {
                try {
                    db.function(func.name, func.options || {}, func.implementation);
                    log.info(`Registered SQLite function: ${func.name}`);
                    successCount++;
                } catch (error) {
                    log.error(`Failed to register SQLite function ${func.name}: ${error}`);
                    // Continue registering other functions even if one fails
                }
            }

            // Only mark as registered if at least some functions were registered
            if (successCount > 0) {
                this.registered = true;
                log.info(`SQLite custom functions registration completed (${successCount}/${this.functions.length})`);
                return true;
            } else {
                log.error("No SQLite functions could be registered");
                return false;
            }

        } catch (error) {
            log.error(`Failed to register SQLite custom functions: ${error}`);
            return false;
        }
    }

    /**
     * Unregister all custom functions (for cleanup/testing)
     * Note: better-sqlite3 doesn't provide a way to unregister functions,
     * so this just resets the internal state
     */
    unregister(): void {
        this.registered = false;
    }

    /**
     * Check if functions are currently registered
     */
    isRegistered(): boolean {
        return this.registered;
    }

    // ===== Function Implementations =====

    /**
     * Calculate Levenshtein edit distance between two strings
     * Optimized with early termination and single-array approach
     * 
     * SQLite will pass 2 or 3 arguments:
     * - 2 args: str1, str2 (uses default maxDistance)
     * - 3 args: str1, str2, maxDistance
     * 
     * @returns Edit distance or maxDistance + 1 if exceeded
     */
    private editDistance(...args: any[]): number {
        // Handle variable arguments from SQLite
        let str1: string | null | undefined = args[0];
        let str2: string | null | undefined = args[1];
        let maxDistance: number = args.length > 2 ? args[2] : FUZZY_CONFIG.MAX_EDIT_DISTANCE;
        // Handle null/undefined inputs
        if (!str1 || typeof str1 !== 'string') str1 = '';
        if (!str2 || typeof str2 !== 'string') str2 = '';
        
        // Validate and sanitize maxDistance
        if (typeof maxDistance !== 'number' || !Number.isFinite(maxDistance)) {
            maxDistance = FUZZY_CONFIG.MAX_EDIT_DISTANCE;
        } else {
            // Ensure it's a positive integer
            maxDistance = Math.max(0, Math.floor(maxDistance));
        }

        const len1 = str1.length;
        const len2 = str2.length;

        // Performance guard for very long strings
        if (len1 > FUZZY_CONFIG.MAX_STRING_LENGTH || len2 > FUZZY_CONFIG.MAX_STRING_LENGTH) {
            return Math.abs(len1 - len2) <= maxDistance ? Math.abs(len1 - len2) : maxDistance + 1;
        }

        // Early termination: length difference exceeds max
        if (Math.abs(len1 - len2) > maxDistance) {
            return maxDistance + 1;
        }

        // Handle edge cases
        if (len1 === 0) return len2 <= maxDistance ? len2 : maxDistance + 1;
        if (len2 === 0) return len1 <= maxDistance ? len1 : maxDistance + 1;

        // Single-array optimization for memory efficiency
        let previousRow = Array.from({ length: len2 + 1 }, (_, i) => i);
        let currentRow = new Array(len2 + 1);

        for (let i = 1; i <= len1; i++) {
            currentRow[0] = i;
            let minInRow = i;

            for (let j = 1; j <= len2; j++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                currentRow[j] = Math.min(
                    previousRow[j] + 1,        // deletion
                    currentRow[j - 1] + 1,      // insertion
                    previousRow[j - 1] + cost  // substitution
                );
                
                if (currentRow[j] < minInRow) {
                    minInRow = currentRow[j];
                }
            }

            // Early termination: minimum distance in row exceeds threshold
            if (minInRow > maxDistance) {
                return maxDistance + 1;
            }

            // Swap arrays for next iteration
            [previousRow, currentRow] = [currentRow, previousRow];
        }

        const result = previousRow[len2];
        return result <= maxDistance ? result : maxDistance + 1;
    }

    /**
     * Test if a string matches a JavaScript regular expression
     * 
     * SQLite will pass 2 or 3 arguments:
     * - 2 args: text, pattern (uses default flags 'i')
     * - 3 args: text, pattern, flags
     * 
     * @returns 1 if match, 0 if no match, null on error
     */
    private regexMatch(...args: any[]): number | null {
        // Handle variable arguments from SQLite
        let text: string | null | undefined = args[0];
        let pattern: string | null | undefined = args[1];
        let flags: string = args.length > 2 ? args[2] : 'i';
        if (!text || !pattern) {
            return 0;
        }

        if (typeof text !== 'string' || typeof pattern !== 'string') {
            return null;
        }

        try {
            // Validate flags
            const validFlags = ['i', 'g', 'm', 's', 'u', 'y'];
            const flagsArray = (flags || '').split('');
            if (!flagsArray.every(f => validFlags.includes(f))) {
                flags = 'i'; // Fall back to case-insensitive
            }

            const regex = new RegExp(pattern, flags);
            return regex.test(text) ? 1 : 0;
        } catch (error) {
            // Invalid regex pattern
            log.error(`Invalid regex pattern in SQL: ${pattern} - ${error}`);
            return null;
        }
    }
}

// Export singleton instance getter
export function getSqliteFunctionsService(): SqliteFunctionsService {
    return SqliteFunctionsService.getInstance();
}

/**
 * Initialize SQLite custom functions with the given database connection
 * This should be called once during application startup after the database is opened
 * 
 * @param db The better-sqlite3 database connection
 * @returns true if successful, false otherwise
 */
export function initializeSqliteFunctions(db: Database): boolean {
    const service = getSqliteFunctionsService();
    return service.registerFunctions(db);
}