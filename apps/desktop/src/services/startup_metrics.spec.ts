import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

const h = vi.hoisted(() => ({
    ipcOn: new Map<string, Handler>(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    writeShouldThrow: false,
    procFiles: new Map<string, string>()
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
        readFileSync: (file: string) => {
            const content = h.procFiles.get(file);
            if (content === undefined) {
                throw new Error(`ENOENT: ${file}`);
            }
            return content;
        },
        writeFileSync: (...args: unknown[]) => {
            if (h.writeShouldThrow) {
                throw new Error("disk full");
            }
            h.writeFileSync(...args);
        }
    }
}));

const METRICS_PATH = path.join("/tmp/trilium-data/log", "startup-metrics.log");

describe("startup metrics", () => {
    let metrics: typeof import("./startup_metrics.js");

    beforeEach(async () => {
        h.ipcOn.clear();
        h.mkdirSync.mockClear();
        h.writeFileSync.mockClear();
        h.writeShouldThrow = false;
        h.procFiles.clear();
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

    it("measures from the start time in /proc on Linux, not from getCreationTime()", async () => {
        vi.useFakeTimers({ toFake: [ "Date" ] });
        vi.setSystemTime(1_000_000);
        const platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        // A creation time a second off, as Linux reports it when the boot time is rounded.
        const restoreCreationTime = stubCreationTime(1_000_000 - 6370);
        // A command name with spaces and a parenthesis, so the fields are counted from its end.
        h.procFiles.set("/proc/self/stat",
            "4242 (trilium (x) y) S 1 4242 4242 0 -1 4194304 177 0 0 0 0 0 0 0 20 0 1 0 2000 13631488 825\n");
        h.procFiles.set("/proc/uptime", "25.37 682270.12\n");
        try {
            vi.resetModules();
            metrics = await import("./startup_metrics.js");
            metrics.markStartupMetric("test-phase");

            // Started 20 s after boot, 25.37 s after boot now.
            expect(metrics.getStartupMetrics().get("test-phase")).toBe(5370);
        } finally {
            platform.mockRestore();
            restoreCreationTime();
            vi.useRealTimers();
        }
    });

    it("falls back to getCreationTime() where /proc has no start time, and outside Linux", async () => {
        vi.useFakeTimers({ toFake: [ "Date" ] });
        vi.setSystemTime(1_000_000);
        const platform = vi.spyOn(process, "platform", "get");
        const restoreCreationTime = stubCreationTime(1_000_000 - 250);
        const stat = "4242 (trilium) S 1 4242 4242 0 -1 4194304 177 0 0 0 0 0 0 0 20 0 1 0 2000 13631488 825\n";
        // The first is cut off before the `starttime` field.
        const cases = [ [ "linux", "4242 (trilium) S 1 4242 4242 0 -1\n" ], [ "darwin", stat ] ] as const;
        h.procFiles.set("/proc/uptime", "25.37 682270.12\n");
        try {
            for (const [ os, procStat ] of cases) {
                platform.mockReturnValue(os);
                h.procFiles.set("/proc/self/stat", procStat);
                vi.resetModules();
                metrics = await import("./startup_metrics.js");
                metrics.markStartupMetric("test-phase");

                expect(metrics.getStartupMetrics().get("test-phase"), os).toBe(250);
            }
        } finally {
            platform.mockRestore();
            restoreCreationTime();
            vi.useRealTimers();
        }
    });

    it("falls back to getCreationTime() where /proc cannot be read", async () => {
        vi.useFakeTimers({ toFake: [ "Date" ] });
        vi.setSystemTime(1_000_000);
        const restoreCreationTime = stubCreationTime(1_000_000 - 250);
        try {
            vi.resetModules();
            metrics = await import("./startup_metrics.js");
            metrics.markStartupMetric("test-phase");

            expect(metrics.getStartupMetrics().get("test-phase")).toBe(250);
        } finally {
            restoreCreationTime();
            vi.useRealTimers();
        }
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

/** Electron's `process.getCreationTime()`, which plain Node, where these tests run, does not have. */
function stubCreationTime(epochMs: number) {
    Object.defineProperty(process, "getCreationTime", { configurable: true, value: () => epochMs });
    return () => Reflect.deleteProperty(process, "getCreationTime");
}
