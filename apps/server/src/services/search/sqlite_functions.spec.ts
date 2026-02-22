/**
 * Tests for SQLite custom functions service
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteFunctionsService, getSqliteFunctionsService } from './sqlite_functions.js';

describe('SqliteFunctionsService', () => {
    let db: Database.Database;
    let service: SqliteFunctionsService;

    beforeEach(() => {
        // Create in-memory database for testing
        db = new Database(':memory:');
        service = getSqliteFunctionsService();
        // Reset registration state
        service.unregister();
    });

    afterEach(() => {
        db.close();
    });

    describe('Service Registration', () => {
        it('should register functions successfully', () => {
            const result = service.registerFunctions(db);
            expect(result).toBe(true);
            expect(service.isRegistered()).toBe(true);
        });

        it('should not re-register if already registered', () => {
            service.registerFunctions(db);
            const result = service.registerFunctions(db);
            expect(result).toBe(true); // Still returns true but doesn't re-register
            expect(service.isRegistered()).toBe(true);
        });

        it('should handle registration errors gracefully', () => {
            // Close the database to cause registration to fail
            db.close();
            const result = service.registerFunctions(db);
            expect(result).toBe(false);
            expect(service.isRegistered()).toBe(false);
        });
    });

    describe('edit_distance function', () => {
        beforeEach(() => {
            service.registerFunctions(db);
        });

        it('should calculate edit distance correctly', () => {
            const tests = [
                ['hello', 'hello', 0],
                ['hello', 'hallo', 1],
                ['hello', 'help', 2],
                ['hello', 'world', 4],
                ['', '', 0],
                ['abc', '', 3],
                ['', 'abc', 3],
            ];

            for (const [str1, str2, expected] of tests) {
                const result = db.prepare('SELECT edit_distance(?, ?, 5) as distance').get(str1, str2) as any;
                expect(result.distance).toBe((expected as number) <= 5 ? (expected as number) : 6);
            }
        });

        it('should respect max distance threshold', () => {
            const result = db.prepare('SELECT edit_distance(?, ?, ?) as distance')
                .get('hello', 'world', 2) as any;
            expect(result.distance).toBe(3); // Returns maxDistance + 1 when exceeded
        });

        it('should handle null inputs', () => {
            const result = db.prepare('SELECT edit_distance(?, ?, 2) as distance').get(null, 'test') as any;
            expect(result.distance).toBe(3); // Treats null as empty string, distance exceeds max
        });
    });

    describe('regex_match function', () => {
        beforeEach(() => {
            service.registerFunctions(db);
        });

        it('should match regex patterns correctly', () => {
            const tests = [
                ['hello world', 'hello', 1],
                ['hello world', 'HELLO', 1], // Case insensitive by default
                ['hello world', '^hello', 1],
                ['hello world', 'world$', 1],
                ['hello world', 'foo', 0],
                ['test@example.com', '\\w+@\\w+\\.\\w+', 1],
            ];

            for (const [text, pattern, expected] of tests) {
                const result = db.prepare("SELECT regex_match(?, ?, 'i') as match").get(text, pattern) as any;
                expect(result.match).toBe(expected);
            }
        });

        it('should handle invalid regex gracefully', () => {
            const result = db.prepare("SELECT regex_match(?, ?, 'i') as match").get('test', '[invalid') as any;
            expect(result.match).toBe(null); // Returns null for invalid regex
        });

        it('should handle null inputs', () => {
            const result = db.prepare("SELECT regex_match(?, ?, 'i') as match").get(null, 'test') as any;
            expect(result.match).toBe(0);
        });
    });
});