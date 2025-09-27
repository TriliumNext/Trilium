/**
 * A/B Testing utilities for comparing search backend performance
 */

import SearchContext from "./search_context.js";
import type { SearchParams } from "./services/types.js";
import performanceMonitor from "./performance_monitor.js";
import log from "../log.js";
import optionService from "../options.js";

export interface ABTestResult {
    query: string;
    typescriptTime: number;
    sqliteTime: number;
    typescriptResults: number;
    sqliteResults: number;
    resultsMatch: boolean;
    speedup: number;
    winner: "typescript" | "sqlite" | "tie";
}

class ABTestingService {
    private enabled: boolean = false;
    private sampleRate: number = 0.1; // 10% of searches by default
    private results: ABTestResult[] = [];
    private maxResults: number = 1000;

    constructor() {
        this.updateSettings();
    }

    updateSettings() {
        try {
            this.enabled = optionService.getOptionBool("searchSqliteEnabled");
            // Could add a separate AB testing option if needed
        } catch {
            this.enabled = false;
        }
    }

    /**
     * Determines if we should run an A/B test for this query
     */
    shouldRunTest(): boolean {
        if (!this.enabled) {
            return false;
        }

        // Random sampling
        return Math.random() < this.sampleRate;
    }

    /**
     * Run the same search query with both backends and compare results
     */
    async runComparison(query: string, params: SearchParams): Promise<ABTestResult | null> {
        if (!this.shouldRunTest()) {
            return null;
        }

        try {
            // Dynamically import to avoid circular dependencies
            const searchModule = await import("./services/search.js");
            
            // Run with TypeScript backend
            const tsContext = new SearchContext({ ...params, forceBackend: "typescript" });
            const tsTimer = performanceMonitor.startTimer();
            const tsResults = searchModule.default.findResultsWithQuery(query, tsContext);
            const tsTime = tsTimer();

            // Run with SQLite backend
            const sqliteContext = new SearchContext({ ...params, forceBackend: "sqlite" });
            const sqliteTimer = performanceMonitor.startTimer();
            const sqliteResults = searchModule.default.findResultsWithQuery(query, sqliteContext);
            const sqliteTime = sqliteTimer();

            // Compare results
            const tsNoteIds = new Set(tsResults.map(r => r.noteId));
            const sqliteNoteIds = new Set(sqliteResults.map(r => r.noteId));
            
            // Check if results match (same notes found)
            const resultsMatch = tsNoteIds.size === sqliteNoteIds.size &&
                [...tsNoteIds].every(id => sqliteNoteIds.has(id));

            // Calculate speedup
            const speedup = tsTime / sqliteTime;

            // Determine winner
            let winner: "typescript" | "sqlite" | "tie";
            if (speedup > 1.2) {
                winner = "sqlite";
            } else if (speedup < 0.83) {
                winner = "typescript";
            } else {
                winner = "tie";
            }

            const result: ABTestResult = {
                query: query.substring(0, 100),
                typescriptTime: tsTime,
                sqliteTime: sqliteTime,
                typescriptResults: tsResults.length,
                sqliteResults: sqliteResults.length,
                resultsMatch,
                speedup,
                winner
            };

            this.recordResult(result);

            // Log significant differences
            if (!resultsMatch) {
                log.info(`A/B test found different results for query "${query.substring(0, 50)}": TS=${tsResults.length}, SQLite=${sqliteResults.length}`);
            }

            if (Math.abs(speedup - 1) > 0.5) {
                log.info(`A/B test significant performance difference: ${winner} is ${Math.abs(speedup - 1).toFixed(1)}x faster for query "${query.substring(0, 50)}"`);
            }

            return result;
        } catch (error) {
            log.error(`A/B test failed: ${error}`);
            return null;
        }
    }

    private recordResult(result: ABTestResult) {
        this.results.push(result);

        // Keep only the last N results
        if (this.results.length > this.maxResults) {
            this.results = this.results.slice(-this.maxResults);
        }
    }

    /**
     * Get summary statistics from A/B tests
     */
    getSummary(): {
        totalTests: number;
        avgSpeedup: number;
        typescriptWins: number;
        sqliteWins: number;
        ties: number;
        mismatchRate: number;
        recommendation: string;
    } {
        if (this.results.length === 0) {
            return {
                totalTests: 0,
                avgSpeedup: 1,
                typescriptWins: 0,
                sqliteWins: 0,
                ties: 0,
                mismatchRate: 0,
                recommendation: "No A/B test data available"
            };
        }

        const totalTests = this.results.length;
        const avgSpeedup = this.results.reduce((sum, r) => sum + r.speedup, 0) / totalTests;
        const typescriptWins = this.results.filter(r => r.winner === "typescript").length;
        const sqliteWins = this.results.filter(r => r.winner === "sqlite").length;
        const ties = this.results.filter(r => r.winner === "tie").length;
        const mismatches = this.results.filter(r => !r.resultsMatch).length;
        const mismatchRate = mismatches / totalTests;

        let recommendation: string;
        if (mismatchRate > 0.1) {
            recommendation = "High mismatch rate detected - SQLite search may have accuracy issues";
        } else if (avgSpeedup > 1.5) {
            recommendation = `SQLite is ${avgSpeedup.toFixed(1)}x faster on average - consider enabling`;
        } else if (avgSpeedup < 0.67) {
            recommendation = `TypeScript is ${(1/avgSpeedup).toFixed(1)}x faster on average - keep using TypeScript`;
        } else {
            recommendation = "Both backends perform similarly - choice depends on other factors";
        }

        return {
            totalTests,
            avgSpeedup,
            typescriptWins,
            sqliteWins,
            ties,
            mismatchRate,
            recommendation
        };
    }

    /**
     * Get recent test results
     */
    getRecentResults(count: number = 100): ABTestResult[] {
        return this.results.slice(-count);
    }

    /**
     * Clear all test results
     */
    reset() {
        this.results = [];
    }

    /**
     * Set the sampling rate for A/B tests
     */
    setSampleRate(rate: number) {
        if (rate < 0 || rate > 1) {
            throw new Error("Sample rate must be between 0 and 1");
        }
        this.sampleRate = rate;
    }
}

// Singleton instance
const abTestingService = new ABTestingService();

export default abTestingService;