/**
 * Tests for SQLite custom functions service
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteFunctionsService, getSqliteFunctionsService } from './sqlite_functions.js';
import { normalize, stripTags } from '../utils.js';

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

    describe('normalize_text function', () => {
        beforeEach(() => {
            service.registerFunctions(db);
        });

        it('should normalize text correctly', () => {
            const tests = [
                ['café', 'cafe'],
                ['naïve', 'naive'],
                ['HELLO WORLD', 'hello world'],
                ['Über', 'uber'],
                ['', ''],
                [null, ''],
            ];

            for (const [input, expected] of tests) {
                const result = db.prepare('SELECT normalize_text(?) as result').get(input) as { result: string };
                expect(result.result).toBe(expected);
                // Verify it matches the utils normalize function
                if (input) {
                    expect(result.result).toBe(normalize(input as string));
                }
            }
        });

        it('should handle special characters', () => {
            const input = 'Ñoño 123 ABC!@#';
            const result = db.prepare('SELECT normalize_text(?) as result').get(input) as any;
            expect(result.result).toBe(normalize(input));
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

    describe('tokenize_text function', () => {
        beforeEach(() => {
            service.registerFunctions(db);
        });

        it('should tokenize text correctly', () => {
            const tests = [
                ['hello world', ['hello', 'world']],
                ['getUserName', ['getusername', 'get', 'user', 'name']],
                ['user_name', ['user_name', 'user', 'name']],
                ['hello-world', ['hello', 'world']],
                ['test@example.com', ['test', 'example', 'com']],
                ['', []],
            ];

            for (const [input, expected] of tests) {
                const result = db.prepare('SELECT tokenize_text(?) as tokens').get(input) as any;
                const tokens = JSON.parse(result.tokens);
                // Check that all expected tokens are present (order may vary due to Set)
                for (const token of expected) {
                    expect(tokens).toContain(token);
                }
            }
        });

        it('should handle camelCase and snake_case', () => {
            const result = db.prepare('SELECT tokenize_text(?) as tokens').get('getUserById_async') as any;
            const tokens = JSON.parse(result.tokens);
            expect(tokens).toContain('getuserbyid_async');
            expect(tokens).toContain('getuserbyid');
            expect(tokens).toContain('async');
            expect(tokens).toContain('get');
            expect(tokens).toContain('user');
            expect(tokens).toContain('by');
            expect(tokens).toContain('id');
        });

        it('should handle null input', () => {
            const result = db.prepare('SELECT tokenize_text(?) as tokens').get(null) as any;
            expect(result.tokens).toBe('[]');
        });
    });

    describe('strip_html function', () => {
        beforeEach(() => {
            service.registerFunctions(db);
        });

        it('should strip HTML tags correctly', () => {
            const tests = [
                ['<p>Hello World</p>', 'Hello World'],
                ['<div><span>Test</span></div>', 'Test'],
                ['<script>alert("bad")</script>content', 'content'],
                ['<style>body{color:red}</style>text', 'text'],
                ['Hello &lt;world&gt;', 'Hello <world>'],
                ['&nbsp;&nbsp;Space', ' Space'],
                ['', ''],
            ];

            for (const [input, expected] of tests) {
                const result = db.prepare('SELECT strip_html(?) as text').get(input) as any;
                expect(result.text).toBe(expected);
            }
        });

        it('should handle complex HTML', () => {
            const html = `
                <html>
                    <head><title>Test</title></head>
                    <body>
                        <h1>Title</h1>
                        <p>Paragraph with <strong>bold</strong> text.</p>
                        <script>console.log("test")</script>
                    </body>
                </html>
            `;
            const result = db.prepare('SELECT strip_html(?) as text').get(html) as any;
            expect(result.text).toContain('Title');
            expect(result.text).toContain('Paragraph with bold text');
            expect(result.text).not.toContain('console.log');
        });

        it('should handle null input', () => {
            const result = db.prepare('SELECT strip_html(?) as text').get(null) as any;
            expect(result.text).toBe('');
        });
    });

    describe('fuzzy_match function', () => {
        beforeEach(() => {
            service.registerFunctions(db);
        });

        it('should perform exact matches', () => {
            const tests = [
                ['hello', 'hello world', 1],
                ['world', 'hello world', 1],
                ['foo', 'hello world', 0],
            ];

            for (const [needle, haystack, expected] of tests) {
                const result = db.prepare('SELECT fuzzy_match(?, ?, 2) as match').get(needle, haystack) as any;
                expect(result.match).toBe(expected);
            }
        });

        it('should perform fuzzy matches within edit distance', () => {
            const tests = [
                ['helo', 'hello world', 1],  // 1 edit distance
                ['wrld', 'hello world', 1],  // 1 edit distance
                ['hallo', 'hello world', 1], // 1 edit distance
                ['xyz', 'hello world', 0],   // Too different
            ];

            for (const [needle, haystack, expected] of tests) {
                const result = db.prepare('SELECT fuzzy_match(?, ?, 2) as match').get(needle, haystack) as any;
                expect(result.match).toBe(expected);
            }
        });

        it('should handle case insensitive matching', () => {
            const result = db.prepare('SELECT fuzzy_match(?, ?, 2) as match').get('HELLO', 'hello world') as any;
            expect(result.match).toBe(1);
        });

        it('should handle null inputs', () => {
            const result = db.prepare('SELECT fuzzy_match(?, ?, 2) as match').get(null, 'test') as any;
            expect(result.match).toBe(0);
        });
    });

    describe('Integration with SQL queries', () => {
        beforeEach(() => {
            service.registerFunctions(db);
            
            // Create a test table
            db.exec(`
                CREATE TABLE test_notes (
                    id INTEGER PRIMARY KEY,
                    title TEXT,
                    content TEXT
                )
            `);
            
            // Insert test data
            const insert = db.prepare('INSERT INTO test_notes (title, content) VALUES (?, ?)');
            insert.run('Café Meeting', '<p>Discussion about naïve implementation</p>');
            insert.run('über wichtig', 'Very important note with HTML &amp; entities');
            insert.run('getUserData', 'Function to get_user_data from database');
        });

        it('should work in WHERE clauses with normalize_text', () => {
            const results = db.prepare(`
                SELECT title FROM test_notes 
                WHERE normalize_text(title) LIKE '%cafe%'
            `).all();
            
            expect(results).toHaveLength(1);
            expect((results[0] as any).title).toBe('Café Meeting');
        });

        it('should work with fuzzy matching in queries', () => {
            const results = db.prepare(`
                SELECT title FROM test_notes 
                WHERE fuzzy_match('getuserdata', normalize_text(title), 2) = 1
            `).all();
            
            expect(results).toHaveLength(1);
            expect((results[0] as any).title).toBe('getUserData');
        });

        it('should work with HTML stripping', () => {
            const results = db.prepare(`
                SELECT strip_html(content) as clean_content 
                FROM test_notes 
                WHERE title = 'Café Meeting'
            `).all();
            
            expect((results[0] as any).clean_content).toBe('Discussion about naïve implementation');
        });

        it('should work with tokenization', () => {
            const result = db.prepare(`
                SELECT tokenize_text(title) as tokens 
                FROM test_notes 
                WHERE title = 'getUserData'
            `).get() as any;
            
            const tokens = JSON.parse(result.tokens);
            expect(tokens).toContain('get');
            expect(tokens).toContain('user');
            expect(tokens).toContain('data');
        });
    });
});