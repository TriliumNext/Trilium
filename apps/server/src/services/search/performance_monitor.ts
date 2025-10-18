/**
 * Performance monitoring utilities for search operations
 */

import log from "../log.js";
import optionService from "../options.js";

export interface SearchMetrics {
    query: string;
    backend: "typescript" | "sqlite";
    totalTime: number;
    parseTime?: number;
    searchTime?: number;
    resultCount: number;
    memoryUsed?: number;
    cacheHit?: boolean;
    error?: string;
}

export interface DetailedMetrics extends SearchMetrics {
    phases?: {
        name: string;
        duration: number;
    }[];
    sqliteStats?: {
        rowsScanned?: number;
        indexUsed?: boolean;
        tempBTreeUsed?: boolean;
    };
}

interface SearchPerformanceAverages {
    avgTime: number;
    avgResults: number;
    totalQueries: number;
    errorRate: number;
}

class PerformanceMonitor {
    private metrics: SearchMetrics[] = [];
    private maxMetricsStored = 1000;
    private metricsEnabled = false;

    constructor() {
        // Check if performance logging is enabled
        this.updateSettings();
    }

    updateSettings() {
        try {
            this.metricsEnabled = optionService.getOptionBool("searchSqlitePerformanceLogging");
        } catch {
            this.metricsEnabled = false;
        }
    }

    startTimer(): () => number {
        const startTime = process.hrtime.bigint();
        return () => {
            const endTime = process.hrtime.bigint();
            return Number(endTime - startTime) / 1_000_000; // Convert to milliseconds
        };
    }

    recordMetrics(metrics: SearchMetrics) {
        if (!this.metricsEnabled) {
            return;
        }

        this.metrics.push(metrics);

        // Keep only the last N metrics
        if (this.metrics.length > this.maxMetricsStored) {
            this.metrics = this.metrics.slice(-this.maxMetricsStored);
        }

        // Log significant performance differences
        if (metrics.totalTime > 1000) {
            log.info(`Slow search query detected: ${metrics.totalTime.toFixed(2)}ms for query "${metrics.query.substring(0, 100)}"`);
        }

        // Log to debug for analysis
        log.info(`Search metrics: backend=${metrics.backend}, time=${metrics.totalTime.toFixed(2)}ms, results=${metrics.resultCount}, query="${metrics.query.substring(0, 50)}"`);
    }

    recordDetailedMetrics(metrics: DetailedMetrics) {
        if (!this.metricsEnabled) {
            return;
        }

        this.recordMetrics(metrics);

        // Log detailed phase information
        if (metrics.phases) {
            const phaseLog = metrics.phases
                .map(p => `${p.name}=${p.duration.toFixed(2)}ms`)
                .join(", ");
            log.info(`Search phases: ${phaseLog}`);
        }

        // Log SQLite specific stats
        if (metrics.sqliteStats) {
            log.info(`SQLite stats: rows_scanned=${metrics.sqliteStats.rowsScanned}, index_used=${metrics.sqliteStats.indexUsed}`);
        }
    }

    getRecentMetrics(count: number = 100): SearchMetrics[] {
        return this.metrics.slice(-count);
    }

    getAverageMetrics(backend?: "typescript" | "sqlite"): SearchPerformanceAverages | null {
        let relevantMetrics = this.metrics;
        
        if (backend) {
            relevantMetrics = this.metrics.filter(m => m.backend === backend);
        }

        if (relevantMetrics.length === 0) {
            return null;
        }

        const totalTime = relevantMetrics.reduce((sum, m) => sum + m.totalTime, 0);
        const totalResults = relevantMetrics.reduce((sum, m) => sum + m.resultCount, 0);
        const errorCount = relevantMetrics.filter(m => m.error).length;

        return {
            avgTime: totalTime / relevantMetrics.length,
            avgResults: totalResults / relevantMetrics.length,
            totalQueries: relevantMetrics.length,
            errorRate: errorCount / relevantMetrics.length
        };
    }

    compareBackends(): {
        typescript: SearchPerformanceAverages;
        sqlite: SearchPerformanceAverages;
        recommendation?: string;
    } {
        const tsMetrics = this.getAverageMetrics("typescript");
        const sqliteMetrics = this.getAverageMetrics("sqlite");

        let recommendation: string | undefined;

        if (tsMetrics && sqliteMetrics) {
            const speedupFactor = tsMetrics.avgTime / sqliteMetrics.avgTime;
            
            if (speedupFactor > 1.5) {
                recommendation = `SQLite is ${speedupFactor.toFixed(1)}x faster on average`;
            } else if (speedupFactor < 0.67) {
                recommendation = `TypeScript is ${(1/speedupFactor).toFixed(1)}x faster on average`;
            } else {
                recommendation = "Both backends perform similarly";
            }

            // Consider error rates
            if (sqliteMetrics.errorRate > tsMetrics.errorRate + 0.1) {
                recommendation += " (but SQLite has higher error rate)";
            } else if (tsMetrics.errorRate > sqliteMetrics.errorRate + 0.1) {
                recommendation += " (but TypeScript has higher error rate)";
            }
        }

        return {
            typescript: tsMetrics || { avgTime: 0, avgResults: 0, totalQueries: 0, errorRate: 0 },
            sqlite: sqliteMetrics || { avgTime: 0, avgResults: 0, totalQueries: 0, errorRate: 0 },
            recommendation
        };
    }

    reset() {
        this.metrics = [];
    }
}

// Singleton instance
const performanceMonitor = new PerformanceMonitor();

export default performanceMonitor;