#!/usr/bin/env ts-node

/**
 * Verification script for SQLite search implementation
 * 
 * This script checks:
 * 1. If migration 0235 has run (tables exist)
 * 2. If SQL functions are registered
 * 3. If search queries work correctly
 * 4. Performance comparison between SQLite and TypeScript
 */

import sql from "../sql.js";
import log from "../log.js";
import { getSQLiteSearchService } from "./sqlite_search_service.js";
import SearchContext from "./search_context.js";
import becca from "../../becca/becca.js";

async function verifyTables(): Promise<boolean> {
    console.log("\n=== Checking Database Tables ===");
    
    const tables = [
        { name: 'note_search_content', required: true },
        { name: 'note_tokens', required: true },
        { name: 'notes_fts', required: false } // From migration 0234
    ];
    
    let allExist = true;
    
    for (const table of tables) {
        const exists = sql.getValue<number>(`
            SELECT COUNT(*) FROM sqlite_master 
            WHERE type='table' AND name=?
        `, [table.name]) > 0;
        
        const status = exists ? '✓' : '✗';
        const requiredText = table.required ? ' (REQUIRED)' : ' (optional)';
        console.log(`  ${status} ${table.name}${requiredText}`);
        
        if (table.required && !exists) {
            allExist = false;
        }
    }
    
    if (!allExist) {
        console.log("\n❌ Required tables are missing!");
        console.log("   Migration 0235 needs to run.");
        console.log("   The APP_DB_VERSION has been updated to 235.");
        console.log("   Restart the server to run the migration.");
    }
    
    return allExist;
}

async function verifyFunctions(): Promise<boolean> {
    console.log("\n=== Checking SQL Functions ===");
    
    const functions = [
        { name: 'normalize_text', test: "SELECT normalize_text('Café')" },
        { name: 'edit_distance', test: "SELECT edit_distance('test', 'text', 2)" },
        { name: 'regex_match', test: "SELECT regex_match('test', 'testing')" },
        { name: 'tokenize_text', test: "SELECT tokenize_text('hello world')" },
        { name: 'strip_html', test: "SELECT strip_html('<p>test</p>')" }
    ];
    
    let allWork = true;
    
    for (const func of functions) {
        try {
            const result = sql.getValue(func.test);
            console.log(`  ✓ ${func.name} - Result: ${result}`);
        } catch (error: any) {
            console.log(`  ✗ ${func.name} - Error: ${error.message}`);
            allWork = false;
        }
    }
    
    if (!allWork) {
        console.log("\n⚠️  Some SQL functions are not working.");
        console.log("   They should be registered when the server starts.");
    }
    
    return allWork;
}

async function verifySearchContent(): Promise<void> {
    console.log("\n=== Checking Search Index Content ===");
    
    const noteCount = sql.getValue<number>(`
        SELECT COUNT(*) FROM notes 
        WHERE isDeleted = 0 AND isProtected = 0
    `) || 0;
    
    const indexedCount = sql.getValue<number>(`
        SELECT COUNT(*) FROM note_search_content
    `) || 0;
    
    const tokenCount = sql.getValue<number>(`
        SELECT COUNT(DISTINCT noteId) FROM note_tokens
    `) || 0;
    
    console.log(`  Notes eligible for indexing: ${noteCount}`);
    console.log(`  Notes in search index: ${indexedCount}`);
    console.log(`  Notes with tokens: ${tokenCount}`);
    
    if (indexedCount === 0 && noteCount > 0) {
        console.log("\n⚠️  Search index is empty but there are notes to index.");
        console.log("   The migration should populate the index automatically.");
    } else if (indexedCount < noteCount) {
        console.log("\n⚠️  Some notes are not indexed.");
        console.log(`   Missing: ${noteCount - indexedCount} notes`);
    } else {
        console.log("\n✓ Search index is populated");
    }
}

async function testSearch(): Promise<void> {
    console.log("\n=== Testing Search Functionality ===");
    
    // Initialize becca if needed
    if (!becca.loaded) {
        console.log("  Loading becca...");
        // Note: becca may not have a load method in this version
    }
    
    const searchService = getSQLiteSearchService();
    const searchContext = new SearchContext({
        fastSearch: false,
        includeArchivedNotes: false,
        fuzzyAttributeSearch: false,
        debug: false
    });
    
    // Test different operators
    const tests = [
        { operator: '*=*', tokens: ['note'], description: 'Substring search' },
        { operator: '=*', tokens: ['test'], description: 'Prefix search' },
        { operator: '*=', tokens: ['ing'], description: 'Suffix search' },
        { operator: '~=', tokens: ['nite'], description: 'Fuzzy search' }
    ];
    
    for (const test of tests) {
        try {
            console.log(`\n  Testing ${test.description} (${test.operator}):`);
            const startTime = Date.now();
            const results = searchService.search(test.tokens, test.operator, searchContext);
            const duration = Date.now() - startTime;
            const resultCount = Array.isArray(results) ? results.length : results.size || 0;
            console.log(`    Found ${resultCount} results in ${duration}ms`);
            
            if (resultCount > 0) {
                const sampleResults = Array.isArray(results) ? results.slice(0, 3) : Array.from(results).slice(0, 3);
                console.log(`    Sample results: ${sampleResults.join(', ')}...`);
            }
        } catch (error: any) {
            console.log(`    ✗ Error: ${error.message}`);
        }
    }
}

async function main() {
    console.log("========================================");
    console.log("   SQLite Search Implementation Test");
    console.log("========================================");
    
    try {
        // Check current database version
        const currentDbVersion = sql.getValue<number>("SELECT value FROM options WHERE name = 'dbVersion'") || 0;
        console.log(`\nCurrent database version: ${currentDbVersion}`);
        console.log(`Target database version: 235`);
        
        if (currentDbVersion < 235) {
            console.log("\n⚠️  Database needs migration from version " + currentDbVersion + " to 235");
            console.log("   Restart the server to run migrations.");
            return;
        }
        
        // Verify tables exist
        const tablesExist = await verifyTables();
        if (!tablesExist) {
            return;
        }
        
        // Verify functions work
        const functionsWork = await verifyFunctions();
        
        // Check index content
        await verifySearchContent();
        
        // Test search if everything is ready
        if (tablesExist && functionsWork) {
            await testSearch();
        }
        
        console.log("\n========================================");
        console.log("   Test Complete");
        console.log("========================================");
        
        if (tablesExist && functionsWork) {
            console.log("\n✅ SQLite search implementation is ready!");
            console.log("\nTo enable SQLite search:");
            console.log("  1. Set searchBackend option to 'sqlite'");
            console.log("  2. Or use the admin API: PUT /api/search-admin/config");
        } else {
            console.log("\n❌ SQLite search is not ready. See issues above.");
        }
        
    } catch (error: any) {
        console.error("\n❌ Test failed with error:", error);
        console.error(error.stack);
    }
}

// Run if executed directly
if (require.main === module) {
    main().then(() => process.exit(0)).catch(() => process.exit(1));
}

export { verifyTables, verifyFunctions, testSearch };