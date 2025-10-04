/**
 * Tests for SQLite Search Service
 * 
 * These tests verify that the SQLite-based search implementation
 * correctly handles all search operators and provides accurate results.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { SQLiteSearchService } from "./sqlite_search_service.js";
import sql from "../sql.js";
import SearchContext from "./search_context.js";
import { initializeSqliteFunctions } from "./sqlite_functions.js";

describe("SQLiteSearchService", () => {
    let searchService: SQLiteSearchService;
    let searchContext: SearchContext;

    beforeAll(() => {
        // Initialize SQLite functions for tests
        const db = sql.getDbConnection();
        if (db) {
            initializeSqliteFunctions(db);
        }

        // Get search service instance
        searchService = SQLiteSearchService.getInstance();
        
        // Create test tables if they don't exist
        sql.execute(`
            CREATE TABLE IF NOT EXISTS note_search_content (
                noteId TEXT PRIMARY KEY,
                noteContent TEXT,
                normalized_content TEXT,
                normalized_title TEXT,
                isProtected INTEGER DEFAULT 0,
                isDeleted INTEGER DEFAULT 0
            )
        `);

        sql.execute(`
            CREATE TABLE IF NOT EXISTS note_tokens (
                noteId TEXT PRIMARY KEY,
                tokens TEXT
            )
        `);

        sql.execute(`
            CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
                noteId UNINDEXED,
                title,
                content,
                tokenize = 'unicode61'
            )
        `);
    });

    beforeEach(() => {
        // Clear test data
        sql.execute(`DELETE FROM note_search_content`);
        sql.execute(`DELETE FROM note_tokens`);
        sql.execute(`DELETE FROM note_fts`);

        // Create fresh search context
        searchContext = new SearchContext();

        // Insert test data
        insertTestNote("note1", "Hello World", "This is a test note with hello world content.");
        insertTestNote("note2", "Programming", "JavaScript and TypeScript programming languages.");
        insertTestNote("note3", "Fuzzy Search", "Testing fuzzy matching with similar words like helo and wrold.");
        insertTestNote("note4", "Special Characters", "Testing with special@email.com and user_name variables.");
        insertTestNote("note5", "CamelCase", "getUserName and setUserEmail functions in JavaScript.");
    });

    function insertTestNote(noteId: string, title: string, content: string) {
        // Insert into search content table
        sql.execute(`
            INSERT INTO note_search_content (noteId, noteContent, normalized_content, normalized_title, isProtected, isDeleted)
            VALUES (?, ?, LOWER(?), LOWER(?), 0, 0)
        `, [noteId, content, content, title]);

        // Generate tokens
        const tokens = tokenize(content + " " + title);
        sql.execute(`
            INSERT INTO note_tokens (noteId, tokens)
            VALUES (?, ?)
        `, [noteId, JSON.stringify(tokens)]);

        // Insert into FTS5 table
        sql.execute(`
            INSERT INTO note_fts (noteId, title, content)
            VALUES (?, ?, ?)
        `, [noteId, title, content]);
    }

    function tokenize(text: string): string[] {
        return text.toLowerCase()
            .split(/[\s\n\r\t,;.!?()[\]{}"'`~@#$%^&*+=|\\/<>:_-]+/)
            .filter(token => token.length > 0);
    }

    describe("Substring Search (*=*)", () => {
        it("should find notes containing substring", () => {
            const results = searchService.search(["hello"], "*=*", searchContext);
            expect(results).toContain("note1");
            expect(results.size).toBe(1);
        });

        it("should find notes with multiple tokens", () => {
            const results = searchService.search(["java", "script"], "*=*", searchContext);
            expect(results).toContain("note2");
            expect(results).toContain("note5");
            expect(results.size).toBe(2);
        });

        it("should be case insensitive", () => {
            const results = searchService.search(["HELLO"], "*=*", searchContext);
            expect(results).toContain("note1");
        });
    });

    describe("Fuzzy Search (~=)", () => {
        it("should find notes with fuzzy matching", () => {
            const results = searchService.search(["helo"], "~=", searchContext);
            expect(results).toContain("note3"); // Contains "helo"
            expect(results).toContain("note1"); // Contains "hello" (1 edit distance)
        });

        it("should respect edit distance threshold", () => {
            const results = searchService.search(["xyz"], "~=", searchContext);
            expect(results.size).toBe(0); // Too different from any content
        });

        it("should handle multiple fuzzy tokens", () => {
            const results = searchService.search(["fuzzy", "match"], "~=", searchContext);
            expect(results).toContain("note3");
        });
    });

    describe("Prefix Search (=*)", () => {
        it("should find notes starting with prefix", () => {
            const results = searchService.search(["test"], "=*", searchContext);
            expect(results).toContain("note3"); // "Testing fuzzy..."
            expect(results).toContain("note4"); // "Testing with..."
            expect(results.size).toBe(2);
        });

        it("should handle multiple prefixes", () => {
            const results = searchService.search(["java", "type"], "=*", searchContext);
            expect(results).toContain("note2"); // Has both "JavaScript" and "TypeScript"
        });
    });

    describe("Suffix Search (*=)", () => {
        it("should find notes ending with suffix", () => {
            const results = searchService.search(["script"], "*=", searchContext);
            expect(results).toContain("note2"); // "JavaScript" and "TypeScript"
            expect(results).toContain("note5"); // "JavaScript"
        });

        it("should handle special suffixes", () => {
            const results = searchService.search([".com"], "*=", searchContext);
            expect(results).toContain("note4"); // "special@email.com"
        });
    });

    describe("Regex Search (%=)", () => {
        it("should find notes matching regex pattern", () => {
            const results = searchService.search(["\\w+@\\w+\\.com"], "%=", searchContext);
            expect(results).toContain("note4"); // Contains email pattern
        });

        it("should handle complex patterns", () => {
            const results = searchService.search(["get\\w+Name"], "%=", searchContext);
            expect(results).toContain("note5"); // "getUserName"
        });

        it("should handle invalid regex gracefully", () => {
            const results = searchService.search(["[invalid"], "%=", searchContext);
            expect(results.size).toBe(0); // Should return empty on invalid regex
        });
    });

    describe("Exact Word Search (=)", () => {
        it("should find notes with exact word match", () => {
            const results = searchService.search(["hello"], "=", searchContext);
            expect(results).toContain("note1");
            expect(results.size).toBe(1);
        });

        it("should not match partial words", () => {
            const results = searchService.search(["java"], "=", searchContext);
            expect(results.size).toBe(0); // "JavaScript" contains "java" but not as whole word
        });

        it("should find multiple exact words", () => {
            const results = searchService.search(["fuzzy", "matching"], "=", searchContext);
            expect(results).toContain("note3");
        });
    });

    describe("Not Equals Search (!=)", () => {
        it("should find notes not containing exact word", () => {
            const results = searchService.search(["hello"], "!=", searchContext);
            expect(results).not.toContain("note1");
            expect(results.size).toBe(4); // All except note1
        });

        it("should handle multiple tokens", () => {
            const results = searchService.search(["fuzzy", "matching"], "!=", searchContext);
            expect(results).not.toContain("note3");
            expect(results.size).toBe(4); // All except note3
        });
    });

    describe("Search Options", () => {
        it("should respect limit option", () => {
            const results = searchService.search(["test"], "*=*", searchContext, { limit: 1 });
            expect(results.size).toBeLessThanOrEqual(1);
        });

        it("should filter by noteId set", () => {
            const noteIdFilter = new Set(["note1", "note3"]);
            const results = searchService.search(["test"], "*=*", searchContext, { noteIdFilter });
            
            for (const noteId of results) {
                expect(noteIdFilter).toContain(noteId);
            }
        });

        it("should exclude deleted notes by default", () => {
            // Mark note1 as deleted
            sql.execute(`UPDATE note_search_content SET isDeleted = 1 WHERE noteId = 'note1'`);
            
            const results = searchService.search(["hello"], "*=*", searchContext);
            expect(results).not.toContain("note1");
        });

        it("should include deleted notes when specified", () => {
            // Mark note1 as deleted
            sql.execute(`UPDATE note_search_content SET isDeleted = 1 WHERE noteId = 'note1'`);
            
            const results = searchService.search(["hello"], "*=*", searchContext, { includeDeleted: true });
            expect(results).toContain("note1");
        });
    });

    describe("Complex Queries", () => {
        it("should combine multiple searches with AND", () => {
            const queries = [
                { tokens: ["java"], operator: "*=*" },
                { tokens: ["script"], operator: "*=*" }
            ];
            
            const results = searchService.searchMultiple(queries, "AND", searchContext);
            expect(results).toContain("note2");
            expect(results).toContain("note5");
        });

        it("should combine multiple searches with OR", () => {
            const queries = [
                { tokens: ["hello"], operator: "*=*" },
                { tokens: ["fuzzy"], operator: "*=*" }
            ];
            
            const results = searchService.searchMultiple(queries, "OR", searchContext);
            expect(results).toContain("note1");
            expect(results).toContain("note3");
            expect(results.size).toBe(2);
        });
    });

    describe("Performance", () => {
        beforeEach(() => {
            // Add more test data for performance testing
            for (let i = 10; i < 1000; i++) {
                insertTestNote(
                    `note${i}`,
                    `Title ${i}`,
                    `This is note number ${i} with some random content for testing performance.`
                );
            }
        });

        it("should handle large result sets efficiently", () => {
            const startTime = Date.now();
            const results = searchService.search(["note"], "*=*", searchContext);
            const elapsed = Date.now() - startTime;
            
            expect(results.size).toBeGreaterThan(100);
            expect(elapsed).toBeLessThan(1000); // Should complete within 1 second
        });

        it("should use limit to restrict results", () => {
            const startTime = Date.now();
            const results = searchService.search(["note"], "*=*", searchContext, { limit: 10 });
            const elapsed = Date.now() - startTime;
            
            expect(results.size).toBeLessThanOrEqual(10);
            expect(elapsed).toBeLessThan(100); // Should be very fast with limit
        });
    });

    describe("Statistics", () => {
        it("should return correct statistics", () => {
            const stats = searchService.getStatistics();
            
            expect(stats.tablesInitialized).toBe(true);
            expect(stats.indexedNotes).toBe(5);
            expect(stats.totalTokens).toBe(5);
            expect(stats.fts5Available).toBe(true);
        });
    });

    afterAll(() => {
        // Clean up test data
        sql.execute(`DELETE FROM note_search_content`);
        sql.execute(`DELETE FROM note_tokens`);
        sql.execute(`DELETE FROM note_fts`);
    });
});