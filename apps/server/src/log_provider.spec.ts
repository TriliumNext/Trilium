import type { Request, Response } from "express";
import { styleText } from "node:util";
import { describe, expect, it, vi } from "vitest";

import ServerLogService, { colorizeLogEntry, TRILIUM_LOGO } from "./log_provider.js";

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
});

function logRequest(log: ServerLogService, url: string, logSummary?: string) {
    const req = { url, method: "GET" } as unknown as Request;
    const res = { statusCode: 200, locals: { logSummary } } as unknown as Response;

    log.request(req, res, 1, 15);
}

function paint(format: Parameters<typeof styleText>[0], text: string) {
    return styleText(format, text, { validateStream: false });
}
