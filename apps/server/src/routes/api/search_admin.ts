/**
 * API endpoints for search administration and monitoring
 */

import { Router } from "express";
import performanceMonitor from "../../services/search/performance_monitor.js";
import abTestingService from "../../services/search/ab_testing.js";
import { SQLiteSearchService } from "../../services/search/sqlite_search_service.js";
import optionService from "../../services/options.js";
import sql from "../../services/sql.js";
import log from "../../services/log.js";

const router = Router();

/**
 * Get search performance metrics
 */
router.get("/api/search-admin/metrics", (req, res) => {
    const metrics = {
        recent: performanceMonitor.getRecentMetrics(100),
        averages: {
            typescript: performanceMonitor.getAverageMetrics("typescript"),
            sqlite: performanceMonitor.getAverageMetrics("sqlite")
        },
        comparison: performanceMonitor.compareBackends()
    };

    res.json(metrics);
});

/**
 * Get A/B testing results
 */
router.get("/api/search-admin/ab-tests", (req, res) => {
    const results = {
        summary: abTestingService.getSummary(),
        recent: abTestingService.getRecentResults(50)
    };

    res.json(results);
});

/**
 * Get current search configuration
 */
router.get("/api/search-admin/config", (req, res) => {
    const config = {
        backend: optionService.getOption("searchBackend"),
        sqliteEnabled: optionService.getOptionBool("searchSqliteEnabled"),
        performanceLogging: optionService.getOptionBool("searchSqlitePerformanceLogging"),
        maxMemory: optionService.getOptionInt("searchSqliteMaxMemory"),
        batchSize: optionService.getOptionInt("searchSqliteBatchSize"),
        autoRebuild: optionService.getOptionBool("searchSqliteAutoRebuild")
    };

    res.json(config);
});

/**
 * Update search configuration
 */
router.put("/api/search-admin/config", (req, res) => {
    try {
        const { backend, sqliteEnabled, performanceLogging, maxMemory, batchSize, autoRebuild } = req.body;

        if (backend !== undefined) {
            if (!["typescript", "sqlite"].includes(backend)) {
                return res.status(400).json({ error: "Invalid backend. Must be 'typescript' or 'sqlite'" });
            }
            optionService.setOption("searchBackend", backend);
        }

        if (sqliteEnabled !== undefined) {
            optionService.setOption("searchSqliteEnabled", sqliteEnabled ? "true" : "false");
        }

        if (performanceLogging !== undefined) {
            optionService.setOption("searchSqlitePerformanceLogging", performanceLogging ? "true" : "false");
            performanceMonitor.updateSettings();
        }

        if (maxMemory !== undefined) {
            if (maxMemory < 1048576 || maxMemory > 1073741824) { // 1MB to 1GB
                return res.status(400).json({ error: "Max memory must be between 1MB and 1GB" });
            }
            optionService.setOption("searchSqliteMaxMemory", maxMemory.toString());
        }

        if (batchSize !== undefined) {
            if (batchSize < 10 || batchSize > 1000) {
                return res.status(400).json({ error: "Batch size must be between 10 and 1000" });
            }
            optionService.setOption("searchSqliteBatchSize", batchSize.toString());
        }

        if (autoRebuild !== undefined) {
            optionService.setOption("searchSqliteAutoRebuild", autoRebuild ? "true" : "false");
        }

        res.json({ success: true, message: "Configuration updated successfully" });
    } catch (error: any) {
        log.error(`Failed to update search configuration: ${error}`);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get SQLite search index status
 */
router.get("/api/search-admin/sqlite/status", async (req, res) => {
    try {
        const service = SQLiteSearchService.getInstance();
        const status = await service.getIndexStatus();

        // Add table sizes
        const tableSizes = sql.getRows<{ name: string; size: number }>(`
            SELECT 
                name,
                (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=m.name) as size
            FROM sqlite_master m
            WHERE type='table' AND name IN ('note_search_content', 'note_tokens', 'notes_fts', 'notes_fts_data', 'notes_fts_idx', 'notes_fts_content')
        `);

        res.json({
            ...status,
            tables: tableSizes
        });
    } catch (error: any) {
        log.error(`Failed to get SQLite search status: ${error}`);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Rebuild SQLite search index
 */
router.post("/api/search-admin/sqlite/rebuild", async (req, res) => {
    try {
        const { force = false } = req.body;
        
        log.info("Starting SQLite search index rebuild via API");
        
        const service = SQLiteSearchService.getInstance();
        const startTime = Date.now();
        
        await service.rebuildIndex(force);
        
        const duration = Date.now() - startTime;
        log.info(`SQLite search index rebuild completed in ${duration}ms`);

        res.json({
            success: true,
            message: "Index rebuilt successfully",
            duration
        });
    } catch (error: any) {
        log.error(`Failed to rebuild SQLite search index: ${error}`);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Clear SQLite search index
 */
router.delete("/api/search-admin/sqlite/index", async (req, res) => {
    try {
        log.info("Clearing SQLite search index via API");
        
        const service = SQLiteSearchService.getInstance();
        service.clearIndex();
        
        res.json({
            success: true,
            message: "Index cleared successfully"
        });
    } catch (error: any) {
        log.error(`Failed to clear SQLite search index: ${error}`);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Reset performance metrics
 */
router.delete("/api/search-admin/metrics", (req, res) => {
    performanceMonitor.reset();
    res.json({ success: true, message: "Metrics reset successfully" });
});

/**
 * Reset A/B test results
 */
router.delete("/api/search-admin/ab-tests", (req, res) => {
    abTestingService.reset();
    res.json({ success: true, message: "A/B test results reset successfully" });
});

/**
 * Set A/B testing sample rate
 */
router.put("/api/search-admin/ab-tests/sample-rate", (req, res) => {
    try {
        const { rate } = req.body;
        
        if (rate === undefined || rate < 0 || rate > 1) {
            return res.status(400).json({ error: "Sample rate must be between 0 and 1" });
        }

        abTestingService.setSampleRate(rate);
        res.json({ success: true, message: `Sample rate set to ${rate * 100}%` });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Test search with both backends for comparison
 */
router.post("/api/search-admin/test", async (req, res) => {
    try {
        const { query } = req.body;
        
        if (!query) {
            return res.status(400).json({ error: "Query is required" });
        }

        const result = await abTestingService.runComparison(query, {});
        
        if (!result) {
            return res.json({ 
                message: "Test not run (sampling or disabled)",
                query 
            });
        }

        res.json(result);
    } catch (error: any) {
        log.error(`Search test failed: ${error}`);
        res.status(500).json({ error: error.message });
    }
});

export default router;