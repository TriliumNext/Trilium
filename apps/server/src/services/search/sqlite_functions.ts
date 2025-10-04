/**
 * SQLite Custom Functions Service
 * 
 * This service manages custom SQLite functions that enhance search capabilities.
 * Functions are registered with better-sqlite3 to provide native-speed operations
 * directly within SQL queries, enabling efficient search indexing and querying.
 * 
 * These functions are used by:
 * - Database triggers for automatic search index maintenance
 * - Direct SQL queries for search operations
 * - Migration scripts for initial data population
 */

import type { Database } from "better-sqlite3";
import log from "../log.js";
import { normalize as utilsNormalize, stripTags } from "../utils.js";

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
                name: "normalize_text",
                implementation: this.normalizeText.bind(this),
                options: {
                    deterministic: true,
                    varargs: false
                }
            },
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
            },
            {
                name: "tokenize_text",
                implementation: this.tokenizeText.bind(this),
                options: {
                    deterministic: true,
                    varargs: false
                }
            },
            {
                name: "strip_html",
                implementation: this.stripHtml.bind(this),
                options: {
                    deterministic: true,
                    varargs: false
                }
            },
            {
                name: "fuzzy_match",
                implementation: this.fuzzyMatch.bind(this),
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
     * Normalize text by removing diacritics and converting to lowercase
     * Matches the behavior of utils.normalize() exactly
     * 
     * @param text Text to normalize
     * @returns Normalized text
     */
    private normalizeText(text: string | null | undefined): string {
        if (!text || typeof text !== 'string') {
            return '';
        }
        
        // Use the exact same normalization as the rest of the codebase
        return utilsNormalize(text);
    }

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

    /**
     * Tokenize text into searchable words
     * Handles punctuation, camelCase, and snake_case
     * 
     * @param text Text to tokenize
     * @returns JSON array string of tokens
     */
    private tokenizeText(text: string | null | undefined): string {
        if (!text || typeof text !== 'string') {
            return '[]';
        }

        try {
            // Use a Set to avoid duplicates from the start
            const expandedTokens: Set<string> = new Set();
            
            // Split on word boundaries, preserving apostrophes within words
            // But we need to handle underscore separately for snake_case
            const tokens = text
                .split(/[\s\n\r\t,;.!?()[\]{}"'`~@#$%^&*+=|\\/<>:-]+/)
                .filter(token => token.length > 0);
            
            // Process each token
            for (const token of tokens) {
                // Add the original token in lowercase
                expandedTokens.add(token.toLowerCase());
                
                // Handle snake_case first (split on underscore)
                const snakeParts = token.split('_').filter(part => part.length > 0);
                if (snakeParts.length > 1) {
                    // We have snake_case
                    for (const snakePart of snakeParts) {
                        // Add each snake part
                        expandedTokens.add(snakePart.toLowerCase());
                        
                        // Also check for camelCase within each snake part
                        const camelParts = this.splitCamelCase(snakePart);
                        for (const camelPart of camelParts) {
                            if (camelPart.length > 0) {
                                expandedTokens.add(camelPart.toLowerCase());
                            }
                        }
                    }
                } else {
                    // No snake_case, just check for camelCase
                    const camelParts = this.splitCamelCase(token);
                    for (const camelPart of camelParts) {
                        if (camelPart.length > 0) {
                            expandedTokens.add(camelPart.toLowerCase());
                        }
                    }
                }
            }
            
            // Convert Set to Array for JSON serialization
            const uniqueTokens = Array.from(expandedTokens);
            
            // Return as JSON array string for SQL processing
            return JSON.stringify(uniqueTokens);
        } catch (error) {
            log.error(`Error tokenizing text in SQL: ${error}`);
            return '[]';
        }
    }
    
    /**
     * Helper method to split camelCase strings
     * @param str String to split
     * @returns Array of parts
     */
    private splitCamelCase(str: string): string[] {
        // Split on transitions from lowercase to uppercase
        // Also handle sequences of uppercase letters (e.g., "XMLParser" -> ["XML", "Parser"])
        return str.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
    }

    /**
     * Strip HTML tags from content
     * Removes script and style content, then strips tags and decodes entities
     * 
     * @param html HTML content
     * @returns Plain text without HTML tags
     */
    private stripHtml(html: string | null | undefined): string {
        if (!html || typeof html !== 'string') {
            return '';
        }

        try {
            let text = html;
            
            // First remove script and style content entirely (including the tags)
            // This needs to happen before stripTags to remove the content
            text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
            text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
            
            // Now use stripTags to remove remaining HTML tags
            text = stripTags(text);
            
            // Decode common HTML entities
            text = text.replace(/&lt;/g, '<');
            text = text.replace(/&gt;/g, '>');
            text = text.replace(/&amp;/g, '&');
            text = text.replace(/&quot;/g, '"');
            text = text.replace(/&#39;/g, "'");
            text = text.replace(/&apos;/g, "'");
            text = text.replace(/&nbsp;/g, ' ');
            
            // Normalize whitespace - reduce multiple spaces to single space
            // But don't trim leading/trailing space if it was from &nbsp;
            text = text.replace(/\s+/g, ' ');
            
            return text;
        } catch (error) {
            log.error(`Error stripping HTML in SQL: ${error}`);
            return html; // Return original on error
        }
    }

    /**
     * Fuzzy match with configurable edit distance
     * Combines exact and fuzzy matching for optimal performance
     * 
     * SQLite will pass 2 or 3 arguments:
     * - 2 args: needle, haystack (uses default maxDistance)
     * - 3 args: needle, haystack, maxDistance
     * 
     * @returns 1 if match found, 0 otherwise
     */
    private fuzzyMatch(...args: any[]): number {
        // Handle variable arguments from SQLite
        let needle: string | null | undefined = args[0];
        let haystack: string | null | undefined = args[1];
        let maxDistance: number = args.length > 2 ? args[2] : FUZZY_CONFIG.MAX_EDIT_DISTANCE;
        
        // Validate input types
        if (!needle || !haystack) {
            return 0;
        }

        if (typeof needle !== 'string' || typeof haystack !== 'string') {
            return 0;
        }
        
        // Validate and sanitize maxDistance
        if (typeof maxDistance !== 'number' || !Number.isFinite(maxDistance)) {
            maxDistance = FUZZY_CONFIG.MAX_EDIT_DISTANCE;
        } else {
            // Ensure it's a positive integer
            maxDistance = Math.max(0, Math.floor(maxDistance));
        }

        // Normalize for comparison
        const normalizedNeedle = needle.toLowerCase();
        const normalizedHaystack = haystack.toLowerCase();

        // Check exact match first (most common case)
        if (normalizedHaystack.includes(normalizedNeedle)) {
            return 1;
        }

        // For fuzzy matching, check individual words
        const words = normalizedHaystack.split(/\s+/).filter(w => w.length > 0);
        
        for (const word of words) {
            // Skip if word length difference is too large
            if (Math.abs(word.length - normalizedNeedle.length) > maxDistance) {
                continue;
            }

            // Check edit distance - call with all 3 args since we're calling internally
            const distance = this.editDistance(normalizedNeedle, word, maxDistance);
            if (distance <= maxDistance) {
                return 1;
            }
        }

        return 0;
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