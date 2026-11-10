import type { Request, Response } from "express";
import fs from "fs";
import { styleText } from "node:util";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import ServerLogService, { colorizeLogEntry, TRILIUM_LOGO } from "./log_provider.js";
import config, { LOGGING_DEFAULT_RETENTION_DAYS } from "./services/config.js";
import dataDir from "./services/data_dir.js";

describe("colorizeLogEntry", () => {
    const ts = paint("gray", "12:34:56.789");

    it("colours HTTP request lines like the Backend Log note", () => {
        expect(colorizeLogEntry("Slow 404 GET /api/notes/abc with 15 bytes took 12ms", "12:34:56.789")).toBe(
            `${ts} ${paint([ "bold", "yellow" ], "Slow")} ${paint([ "bold", "yellow" ], "404")} `
            + `${paint([ "bold", "blueBright" ], "GET")} ${paint("cyan", "/api/notes/abc")} with 15 bytes took 12ms`
        );

        const statuses = { 200: "green", 304: "gray", 500: "red" } as const;
        for (const [ status, color ] of Object.entries(statuses)) {
            expect(colorizeLogEntry(`${status} POST /api/x with 1 bytes took 1ms`, "12:34:56.789")).toBe(
                `${ts} ${paint([ "bold", color ], status)} ${paint([ "bold", "blueBright" ], "POST")} `
                + `${paint("cyan", "/api/x")} with 1 bytes took 1ms`
            );
        }

        // An informational status has no colour of its own.
        expect(colorizeLogEntry("101 GET /ws with 0 bytes took 1ms", "12:34:56.789")).toBe(
            `${ts} 101 ${paint([ "bold", "blueBright" ], "GET")} ${paint("cyan", "/ws")} with 0 bytes took 1ms`
        );
    });

    it("colours slow SQL queries, with and without the statement", () => {
        expect(colorizeLogEntry("Slow query took 78ms: SELECT * FROM notes", "12:34:56.789")).toBe(
            `${ts} ${paint([ "bold", "magenta" ], "Slow query")} took 78ms: ${paint("magentaBright", "SELECT * FROM notes")}`
        );
        expect(colorizeLogEntry("Slow recursive query took 45ms.", "12:34:56.789")).toBe(
            `${ts} ${paint([ "bold", "magenta" ], "Slow recursive query")} took 45ms.`
        );
    });

    it("colours searches, leaving the query in the default colour", () => {
        expect(colorizeLogEntry("Search: #book  (returned 3 items)", "12:34:56.789")).toBe(
            `${ts} ${paint([ "bold", "cyan" ], "Search")}: #book  `
            + paint("gray", "(returned 3 items)")
        );
    });

    it("colours a whole error entry red, stack trace included", () => {
        for (const message of [ "ERROR: boom\n    at foo (bar.js:1:1)", "JS Error: boom\r\nStack: at x" ]) {
            expect(colorizeLogEntry(message, "12:34:56.789")).toBe(`${ts} ${paint("red", message)}`);
        }
    });

    it("colours the startup intro without timestamping the logo or blank lines", () => {
        expect(colorizeLogEntry(`\n${TRILIUM_LOGO} 0.99.1\n`, "12:34:56.789")).toBe(
            `\n${paint([ "bold", "green" ], TRILIUM_LOGO)} ${paint("gray", "0.99.1")}\n`
        );
        expect(colorizeLogEntry("", "12:34:56.789")).toBe("");
        expect(colorizeLogEntry("📦 Versions:    app=0.99.1 db=233", "12:34:56.789")).toBe(
            `${ts} ${paint("gray", "📦 Versions:")}    app=0.99.1 db=233`
        );

        const warning = "WARNING: Backend script execution is ENABLED.";
        expect(colorizeLogEntry(warning, "12:34:56.789")).toBe(`${ts} ${paint("yellow", warning)}`);
    });

    it("leaves other entries uncoloured", () => {
        for (const message of [ "JS Info: hello", "Becca (note cache) load took 120ms", "[Script abc] 200 GET /x" ]) {
            expect(colorizeLogEntry(message, "12:34:56.789")).toBe(`${ts} ${message}`);
        }
    });
});

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

            // A colour terminal gets the timestamped, coloured entry instead.
            (log as unknown as { colorizeConsole: boolean }).colorizeConsole = true;
            log.info("500 GET /api/tree with 1 bytes took 3ms");

            expect(consoleLog).toHaveBeenLastCalledWith(expect.stringMatching(
                /^\x1b\[90m\d{2}:\d{2}:\d{2}\.\d{3}\x1b\[39m .*\x1b\[31m.*500/
            ));
        } finally {
            if (previous !== undefined) {
                process.env.VITEST = previous;
            }
            writeEntry.mockRestore();
            consoleLog.mockRestore();
        }
    });
});

describe("ServerLogService request logging", () => {
    it("keeps polling routes out of the log, the docker healthcheck included", () => {
        const log = new ServerLogService();
        const writes: string[] = [];
        const writeEntry = vi
            .spyOn(log as unknown as { writeEntry(entry: string): void }, "writeEntry")
            .mockImplementation((entry: string) => void writes.push(entry));

        try {
            const polled = [
                "/api/health-check", "/api/recent-notes", "/api/backend-log",
                "/app/index.js", "/images/icon.png", "/stylesheets/theme.css",
                "/assets/bundle.js.map", "/assets/theme.css.map"
            ];

            for (const url of polled) {
                logRequest(log, url);
            }

            expect(writes).toEqual([]);

            // Anything else is still recorded, so the filter cannot swallow real traffic.
            logRequest(log, "/api/notes/root");

            expect(writes.join("")).toContain("200 GET /api/notes/root");
        } finally {
            writeEntry.mockRestore();
        }
    });

    it("writes the summary a route leaves in res.locals after the request's own line", () => {
        const log = new ServerLogService();
        const writes: string[] = [];
        const writeEntry = vi
            .spyOn(log as unknown as { writeEntry(entry: string): void }, "writeEntry")
            .mockImplementation((entry: string) => void writes.push(entry));

        try {
            const summary = "Search: #book  (returned 3 items)";
            logRequest(log, "/api/search?searchString=%23book", summary);

            expect(writes).toHaveLength(2);
            expect(writes[0]).toContain("200 GET /api/search?searchString=%23book with 15 bytes");
            expect(writes[1]).toContain(" Search: #book  (returned 3 items)");
        } finally {
            writeEntry.mockRestore();
        }
    });

    it("marks a request that took 10ms or more as slow", () => {
        const log = new ServerLogService();
        const writes: string[] = [];
        const writeEntry = vi
            .spyOn(log as unknown as { writeEntry(entry: string): void }, "writeEntry")
            .mockImplementation((entry: string) => void writes.push(entry));
        const req = { url: "/api/tree", method: "GET" } as unknown as Request;
        const res = { statusCode: 200, locals: {} } as unknown as Response;

        try {
            log.request(req, res, 9);
            log.request(req, res, 10);

            expect(writes[0]).toMatch(/ 200 GET \/api\/tree with \? bytes took 9ms/);
            expect(writes[1]).toMatch(/ Slow 200 GET \/api\/tree with \? bytes took 10ms/);
        } finally {
            writeEntry.mockRestore();
        }
    });
});

function logRequest(log: ServerLogService, url: string, logSummary?: string) {
    const req = { url, method: "GET" } as unknown as Request;
    const res = { statusCode: 200, locals: { logSummary } } as unknown as Response;

    log.request(req, res, 1, 15);
}

function paint(format: Parameters<typeof styleText>[0], text: string) {
    return styleText(format, text, { validateStream: false });
}

describe("ServerLogService log files", () => {
    /** The protected file operations `FileBasedLogService` drives rotation and cleanup through. */
    interface LogFileOps {
        readLogFile(fileName: string): string | null;
        listLogFiles(): Promise<{ name: string; mtime: Date }[]>;
        deleteLogFile(fileName: string): Promise<void>;
        getRetentionDays(): number;
    }

    function fileOps() {
        return new ServerLogService() as unknown as LogFileOps;
    }

    afterEach(() => vi.restoreAllMocks());

    it("reads a missing log file as null", () => {
        expect(fileOps().readLogFile("trilium-1999-01-01.log")).toBeNull();
    });

    it("ends the open log stream once, and drops entries written after it closed", () => {
        const log = new ServerLogService();
        const internals = log as unknown as {
            logFile: fs.WriteStream | undefined;
            closeLogFile(): void;
            writeEntry(entry: string): void;
        };
        const stream = internals.logFile;
        expect(stream).toBeDefined();
        const end = vi.spyOn(stream as fs.WriteStream, "end");
        const write = vi.spyOn(stream as fs.WriteStream, "write");

        internals.closeLogFile();
        internals.closeLogFile();
        internals.writeEntry("after close");

        expect(end).toHaveBeenCalledOnce();
        expect(write).not.toHaveBeenCalled();
        expect(internals.logFile).toBeUndefined();
    });

    it("lists only Trilium's daily log files that can be stat'ed", async () => {
        const ops = fileOps();
        const mtime = new Date(2024, 0, 1);
        vi.spyOn(fs.promises, "readdir").mockResolvedValue([
            "trilium-2024-01-01.log", "notes.txt", "trilium-2024-01-02.log.bak", "trilium-2024-01-03.log"
        ] as never);
        vi.spyOn(fs.promises, "stat").mockImplementation(async (filePath) => {
            if (String(filePath).endsWith("trilium-2024-01-03.log")) {
                throw new Error("EACCES");
            }
            return { mtime } as fs.Stats;
        });

        expect(await ops.listLogFiles()).toEqual([ { name: "trilium-2024-01-01.log", mtime } ]);
    });

    it("deletes a file inside the log directory, and refuses a name that escapes it", async () => {
        const ops = fileOps();
        const unlink = vi.spyOn(fs.promises, "unlink").mockResolvedValue();

        await ops.deleteLogFile("trilium-2024-01-01.log");
        await ops.deleteLogFile(path.join("..", "document.db"));

        expect(unlink).toHaveBeenCalledOnce();
        expect(path.resolve(String(unlink.mock.calls[0][0]))).toBe(path.resolve(dataDir.LOG_DIR, "trilium-2024-01-01.log"));
    });

    it("keeps logs for the configured number of days, or the default when unset or zero", () => {
        const ops = fileOps();
        const original = config.Logging.retentionDays;

        try {
            config.Logging.retentionDays = 14;
            expect(ops.getRetentionDays()).toBe(14);

            config.Logging.retentionDays = -1;
            expect(ops.getRetentionDays()).toBe(-1);

            config.Logging.retentionDays = 0;
            expect(ops.getRetentionDays()).toBe(LOGGING_DEFAULT_RETENTION_DAYS);

            (config.Logging as { retentionDays: number | undefined }).retentionDays = undefined;
            expect(ops.getRetentionDays()).toBe(LOGGING_DEFAULT_RETENTION_DAYS);
        } finally {
            config.Logging.retentionDays = original;
        }
    });
});
