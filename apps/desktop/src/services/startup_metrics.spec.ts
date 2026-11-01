import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

const h = vi.hoisted(() => ({
    ipcOn: new Map<string, Handler>(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    writeShouldThrow: false
}));

vi.mock("electron", () => ({
    ipcMain: {
        on: (channel: string, fn: Handler) => h.ipcOn.set(channel, fn)
    }
}));

vi.mock("@triliumnext/server/src/services/data_dir.js", () => ({
    default: { LOG_DIR: "/tmp/trilium-data/log" }
}));

vi.mock("fs", () => ({
    default: {
        mkdirSync: (...args: unknown[]) => h.mkdirSync(...args),
        writeFileSync: (...args: unknown[]) => {
            if (h.writeShouldThrow) {
                throw new Error("disk full");
            }
            h.writeFileSync(...args);
        }
    }
}));

const METRICS_PATH = ["/tmp/trilium-data/log", "startup-metrics.log"].join(process.platform === "win32" ? "\\" : "/");

describe("startup metrics", () => {
    let metrics: typeof import("./startup_metrics.js");

    beforeEach(async () => {
        h.ipcOn.clear();
        h.mkdirSync.mockClear();
        h.writeFileSync.mockClear();
        h.writeShouldThrow = false;
        vi.stubEnv("TRILIUM_ENV", "dev");
        vi.resetModules();
        metrics = await import("./startup_metrics.js");
    });

    it("records a metric relative to the baseline and rewrites the metrics file in the log directory", () => {
        metrics.markStartupMetric("test-phase");

        const elapsed = metrics.getStartupMetrics().get("test-phase");
        expect(elapsed).toBeGreaterThanOrEqual(0);
        expect(h.mkdirSync).toHaveBeenCalledWith("/tmp/trilium-data/log", { recursive: true, mode: 0o700 });
        expect(h.writeFileSync).toHaveBeenCalledTimes(1);
        expect(h.writeFileSync).toHaveBeenCalledWith(METRICS_PATH, expect.stringContaining("test-phase:"));

        // Re-marking keeps the first measurement and does not rewrite the file.
        metrics.markStartupMetric("test-phase");
        expect(metrics.getStartupMetrics().get("test-phase")).toBe(elapsed);
        expect(h.writeFileSync).toHaveBeenCalledTimes(1);

        // A second metric rewrites the file with the complete set, each line
        // showing the delta to the previous metric plus the cumulative time.
        metrics.markStartupMetric("second-phase");
        const content = h.writeFileSync.mock.calls[1]?.[1];
        expect(content).toContain("test-phase:");
        expect(content).toMatch(/second-phase: \+\d+ms \(\d+ms since process creation\)/);
    });

    it("keeps the metric available even when the file write fails", () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        h.writeShouldThrow = true;

        metrics.markStartupMetric("test-phase");

        expect(metrics.getStartupMetrics().has("test-phase")).toBe(true);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("startup-metrics.log"));
    });

    it("writes no file outside dev unless TRILIUM_STARTUP_METRICS is set", async () => {
        vi.stubEnv("TRILIUM_ENV", "");
        vi.resetModules();
        metrics = await import("./startup_metrics.js");

        metrics.markStartupMetric("test-phase");
        expect(metrics.getStartupMetrics().has("test-phase")).toBe(true);
        expect(h.writeFileSync).not.toHaveBeenCalled();

        vi.stubEnv("TRILIUM_STARTUP_METRICS", "1");
        vi.resetModules();
        metrics = await import("./startup_metrics.js");

        metrics.markStartupMetric("test-phase");
        expect(h.writeFileSync).toHaveBeenCalledTimes(1);
    });

    it("accepts allowlisted renderer metrics over IPC and rejects everything else", () => {
        metrics.setupStartupMetricsIpc();
        const handler = h.ipcOn.get("report-startup-metric");
        expect(handler).toBeDefined();
        if (!handler) return;

        handler({}, "not-a-known-metric");
        handler({}, 42);
        handler({}, undefined);
        expect(metrics.getStartupMetrics().size).toBe(0);

        handler({}, "client-full-render");
        expect(metrics.getStartupMetrics().has("client-full-render")).toBe(true);
    });
});
