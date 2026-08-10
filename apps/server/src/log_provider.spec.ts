import { describe, expect, it, vi } from "vitest";

import ServerLogService from "./log_provider.js";

describe("ServerLogService console echo", () => {
    it("writes the entry to the log file but does not echo it under vitest", () => {
        // Every console call in a vitest worker crosses the RPC boundary to the main process. This
        // suite emits tens of thousands of log lines, and one still in flight when a worker tears
        // down fails the whole run with `Closing rpc while "onUserConsoleLog" was pending` even
        // though every test passed — so the echo is suppressed while the file write is kept.
        const log = new ServerLogService();
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
        const writes: string[] = [];
        const writeEntry = vi
            .spyOn(log as unknown as { writeEntry(entry: string): void }, "writeEntry")
            .mockImplementation((entry: string) => void writes.push(entry));

        try {
            expect(process.env.VITEST).toBeTruthy();

            log.info("hidden subtree bootstrap chatter");

            expect(consoleLog).not.toHaveBeenCalled();
            expect(writes.join("")).toContain("hidden subtree bootstrap chatter");
        } finally {
            writeEntry.mockRestore();
            consoleLog.mockRestore();
        }
    });

    it("echoes to the console outside vitest, so container logs still show activity", () => {
        const log = new ServerLogService();
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
        const writeEntry = vi
            .spyOn(log as unknown as { writeEntry(entry: string): void }, "writeEntry")
            .mockImplementation(() => {});
        const previous = process.env.VITEST;

        try {
            delete process.env.VITEST;
            log.info("server started");

            expect(consoleLog).toHaveBeenCalledWith("server started");
        } finally {
            if (previous !== undefined) {
                process.env.VITEST = previous;
            }
            writeEntry.mockRestore();
            consoleLog.mockRestore();
        }
    });
});
