/**
 * Comprehensive search benchmark suite.
 *
 * Covers many scenarios:
 * - Single-token, multi-token, phrase-like queries
 * - Fuzzy matching enabled vs disabled
 * - Autocomplete vs full search
 * - Diacritics / unicode queries
 * - No-match queries
 * - Varying note counts (1K, 5K, 10K, 20K)
 * - Warm cache vs cold cache
 *
 * All times are in-memory (monkeypatched getContent, no real SQL).
 */
import { describe, it, expect, afterEach } from "vitest";
import searchService from "./search.js";
import BNote from "../../../becca/entities/bnote.js";
import BBranch from "../../../becca/entities/bbranch.js";
import SearchContext from "../search_context.js";
import becca from "../../../becca/becca.js";
import { NoteBuilder, note } from "../../../test/becca_mocking.js";

// ── helpers ──────────────────────────────────────────────────────────

function randomWord(len = 6): string {
    const chars = "abcdefghijklmnopqrstuvwxyz";
    let word = "";
    for (let i = 0; i < len; i++) {
        word += chars[Math.floor(Math.random() * chars.length)];
    }
    return word;
}

function generateHtmlContent(wordCount: number, includeKeywords = false, keywords?: string[]): string {
    const paragraphs: string[] = [];
    let wordsRemaining = wordCount;
    const kws = keywords ?? [];

    while (wordsRemaining > 0) {
        const paraWords = Math.min(wordsRemaining, 20 + Math.floor(Math.random() * 40));
        const words: string[] = [];
        for (let i = 0; i < paraWords; i++) {
            words.push(randomWord(3 + Math.floor(Math.random() * 10)));
        }
        if (includeKeywords && paragraphs.length === 2) {
            for (let k = 0; k < kws.length; k++) {
                const pos = Math.min(words.length - 1, Math.floor((words.length / (kws.length + 1)) * (k + 1)));
                words[pos] = kws[k];
            }
        }
        paragraphs.push(`<p>${words.join(" ")}</p>`);
        wordsRemaining -= paraWords;
    }

    return `<html><body>${paragraphs.join("\n")}</body></html>`;
}

function timed<T>(fn: () => T): [T, number] {
    const start = performance.now();
    const result = fn();
    return [result, performance.now() - start];
}

function avg(nums: number[]): number {
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function min(nums: number[]): number {
    return Math.min(...nums);
}

// ── dataset builder ──────────────────────────────────────────────────

const syntheticContent: Record<string, string> = {};

function buildDataset(noteCount: number, opts: {
    matchFraction?: number;
    labelsPerNote?: number;
    depth?: number;
    contentWordCount?: number;
    varyContentSize?: boolean;
    titleKeywords?: string[];
    contentKeywords?: string[];
    /** Include notes with diacritics in titles */
    includeDiacritics?: boolean;
} = {}) {
    const {
        matchFraction = 0.1,
        labelsPerNote = 3,
        depth = 4,
        contentWordCount = 300,
        varyContentSize = true,
        titleKeywords = ["target"],
        contentKeywords = titleKeywords,
        includeDiacritics = false,
    } = opts;

    becca.reset();
    for (const key of Object.keys(syntheticContent)) {
        delete syntheticContent[key];
    }

    const rootNote = new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
    new BBranch({
        branchId: "none_root",
        noteId: "root",
        parentNoteId: "none",
        notePosition: 10
    });

    const containers: NoteBuilder[] = [];
    let parent = rootNote;
    for (let d = 0; d < depth; d++) {
        const container = note(`Container_${d}_${randomWord(4)}`);
        parent.child(container);
        containers.push(container);
        parent = container;
    }

    const matchCount = Math.floor(noteCount * matchFraction);
    const diacriticTitles = [
        "résumé", "naïve", "café", "über", "ñoño", "exposé",
        "Ångström", "Üntersuchung", "São Paulo", "François"
    ];

    for (let i = 0; i < noteCount; i++) {
        const isMatch = i < matchCount;
        let title: string;

        if (includeDiacritics && i % 20 === 0) {
            // Every 20th note gets a diacritics-heavy title
            const dTitle = diacriticTitles[i % diacriticTitles.length];
            title = isMatch
                ? `${dTitle} ${titleKeywords.join(" ")} Document ${i}`
                : `${dTitle} ${randomWord(5)} Note ${i}`;
        } else {
            title = isMatch
                ? `${randomWord(5)} ${titleKeywords.join(" ")} ${randomWord(5)} Document ${i}`
                : `${randomWord(5)} ${randomWord(6)} ${randomWord(4)} Note ${i}`;
        }

        const n = note(title);

        for (let l = 0; l < labelsPerNote; l++) {
            const labelName = isMatch && l === 0 ? "category" : `label_${randomWord(4)}`;
            const labelValue = isMatch && l === 0 ? `important ${titleKeywords[0]}` : randomWord(8);
            n.label(labelName, labelValue);
        }

        let noteWordCount = contentWordCount;
        if (varyContentSize) {
            const r = Math.random();
            if (r < 0.2) noteWordCount = Math.floor(contentWordCount * (0.2 + Math.random() * 0.3));
            else if (r < 0.7) noteWordCount = Math.floor(contentWordCount * (0.7 + Math.random() * 0.6));
            else if (r < 0.9) noteWordCount = Math.floor(contentWordCount * (1.3 + Math.random() * 0.7));
            else noteWordCount = Math.floor(contentWordCount * (2.0 + Math.random() * 1.0));
        }

        const includeContentKeyword = isMatch && contentKeywords.length > 0;
        syntheticContent[n.note.noteId] = generateHtmlContent(
            noteWordCount,
            includeContentKeyword,
            includeContentKeyword ? contentKeywords : undefined
        );

        const containerIndex = i % containers.length;
        containers[containerIndex].child(n);
    }

    // Monkeypatch getContent()
    for (const noteObj of Object.values(becca.notes)) {
        const noteId = noteObj.noteId;
        if (syntheticContent[noteId]) {
            (noteObj as any).getContent = () => syntheticContent[noteId];
        } else {
            (noteObj as any).getContent = () => "";
        }
    }

    return { rootNote, matchCount };
}

// ── benchmark runner ─────────────────────────────────────────────────

interface BenchmarkResult {
    query: string;
    mode: string;
    noteCount: number;
    avgMs: number;
    minMs: number;
    resultCount: number;
}

function runBenchmark(
    query: string,
    mode: "autocomplete" | "fullSearch",
    fuzzyEnabled: boolean,
    iterations = 5
): BenchmarkResult {
    const noteCount = Object.keys(becca.notes).length;

    // Warm up
    if (mode === "autocomplete") {
        searchService.searchNotesForAutocomplete(query, true);
    } else {
        const ctx = new SearchContext({ fastSearch: false });
        ctx.enableFuzzyMatching = fuzzyEnabled;
        searchService.findResultsWithQuery(query, ctx);
    }

    const times: number[] = [];
    let resultCount = 0;

    for (let i = 0; i < iterations; i++) {
        if (mode === "autocomplete") {
            // For autocomplete, fuzzy is controlled by the global option
            // We'll manipulate enableFuzzyMatching after construction
            const [results, ms] = timed(() => {
                // searchNotesForAutocomplete creates its own SearchContext internally
                // so we need to test via findResultsWithQuery for fuzzy control
                const ctx = new SearchContext({
                    fastSearch: true,
                    includeHiddenNotes: true,
                    fuzzyAttributeSearch: true,
                    ignoreInternalAttributes: true,
                    autocomplete: true
                });
                ctx.enableFuzzyMatching = fuzzyEnabled;
                return searchService.findResultsWithQuery(query, ctx);
            });
            times.push(ms);
            resultCount = results.length;
        } else {
            const [results, ms] = timed(() => {
                const ctx = new SearchContext({ fastSearch: false });
                ctx.enableFuzzyMatching = fuzzyEnabled;
                return searchService.findResultsWithQuery(query, ctx);
            });
            times.push(ms);
            resultCount = results.length;
        }
    }

    return {
        query,
        mode: `${mode}${fuzzyEnabled ? "+fuzzy" : ""}`,
        noteCount,
        avgMs: avg(times),
        minMs: min(times),
        resultCount
    };
}

function printTable(title: string, results: BenchmarkResult[]) {
    console.log(`\n${"═".repeat(110)}`);
    console.log(`  ${title}`);
    console.log(`${"═".repeat(110)}`);
    console.log(
        "  " +
        "Query".padEnd(35) +
        "Mode".padEnd(22) +
        "Notes".padStart(7) +
        "Avg (ms)".padStart(12) +
        "Min (ms)".padStart(12) +
        "Results".padStart(10)
    );
    console.log(`  ${"─".repeat(98)}`);
    for (const r of results) {
        console.log(
            "  " +
            `"${r.query}"`.padEnd(35) +
            r.mode.padEnd(22) +
            String(r.noteCount).padStart(7) +
            r.avgMs.toFixed(1).padStart(12) +
            r.minMs.toFixed(1).padStart(12) +
            String(r.resultCount).padStart(10)
        );
    }
    console.log(`${"═".repeat(110)}\n`);
}

// ── tests ────────────────────────────────────────────────────────────

// Skipped by default - this is a benchmark, not a test.
// Remove .skip to run manually for performance analysis.
describe.skip("Comprehensive Search Benchmark", () => {

    afterEach(() => {
        becca.reset();
    });

    describe("Single-token queries", () => {
        for (const noteCount of [1000, 5000, 10000, 20000]) {
            it(`single token @ ${noteCount} notes — fuzzy on vs off, autocomplete vs full`, () => {
                buildDataset(noteCount, {
                    matchFraction: 0.15,
                    titleKeywords: ["meeting"],
                    contentKeywords: ["meeting"],
                    contentWordCount: 300,
                });

                const results: BenchmarkResult[] = [
                    runBenchmark("meeting", "autocomplete", false),
                    runBenchmark("meeting", "autocomplete", true),
                    runBenchmark("meeting", "fullSearch", false),
                    runBenchmark("meeting", "fullSearch", true),
                ];

                printTable(`Single Token "meeting" — ${noteCount} notes`, results);
                expect(results[0].resultCount).toBeGreaterThan(0);
            });
        }
    });

    describe("Multi-token queries", () => {
        for (const noteCount of [1000, 5000, 10000, 20000]) {
            it(`multi token @ ${noteCount} notes — fuzzy on vs off`, () => {
                buildDataset(noteCount, {
                    matchFraction: 0.15,
                    titleKeywords: ["meeting", "notes", "january"],
                    contentKeywords: ["meeting", "notes", "january"],
                    contentWordCount: 400,
                });

                const results: BenchmarkResult[] = [
                    // 2-token
                    runBenchmark("meeting notes", "autocomplete", false),
                    runBenchmark("meeting notes", "autocomplete", true),
                    runBenchmark("meeting notes", "fullSearch", false),
                    runBenchmark("meeting notes", "fullSearch", true),
                    // 3-token
                    runBenchmark("meeting notes january", "autocomplete", false),
                    runBenchmark("meeting notes january", "autocomplete", true),
                    runBenchmark("meeting notes january", "fullSearch", false),
                    runBenchmark("meeting notes january", "fullSearch", true),
                ];

                printTable(`Multi Token — ${noteCount} notes`, results);
                expect(results[0].resultCount).toBeGreaterThan(0);
            });
        }
    });

    describe("No-match queries (worst case — full scan, zero results)", () => {
        for (const noteCount of [1000, 5000, 10000, 20000]) {
            it(`no-match @ ${noteCount} notes`, () => {
                buildDataset(noteCount, {
                    matchFraction: 0.1,
                    titleKeywords: ["target"],
                    contentKeywords: ["target"],
                    contentWordCount: 300,
                });

                const results: BenchmarkResult[] = [
                    runBenchmark("xyznonexistent", "autocomplete", false),
                    runBenchmark("xyznonexistent", "autocomplete", true),
                    runBenchmark("xyznonexistent", "fullSearch", false),
                    runBenchmark("xyznonexistent", "fullSearch", true),
                    runBenchmark("xyzfoo xyzbar", "autocomplete", false),
                    runBenchmark("xyzfoo xyzbar", "autocomplete", true),
                    runBenchmark("xyzfoo xyzbar", "fullSearch", false),
                    runBenchmark("xyzfoo xyzbar", "fullSearch", true),
                ];

                printTable(`No-Match Queries — ${noteCount} notes`, results);
                // All should return 0 results
                for (const r of results) {
                    expect(r.resultCount).toBe(0);
                }
            });
        }
    });

    describe("Diacritics / Unicode queries", () => {
        for (const noteCount of [1000, 5000, 10000]) {
            it(`diacritics @ ${noteCount} notes`, () => {
                buildDataset(noteCount, {
                    matchFraction: 0.15,
                    titleKeywords: ["résumé"],
                    contentKeywords: ["résumé"],
                    contentWordCount: 300,
                    includeDiacritics: true,
                });

                const results: BenchmarkResult[] = [
                    // Exact diacritics
                    runBenchmark("résumé", "autocomplete", false),
                    runBenchmark("résumé", "autocomplete", true),
                    // ASCII equivalent (should still match via normalize)
                    runBenchmark("resume", "autocomplete", false),
                    runBenchmark("resume", "autocomplete", true),
                    // Full search
                    runBenchmark("résumé", "fullSearch", false),
                    runBenchmark("resume", "fullSearch", false),
                ];

                printTable(`Diacritics "résumé" / "resume" — ${noteCount} notes`, results);
            });
        }
    });

    describe("Partial / prefix queries (simulating typing)", () => {
        for (const noteCount of [5000, 10000, 20000]) {
            it(`typing progression @ ${noteCount} notes`, () => {
                buildDataset(noteCount, {
                    matchFraction: 0.15,
                    titleKeywords: ["documentation"],
                    contentKeywords: ["documentation"],
                    contentWordCount: 300,
                });

                const results: BenchmarkResult[] = [
                    runBenchmark("d", "autocomplete", false),
                    runBenchmark("do", "autocomplete", false),
                    runBenchmark("doc", "autocomplete", false),
                    runBenchmark("docu", "autocomplete", false),
                    runBenchmark("docum", "autocomplete", false),
                    runBenchmark("document", "autocomplete", false),
                    runBenchmark("documentation", "autocomplete", false),
                    // Same with fuzzy
                    runBenchmark("d", "autocomplete", true),
                    runBenchmark("doc", "autocomplete", true),
                    runBenchmark("document", "autocomplete", true),
                    runBenchmark("documentation", "autocomplete", true),
                ];

                printTable(`Typing Progression "documentation" — ${noteCount} notes`, results);
            });
        }
    });

    describe("Attribute-matching queries", () => {
        for (const noteCount of [5000, 10000]) {
            it(`attribute search @ ${noteCount} notes`, () => {
                buildDataset(noteCount, {
                    matchFraction: 0.15,
                    labelsPerNote: 5,
                    titleKeywords: ["important"],
                    contentKeywords: ["important"],
                    contentWordCount: 200,
                });

                const results: BenchmarkResult[] = [
                    // "category" is a label name on matching notes
                    runBenchmark("category", "autocomplete", false),
                    runBenchmark("category", "autocomplete", true),
                    runBenchmark("category", "fullSearch", false),
                    runBenchmark("category", "fullSearch", true),
                    // "important" appears in both title and label value
                    runBenchmark("important", "autocomplete", false),
                    runBenchmark("important", "autocomplete", true),
                ];

                printTable(`Attribute Matching — ${noteCount} notes`, results);
            });
        }
    });

    describe("Long queries (4-5 tokens)", () => {
        for (const noteCount of [5000, 10000]) {
            it(`long query @ ${noteCount} notes`, () => {
                buildDataset(noteCount, {
                    matchFraction: 0.10,
                    titleKeywords: ["quarterly", "budget", "review", "report"],
                    contentKeywords: ["quarterly", "budget", "review", "report"],
                    contentWordCount: 500,
                });

                const results: BenchmarkResult[] = [
                    runBenchmark("quarterly", "autocomplete", false),
                    runBenchmark("quarterly budget", "autocomplete", false),
                    runBenchmark("quarterly budget review", "autocomplete", false),
                    runBenchmark("quarterly budget review report", "autocomplete", false),
                    // Same with fuzzy
                    runBenchmark("quarterly budget review report", "autocomplete", true),
                    // Full search
                    runBenchmark("quarterly budget review report", "fullSearch", false),
                    runBenchmark("quarterly budget review report", "fullSearch", true),
                ];

                printTable(`Long Queries (4 tokens) — ${noteCount} notes`, results);
            });
        }
    });

    describe("Mixed scenario — realistic user session", () => {
        it("simulates a user session with varied queries @ 10K notes", () => {
            buildDataset(10000, {
                matchFraction: 0.15,
                titleKeywords: ["project", "planning"],
                contentKeywords: ["project", "planning", "timeline", "budget"],
                contentWordCount: 400,
                varyContentSize: true,
                includeDiacritics: true,
                depth: 6,
            });

            const results: BenchmarkResult[] = [
                // Quick autocomplete lookups (user typing in search bar)
                runBenchmark("pro", "autocomplete", false),
                runBenchmark("project", "autocomplete", false),
                runBenchmark("project plan", "autocomplete", false),

                // Full search (user hits Enter)
                runBenchmark("project", "fullSearch", false),
                runBenchmark("project planning", "fullSearch", false),
                runBenchmark("project planning", "fullSearch", true),

                // Typo / near-miss with fuzzy
                runBenchmark("projct", "autocomplete", false),
                runBenchmark("projct", "autocomplete", true),
                runBenchmark("projct planing", "fullSearch", false),
                runBenchmark("projct planing", "fullSearch", true),

                // No results
                runBenchmark("xyznonexistent", "autocomplete", false),
                runBenchmark("xyznonexistent foo", "fullSearch", true),

                // Short common substring
                runBenchmark("note", "autocomplete", false),
                runBenchmark("document", "autocomplete", false),
            ];

            printTable("Realistic User Session — 10K notes", results);
        });
    });

    describe("Cache warmth impact", () => {
        it("cold vs warm flat text index @ 10K notes", () => {
            buildDataset(10000, {
                matchFraction: 0.15,
                titleKeywords: ["target"],
                contentKeywords: ["target"],
                contentWordCount: 300,
            });

            console.log(`\n${"═".repeat(80)}`);
            console.log("  Cold vs Warm Cache — 10K notes");
            console.log(`${"═".repeat(80)}`);

            // Cold: first search after dataset build (flat text index not yet built)
            becca.flatTextIndex = null;
            becca.dirtyFlatTextNoteIds.clear();
            const [coldResults, coldMs] = timed(() => {
                const ctx = new SearchContext({ fastSearch: true, autocomplete: true });
                ctx.enableFuzzyMatching = false;
                return searchService.findResultsWithQuery("target", ctx);
            });
            console.log(`  Cold (index build + search):  ${coldMs.toFixed(1)}ms  (${coldResults.length} results)`);

            // Warm: subsequent searches reuse the index
            const warmTimes: number[] = [];
            for (let i = 0; i < 5; i++) {
                const [, ms] = timed(() => {
                    const ctx = new SearchContext({ fastSearch: true, autocomplete: true });
                    ctx.enableFuzzyMatching = false;
                    return searchService.findResultsWithQuery("target", ctx);
                });
                warmTimes.push(ms);
            }
            console.log(`  Warm (reuse index, 5 runs):   avg ${avg(warmTimes).toFixed(1)}ms  min ${min(warmTimes).toFixed(1)}ms`);

            // Incremental: dirty a few notes and search again
            const noteIds = Object.keys(becca.notes).slice(0, 50);
            for (const nid of noteIds) {
                becca.dirtyNoteFlatText(nid);
            }
            const [, incrMs] = timed(() => {
                const ctx = new SearchContext({ fastSearch: true, autocomplete: true });
                ctx.enableFuzzyMatching = false;
                return searchService.findResultsWithQuery("target", ctx);
            });
            console.log(`  Incremental (50 dirty notes): ${incrMs.toFixed(1)}ms`);

            // Full rebuild
            becca.flatTextIndex = null;
            const [, rebuildMs] = timed(() => {
                const ctx = new SearchContext({ fastSearch: true, autocomplete: true });
                ctx.enableFuzzyMatching = false;
                return searchService.findResultsWithQuery("target", ctx);
            });
            console.log(`  Full rebuild (index = null):   ${rebuildMs.toFixed(1)}ms`);

            console.log(`${"═".repeat(80)}\n`);
        });
    });

    describe("Fuzzy matching effectiveness comparison", () => {
        it("exact vs fuzzy result quality @ 10K notes", () => {
            buildDataset(10000, {
                matchFraction: 0.10,
                titleKeywords: ["performance"],
                contentKeywords: ["performance", "optimization"],
                contentWordCount: 300,
            });

            console.log(`\n${"═".repeat(90)}`);
            console.log("  Fuzzy Matching Effectiveness — 10K notes");
            console.log(`${"═".repeat(90)}`);
            console.log(
                "  " +
                "Query".padEnd(30) +
                "Fuzzy".padEnd(8) +
                "Time (ms)".padStart(12) +
                "Results".padStart(10) +
                "  Notes"
            );
            console.log(`  ${"─".repeat(70)}`);

            const queries = [
                "performance",           // exact match
                "performanc",            // truncated
                "preformance",           // typo
                "performence",           // common misspelling
                "optimization",          // exact match
                "optimzation",           // typo
                "perf optim",            // abbreviated multi
            ];

            for (const query of queries) {
                for (const fuzzy of [false, true]) {
                    const times: number[] = [];
                    let resultCount = 0;
                    for (let i = 0; i < 3; i++) {
                        const [results, ms] = timed(() => {
                            const ctx = new SearchContext({ fastSearch: true });
                            ctx.enableFuzzyMatching = fuzzy;
                            return searchService.findResultsWithQuery(query, ctx);
                        });
                        times.push(ms);
                        resultCount = results.length;
                    }
                    console.log(
                        "  " +
                        `"${query}"`.padEnd(30) +
                        (fuzzy ? "ON" : "OFF").padEnd(8) +
                        avg(times).toFixed(1).padStart(12) +
                        String(resultCount).padStart(10)
                    );
                }
            }

            console.log(`${"═".repeat(90)}\n`);
        });
    });

    describe("Scale comparison summary", () => {
        it("summary table across all note counts", () => {
            const summaryResults: BenchmarkResult[] = [];

            for (const noteCount of [1000, 5000, 10000, 20000]) {
                buildDataset(noteCount, {
                    matchFraction: 0.15,
                    titleKeywords: ["meeting", "notes"],
                    contentKeywords: ["meeting", "notes"],
                    contentWordCount: 400,
                    varyContentSize: true,
                    depth: 5,
                });

                // Core scenarios
                summaryResults.push(runBenchmark("meeting", "autocomplete", false));
                summaryResults.push(runBenchmark("meeting", "autocomplete", true));
                summaryResults.push(runBenchmark("meeting notes", "autocomplete", false));
                summaryResults.push(runBenchmark("meeting notes", "autocomplete", true));
                summaryResults.push(runBenchmark("meeting", "fullSearch", false));
                summaryResults.push(runBenchmark("meeting", "fullSearch", true));
                summaryResults.push(runBenchmark("meeting notes", "fullSearch", false));
                summaryResults.push(runBenchmark("meeting notes", "fullSearch", true));
                summaryResults.push(runBenchmark("xyznonexistent", "autocomplete", false));
                summaryResults.push(runBenchmark("xyznonexistent", "fullSearch", true));
            }

            printTable("Scale Comparison Summary", summaryResults);
        });
    });
});
