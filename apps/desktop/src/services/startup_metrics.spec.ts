import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

const h = vi.hoisted(() => ({
    ipcOn: new Map<string, Handler>(),
    writeFileSync: vi.fn(),
    writeShouldThrow: false
}));

vi.mock("electron", () => ({
    ipcMain: {
        on: (channel: string, fn: Handler) => h.ipcOn.set(channel, fn)
    }
}));

vi.mock("fs", () => ({
    default: {
        writeFileSync: (...args: unknown[]) => {
            if (h.writeShouldThrow) {
                throw new Error("disk full");
            }
            h.writeFileSync(...args);
        }
    }
}));

describe("startup metrics", () => {
    let metrics: typeof import("./startup_metrics.js");

    beforeEach(async () => {
        h.ipcOn.clear();
        h.writeFileSync.mockClear();
        h.writeShouldThrow = false;
        vi.resetModules();
        metrics = await import("./startup_metrics.js");
    });

    it("records a metric relative to the baseline and rewrites the metrics file", () => {
        metrics.markStartupMetric("test-phase");

        const elapsed = metrics.getStartupMetrics().get("test-phase");
        expect(elapsed).toBeGreaterThanOrEqual(0);
        expect(h.writeFileSync).toHaveBeenCalledTimes(1);
        expect(h.writeFileSync).toHaveBeenCalledWith(
            "startup-metrics.log",
            expect.stringContaining("test-phase:")
        );

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
