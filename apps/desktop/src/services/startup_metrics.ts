import type { RendererStartupMetric } from "@triliumnext/commons";
import dataDir from "@triliumnext/server/src/services/data_dir.js";
import { ipcMain } from "electron";
import fs from "fs";
import path from "path";

/**
 * Startup timing instrumentation for the desktop app.
 *
 * Every mark is measured as the time elapsed since the OS created the Electron
 * main process (`process.getCreationTime()`), so the numbers include Chromium
 * bootstrap and the parse/evaluation of the main bundle — not just the parts
 * Trilium controls. Falls back to the load time of this module in the rare
 * case the OS does not report a creation time.
 *
 * The marks are always kept in memory, but they are only written to
 * {@link STARTUP_METRICS_FILE} when {@link metricsFileEnabled} — `pnpm
 * desktop:start` sets `TRILIUM_ENV=dev`, and `TRILIUM_STARTUP_METRICS=1` turns
 * the file on for a packaged build. The file is rewritten on every mark, so it
 * always holds the complete picture of the current launch.
 *
 * Only the first occurrence of each metric is recorded: window reloads, extra
 * windows, and repeated phase marks do not overwrite the startup measurement.
 */

const STARTUP_METRICS_FILE = path.join(dataDir.LOG_DIR, "startup-metrics.log");

const metricsFileEnabled = process.env.TRILIUM_ENV === "dev" || !!process.env.TRILIUM_STARTUP_METRICS;

const baselineEpochMs: number = process.getCreationTime?.() ?? Date.now();

const recordedMetrics = new Map<string, number>();

/** Metric names the renderer is allowed to report via `report-startup-metric` IPC. */
const RENDERER_STARTUP_METRICS: ReadonlySet<string> = new Set<RendererStartupMetric>(["client-full-render"]);

/** Records the given startup milestone as "now", unless it was already recorded. */
export function markStartupMetric(name: string) {
    if (recordedMetrics.has(name)) {
        return;
    }

    recordedMetrics.set(name, Math.round(Date.now() - baselineEpochMs));

    if (!metricsFileEnabled) {
        return;
    }

    // One line per metric: the duration of the phase (delta to the previous
    // metric), with the cumulative time since process creation in parentheses.
    let previousElapsedMs = 0;
    const lines = [...recordedMetrics].map(([metric, elapsedMs]) => {
        const line = `${metric}: +${elapsedMs - previousElapsedMs}ms (${elapsedMs}ms since process creation)`;
        previousElapsedMs = elapsedMs;
        return line;
    });
    try {
        // The first mark runs before ServerLogService has opened the log directory.
        fs.mkdirSync(dataDir.LOG_DIR, { recursive: true, mode: 0o700 });
        fs.writeFileSync(STARTUP_METRICS_FILE, `${lines.join("\n")}\n`);
    } catch (e) {
        // Instrumentation must never break startup; the metric stays available
        // via getStartupMetrics().
        console.error(`Could not write ${STARTUP_METRICS_FILE}: ${e}`);
    }
}

/** The metrics recorded so far, as elapsed milliseconds since process creation. */
export function getStartupMetrics(): ReadonlyMap<string, number> {
    return recordedMetrics;
}

/**
 * Registers the IPC channel through which the renderer reports its own startup
 * milestones (`window.electronApi.window.reportStartupMetric`). The renderer is
 * untrusted, so only allowlisted metric names are accepted.
 */
export function setupStartupMetricsIpc() {
    ipcMain.on("report-startup-metric", (_event, metric: unknown) => {
        if (typeof metric === "string" && RENDERER_STARTUP_METRICS.has(metric)) {
            markStartupMetric(metric);
        }
    });
}
