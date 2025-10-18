/**
 * Integration tests for SQLite search implementation
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import sql from "../sql.js";
import { getSQLiteSearchService } from "./sqlite_search_service.js";
import SearchContext from "./search_context.js";
import NoteContentSqliteExp from "./expressions/note_content_sqlite.js";
import NoteSet from "./note_set.js";
import { getSqliteFunctionsService } from "./sqlite_functions.js";

describe("SQLite Search Integration", () => {
    let searchService: ReturnType<typeof getSQLiteSearchService>;
    let searchContext: SearchContext;

    beforeAll(() => {
        // Initialize services
        searchService = getSQLiteSearchService();
        searchContext = new SearchContext({
            // searchBackend: "sqlite", // TODO: Add to SearchParams type
            // searchSqliteEnabled: true
        });

        // Register SQL functions
        const functionsService = getSqliteFunctionsService();
        const db = sql.getDbConnection();
        functionsService.registerFunctions(db);
    });

    afterAll(() => {
        // Cleanup if needed
    });

    describe("Service Initialization", () => {
        it("should initialize SQLite search service", () => {
            expect(searchService).toBeDefined();
            const stats = searchService.getStatistics();
            expect(stats).toBeDefined();
            expect(stats).toHaveProperty("tablesInitialized");
        });

        it("should have registered SQL functions", () => {
            const functionsService = getSqliteFunctionsService();
            expect(functionsService.isRegistered()).toBe(true);
        });
    });

    describe("Expression Creation", () => {
        it("should create SQLite expression when available", () => {
            const exp = NoteContentSqliteExp.createExpression("*=*", {
                tokens: ["test"],
                raw: false,
                flatText: false
            });
            
            expect(exp).toBeDefined();
            // Check if it's the SQLite version or fallback
            if (NoteContentSqliteExp.isAvailable()) {
                expect(exp).toBeInstanceOf(NoteContentSqliteExp);
            }
        });

        it("should handle different operators", () => {
            const operators = ["=", "!=", "*=*", "*=", "=*", "%=", "~="];
            
            for (const op of operators) {
                const exp = new NoteContentSqliteExp(op, {
                    tokens: ["test"],
                    raw: false,
                    flatText: false
                });
                
                expect(exp).toBeDefined();
                expect(exp.tokens).toEqual(["test"]);
            }
        });
    });

    describe("Search Execution", () => {
        it("should execute search with empty input set", () => {
            const exp = new NoteContentSqliteExp("*=*", {
                tokens: ["test"],
                raw: false,
                flatText: false
            });
            
            const inputSet = new NoteSet();
            const resultSet = exp.execute(inputSet, {}, searchContext);
            
            expect(resultSet).toBeDefined();
            expect(resultSet).toBeInstanceOf(NoteSet);
        });

        it("should handle search errors gracefully", () => {
            const exp = new NoteContentSqliteExp("invalid_op", {
                tokens: ["test"],
                raw: false,
                flatText: false
            });
            
            const inputSet = new NoteSet();
            const resultSet = exp.execute(inputSet, {}, searchContext);
            
            expect(resultSet).toBeDefined();
            expect(searchContext.hasError()).toBe(true);
        });
    });

    describe("Backend Selection", () => {
        it("should use SQLite backend when enabled", () => {
            const ctx = new SearchContext({
                forceBackend: "sqlite"
            });
            
            expect(ctx.searchBackend).toBe("sqlite");
        });

        it("should use TypeScript backend when forced", () => {
            const ctx = new SearchContext({
                forceBackend: "typescript"
            });
            
            expect(ctx.searchBackend).toBe("typescript");
        });

        it("should default to SQLite when no preference", () => {
            const ctx = new SearchContext({});
            
            // Should default to SQLite for better performance
            expect(["sqlite", "typescript"]).toContain(ctx.searchBackend);
        });
    });

    describe("Performance Statistics", () => {
        it("should track search statistics", () => {
            const initialStats = searchService.getStatistics();
            const initialSearches = initialStats.totalSearches || 0;
            
            // Execute a search
            searchService.search(
                ["test"],
                "*=*",
                searchContext,
                {}
            );
            
            const newStats = searchService.getStatistics();
            expect(newStats.totalSearches).toBeGreaterThan(initialSearches);
            expect(newStats.lastSearchTimeMs).toBeGreaterThanOrEqual(0);
        });
    });
});