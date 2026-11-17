import type { RendererStartupMetric } from "@triliumnext/commons";
import dataDir from "@triliumnext/server/src/services/data_dir.js";
import { ipcMain } from "electron";
import fs from "fs";
import path from "path";

/**
 * Startup timing instrumentation for the desktop app.
 *
 * Every mark is measured as the time elapsed since the OS started the Electron
 * main process (see {@link readProcessStartEpochMs}), so the numbers include
 * Chromium bootstrap and the parse/evaluation of the main bundle — not just the
 * parts Trilium controls. Falls back to the load time of this module in the
 * rare case the OS does not report a start time.
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

/** The kernel reports a process's `starttime` in USER_HZ ticks, which Linux fixes at 100 per second. */
const MS_PER_CLOCK_TICK = 10;

const baselineEpochMs: number = readProcessStartEpochMs() ?? Date.now();

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

/**
 * When the OS started this process, in epoch milliseconds.
 *
 * On Linux, `process.getCreationTime()` adds the start time to the boot time from `/proc/stat`,
 * which is rounded to whole seconds, so it reports a start up to a second early, by an amount that
 * changes with every boot. `/proc/self/stat` and `/proc/uptime` both count from boot, so their
 * difference is the age of the process, to their 10 ms resolution.
 */
function readProcessStartEpochMs(): number | undefined {
    if (process.platform === "linux") {
        try {
            const stat = fs.readFileSync("/proc/self/stat", "utf8");
            const uptime = fs.readFileSync("/proc/uptime", "utf8");
            const startEpochMs = getProcessStartFromProc(stat, uptime, Date.now());
            if (startEpochMs !== undefined) {
                return startEpochMs;
            }
        } catch {
            // Without /proc, the value Electron reports is the best there is.
        }
    }

    return process.getCreationTime?.() ?? undefined;
}

function getProcessStartFromProc(stat: string, uptime: string, nowMs: number) {
    // The command name can contain spaces and parentheses, so the fields are counted from its end:
    // `starttime` is field 22 of the line, the 20th after the command name.
    const fieldsAfterCommand = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const startTicks = Number(fieldsAfterCommand[19]);
    const uptimeSeconds = Number(uptime.split(" ")[0]);
    if (!Number.isFinite(startTicks) || !Number.isFinite(uptimeSeconds)) {
        return undefined;
    }

    return nowMs - (uptimeSeconds * 1000 - startTicks * MS_PER_CLOCK_TICK);
}
