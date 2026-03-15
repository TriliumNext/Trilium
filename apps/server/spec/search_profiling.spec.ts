/**
 * Integration-level search profiling test.
 *
 * Uses the real SQLite database (spec/db/document.db loaded in-memory),
 * real sql module, real becca cache, and the full app stack.
 *
 * Profiles search at large scale (50K+ notes) to match real-world
 * performance reports from users with 240K+ notes.
 */
import { Application } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import config from "../src/services/config.js";

let app: Application;

function timed<T>(fn: () => T): [T, number] {
    const start = performance.now();
    const result = fn();
    return [result, performance.now() - start];
}

function randomId(len = 12): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let id = "";
    for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}

function randomWord(len = 8): string {
    const chars = "abcdefghijklmnopqrstuvwxyz";
    let w = "";
    for (let i = 0; i < len; i++) w += chars[Math.floor(Math.random() * chars.length)];
    return w;
}

function generateContent(wordCount: number, keyword?: string): string {
    const paragraphs: string[] = [];
    let remaining = wordCount;
    let injected = false;
    while (remaining > 0) {
        const n = Math.min(remaining, 30 + Math.floor(Math.random() * 30));
        const words: string[] = [];
        for (let i = 0; i < n; i++) words.push(randomWord(3 + Math.floor(Math.random() * 10)));
        if (keyword && !injected && remaining < wordCount / 2) {
            words[Math.floor(words.length / 2)] = keyword;
            injected = true;
        }
        paragraphs.push(`<p>${words.join(" ")}</p>`);
        remaining -= n;
    }
    return paragraphs.join("\n");
}

describe("Search profiling (integration)", () => {
    beforeAll(async () => {
        config.General.noAuthentication = true;
        const buildApp = (await import("../src/app.js")).default;
        app = await buildApp();
    });

    it("large-scale profiling (50K notes)", async () => {
        const sql = (await import("../src/services/sql.js")).default;
        const becca = (await import("../src/becca/becca.js")).default;
        const beccaLoader = (await import("../src/becca/becca_loader.js")).default;
        const cls = (await import("../src/services/cls.js")).default;
        const searchService = (await import("../src/services/search/services/search.js")).default;
        const SearchContext = (await import("../src/services/search/search_context.js")).default;
        const beccaService = (await import("../src/becca/becca_service.js")).default;

        await new Promise<void>((resolve) => {
            cls.init(() => {
                const initialNoteCount = Object.keys(becca.notes).length;
                console.log(`\n  Initial becca notes: ${initialNoteCount}`);

                // ── Seed 50K notes with hierarchy ──
                // Some folders (depth), some with common keyword "test" in title
                const TOTAL_NOTES = 50000;
                const FOLDER_COUNT = 500;  // 500 folders
                const NOTES_PER_FOLDER = (TOTAL_NOTES - FOLDER_COUNT) / FOLDER_COUNT; // ~99 notes per folder
                const MATCH_FRACTION = 0.10; // 10% match "test" — ~5000 notes
                const CONTENT_WORDS = 500;

                const now = new Date().toISOString().replace("T", " ").replace("Z", "+0000");
                console.log(`  Seeding ${TOTAL_NOTES} notes (${FOLDER_COUNT} folders, ~${NOTES_PER_FOLDER.toFixed(0)} per folder)...`);

                const [, seedMs] = timed(() => {
                    sql.transactional(() => {
                        const folderIds: string[] = [];

                        // Create folders under root
                        for (let f = 0; f < FOLDER_COUNT; f++) {
                            const noteId = `seed${randomId(8)}`;
                            const branchId = `seed${randomId(8)}`;
                            const blobId = `seed${randomId(16)}`;
                            folderIds.push(noteId);

                            sql.execute(
                                `INSERT INTO blobs (blobId, content, dateModified, utcDateModified) VALUES (?, ?, ?, ?)`,
                                [blobId, `<p>Folder ${f}</p>`, now, now]
                            );
                            sql.execute(
                                `INSERT INTO notes (noteId, title, type, mime, blobId, isProtected, isDeleted,
                                    dateCreated, dateModified, utcDateCreated, utcDateModified)
                                 VALUES (?, ?, 'text', 'text/html', ?, 0, 0, ?, ?, ?, ?)`,
                                [noteId, `Folder ${f} ${randomWord(5)}`, blobId, now, now, now, now]
                            );
                            sql.execute(
                                `INSERT INTO branches (branchId, noteId, parentNoteId, notePosition, isDeleted, isExpanded, utcDateModified)
                                 VALUES (?, ?, 'root', ?, 0, 0, ?)`,
                                [branchId, noteId, f * 10, now]
                            );
                        }

                        // Create notes under folders
                        let noteIdx = 0;
                        for (let f = 0; f < FOLDER_COUNT; f++) {
                            const parentId = folderIds[f];
                            for (let n = 0; n < NOTES_PER_FOLDER; n++) {
                                const isMatch = noteIdx < TOTAL_NOTES * MATCH_FRACTION;
                                const noteId = `seed${randomId(8)}`;
                                const branchId = `seed${randomId(8)}`;
                                const blobId = `seed${randomId(16)}`;
                                const title = isMatch
                                    ? `Test Document ${noteIdx} ${randomWord(6)}`
                                    : `Note ${noteIdx} ${randomWord(6)} ${randomWord(5)}`;
                                const content = generateContent(CONTENT_WORDS, isMatch ? "test" : undefined);

                                sql.execute(
                                    `INSERT INTO blobs (blobId, content, dateModified, utcDateModified) VALUES (?, ?, ?, ?)`,
                                    [blobId, content, now, now]
                                );
                                sql.execute(
                                    `INSERT INTO notes (noteId, title, type, mime, blobId, isProtected, isDeleted,
                                        dateCreated, dateModified, utcDateCreated, utcDateModified)
                                     VALUES (?, ?, 'text', 'text/html', ?, 0, 0, ?, ?, ?, ?)`,
                                    [noteId, title, blobId, now, now, now, now]
                                );
                                sql.execute(
                                    `INSERT INTO branches (branchId, noteId, parentNoteId, notePosition, isDeleted, isExpanded, utcDateModified)
                                     VALUES (?, ?, ?, ?, 0, 0, ?)`,
                                    [branchId, noteId, parentId, n * 10, now]
                                );
                                noteIdx++;
                            }
                        }
                    });
                });
                console.log(`  SQL seeding: ${seedMs.toFixed(0)}ms`);

                const [, reloadMs] = timed(() => beccaLoader.load());
                const totalNotes = Object.keys(becca.notes).length;
                console.log(`  Becca reload: ${reloadMs.toFixed(0)}ms  Total notes: ${totalNotes}`);

                // ── Warm caches ──
                searchService.searchNotesForAutocomplete("test", true);

                // ════════════════════════════════════════════
                // PROFILING AT SCALE
                // ════════════════════════════════════════════

                console.log(`\n  ════ PROFILING (${totalNotes} notes) ════\n`);

                // 1. getCandidateNotes cost (the full-scan bottleneck)
                const allNotes = Object.values(becca.notes);
                const [, flatScanMs] = timed(() => {
                    let count = 0;
                    for (const note of allNotes) {
                        const ft = note.getFlatText();
                        if (ft.includes("test")) count++;
                    }
                    return count;
                });
                console.log(`  getFlatText + includes scan (${allNotes.length} notes): ${flatScanMs.toFixed(1)}ms`);

                // 2. Full findResultsWithQuery (includes candidate scan + parent walk + scoring)
                const findTimes: number[] = [];
                let findResultCount = 0;
                for (let i = 0; i < 3; i++) {
                    const [r, ms] = timed(() =>
                        searchService.findResultsWithQuery("test", new SearchContext({ fastSearch: true }))
                    );
                    findTimes.push(ms);
                    findResultCount = r.length;
                }
                const findAvg = findTimes.reduce((a, b) => a + b, 0) / findTimes.length;
                console.log(`  findResultsWithQuery (fast):     avg ${findAvg.toFixed(1)}ms  (${findResultCount} results)`);

                // 3. Exact-only (no fuzzy)
                const exactTimes: number[] = [];
                for (let i = 0; i < 3; i++) {
                    const [, ms] = timed(() =>
                        searchService.findResultsWithQuery("test", new SearchContext({ fastSearch: true, enableFuzzyMatching: false }))
                    );
                    exactTimes.push(ms);
                }
                const exactAvg = exactTimes.reduce((a, b) => a + b, 0) / exactTimes.length;
                console.log(`  findResultsWithQuery (exact):    avg ${exactAvg.toFixed(1)}ms`);
                console.log(`  Fuzzy overhead:                  ${(findAvg - exactAvg).toFixed(1)}ms`);

                // 4. SearchResult construction + computeScore cost (isolated)
                const results = searchService.findResultsWithQuery("test", new SearchContext({ fastSearch: true }));
                console.log(`  Total results before trim: ${results.length}`);

                const [, scoreAllMs] = timed(() => {
                    for (const r of results) r.computeScore("test", ["test"], true);
                });
                console.log(`  computeScore × ${results.length}:            ${scoreAllMs.toFixed(1)}ms  (${(scoreAllMs / results.length).toFixed(3)}ms/result)`);

                // 5. getNoteTitleForPath for all results
                const [, pathTitleMs] = timed(() => {
                    for (const r of results) beccaService.getNoteTitleForPath(r.notePathArray);
                });
                console.log(`  getNoteTitleForPath × ${results.length}:     ${pathTitleMs.toFixed(1)}ms`);

                // 6. Content snippet extraction (only 200)
                const trimmed = results.slice(0, 200);
                const [, snippetMs] = timed(() => {
                    for (const r of trimmed) {
                        r.contentSnippet = searchService.extractContentSnippet(r.noteId, ["test"]);
                    }
                });
                console.log(`  extractContentSnippet × 200:     ${snippetMs.toFixed(1)}ms`);

                // 7. Highlighting (only 200)
                const [, hlMs] = timed(() => {
                    searchService.highlightSearchResults(trimmed, ["test"]);
                });
                console.log(`  highlightSearchResults × 200:    ${hlMs.toFixed(1)}ms`);

                // 7b. getBestNotePath cost (used by fast path)
                const sampleNotes = Object.values(becca.notes).filter(n => n.title.startsWith("Test Document")).slice(0, 1000);
                const [, bestPathMs] = timed(() => {
                    for (const n of sampleNotes) n.getBestNotePath();
                });
                console.log(`  getBestNotePath × ${sampleNotes.length}:          ${bestPathMs.toFixed(1)}ms  (${(bestPathMs/sampleNotes.length).toFixed(3)}ms/note)`);

                // 8. Full autocomplete end-to-end
                const autoTimes: number[] = [];
                let autoCount = 0;
                for (let i = 0; i < 3; i++) {
                    const [r, ms] = timed(() =>
                        searchService.searchNotesForAutocomplete("test", true)
                    );
                    autoTimes.push(ms);
                    autoCount = r.length;
                }
                const autoAvg = autoTimes.reduce((a, b) => a + b, 0) / autoTimes.length;
                const autoMin = Math.min(...autoTimes);
                console.log(`\n  ★ FULL AUTOCOMPLETE:             avg ${autoAvg.toFixed(1)}ms  min ${autoMin.toFixed(1)}ms  (${autoCount} results)`);

                // 9. With a less common search term (fewer matches)
                const rareTimes: number[] = [];
                let rareCount = 0;
                for (let i = 0; i < 3; i++) {
                    const [r, ms] = timed(() =>
                        searchService.searchNotesForAutocomplete("leitfaden", true)
                    );
                    rareTimes.push(ms);
                    rareCount = r.length;
                }
                const rareAvg = rareTimes.reduce((a, b) => a + b, 0) / rareTimes.length;
                console.log(`  Autocomplete "leitfaden":        avg ${rareAvg.toFixed(1)}ms  (${rareCount} results)`);

                // 10. Full search (fastSearch=false) — the 2.7s bottleneck
                console.log(`\n  ── Full search (fastSearch=false) ──`);
                const fullTimes: number[] = [];
                let fullCount = 0;
                for (let i = 0; i < 2; i++) {
                    const [r, ms] = timed(() =>
                        searchService.findResultsWithQuery("test", new SearchContext({ fastSearch: false }))
                    );
                    fullTimes.push(ms);
                    fullCount = r.length;
                }
                const fullAvg = fullTimes.reduce((a, b) => a + b, 0) / fullTimes.length;
                console.log(`  Full search (flat + SQL):         avg ${fullAvg.toFixed(1)}ms  (${fullCount} results)`);

                // 11. SQL content scan alone
                const [scanCount, scanMs] = timed(() => {
                    let count = 0;
                    for (const row of sql.iterateRows<{ content: Buffer | string }>(`
                        SELECT noteId, type, mime, content, isProtected
                        FROM notes JOIN blobs USING (blobId)
                        WHERE type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap')
                          AND isDeleted = 0
                          AND LENGTH(content) < 2097152`)) {
                        count++;
                    }
                    return count;
                });
                console.log(`  Raw SQL scan (${scanCount} rows):      ${scanMs.toFixed(1)}ms`);

                // ── Summary ──
                console.log(`\n  ════ SUMMARY ════`);
                console.log(`  Notes: ${totalNotes}  |  Matches: ${findResultCount}  |  Hierarchy depth: 3 (root → folder → note)`);
                console.log(`  ──────────────────────────────────`);
                console.log(`  Autocomplete (fast):   ${autoAvg.toFixed(1)}ms`);
                console.log(`    findResults:           ${findAvg.toFixed(1)}ms (${((findAvg/autoAvg)*100).toFixed(0)}%)`);
                console.log(`    snippets+highlight:    ${(snippetMs + hlMs).toFixed(1)}ms (${(((snippetMs+hlMs)/autoAvg)*100).toFixed(0)}%)`);
                console.log(`  Full search:           ${fullAvg.toFixed(1)}ms`);

                resolve();
            });
        });
    }, 600_000);
});
