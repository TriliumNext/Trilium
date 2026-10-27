import { FileBasedLogService, type LogFileInfo, type ResponseLocals } from "@triliumnext/core";
import type { Request, Response } from "express";
import fs from "fs";
import { EOL } from "os";
import path from "path";
import { styleText } from "util";

import config, { LOGGING_DEFAULT_RETENTION_DAYS } from "./services/config.js";
import dataDir from "./services/data_dir.js";

const LOG_FILE_PATTERN = /^trilium-\d{4}-\d{2}-\d{2}\.log$/;

/** The ASCII-art banner `www.ts` prints at startup, followed by the version. */
export const TRILIUM_LOGO = `\
 _____     _ _ _
|_   _| __(_) (_)_   _ _ __ ___   | \\ | | ___ | |_ ___  ___
  | || '__| | | | | | | '_ \` _ \\  |  \\| |/ _ \\| __/ _ \\/ __|
  | || |  | | | | |_| | | | | | | | |\\  | (_) | ||  __/\\__ \\
  |_||_|  |_|_|_|\\__,_|_| |_| |_| |_| \\_|\\___/ \\__\\___||___/`;

const requestBlacklist = [
    "/app",
    "/images",
    "/stylesheets",
    "/api/recent-notes",
    "/api/backend-log",
    // Docker probes this every 30 seconds, and the container runtime captures the echo too.
    "/api/health-check"
];

export default class ServerLogService extends FileBasedLogService {
    private logFile: fs.WriteStream | undefined;
    private colorizeConsole = supportsColor(process.stdout);

    constructor() {
        super();
        // Server uses sync initialization since Node.js fs operations are sync
        this.ensureLogDirectory();
        this.todaysMidnight = this.getTodaysMidnight();
        this.openLogFile(this.getLogFileName());
    }

    // ==================== Abstract Method Implementations ====================

    protected override get eol(): string {
        return EOL;
    }

    protected override ensureLogDirectory(): void {
        fs.mkdirSync(dataDir.LOG_DIR, { recursive: true, mode: 0o700 });
    }

    protected override openLogFile(fileName: string): void {
        const logPath = path.join(dataDir.LOG_DIR, fileName);
        this.logFile = fs.createWriteStream(logPath, { flags: "a" });
    }

    protected override closeLogFile(): void {
        if (this.logFile) {
            this.logFile.end();
            this.logFile = undefined;
        }
    }

    protected override writeEntry(entry: string): void {
        this.logFile?.write(entry);
    }

    protected override echoToConsole(str: string, timestamp: string): void {
        // Under vitest every console call is forwarded to the main process over the worker RPC, and
        // this suite emits tens of thousands of them — the hidden-subtree bootstrap alone logs a
        // line per created note, for each of the ~60 spec files that build the app. A call still in
        // flight when its worker tears down surfaces as an unhandled
        // `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`, which fails
        // the run even though every test passed. The entry is still written to the log file, so
        // nothing that reads the log is affected.
        if (process.env.VITEST) {
            return;
        }
        super.echoToConsole(this.colorizeConsole ? colorizeLogEntry(str, timestamp) : str, timestamp);
    }

    protected override readLogFile(fileName: string): string | null {
        const filePath = path.join(dataDir.LOG_DIR, fileName);
        try {
            return fs.readFileSync(filePath, "utf8");
        } catch {
            return null;
        }
    }

    protected override async listLogFiles(): Promise<LogFileInfo[]> {
        const files = await fs.promises.readdir(dataDir.LOG_DIR);
        const logFiles: LogFileInfo[] = [];

        for (const file of files) {
            if (!LOG_FILE_PATTERN.test(file)) {
                continue;
            }

            const filePath = path.join(dataDir.LOG_DIR, file);

            // Security: Verify path stays within LOG_DIR
            const resolvedPath = path.resolve(filePath);
            const resolvedLogDir = path.resolve(dataDir.LOG_DIR);
            if (!resolvedPath.startsWith(resolvedLogDir + path.sep)) {
                continue;
            }

            try {
                const stats = await fs.promises.stat(filePath);
                logFiles.push({ name: file, mtime: stats.mtime });
            } catch {
                // Skip files we can't stat
            }
        }

        return logFiles;
    }

    protected override async deleteLogFile(fileName: string): Promise<void> {
        const filePath = path.join(dataDir.LOG_DIR, fileName);

        // Security: Verify path stays within LOG_DIR
        const resolvedPath = path.resolve(filePath);
        const resolvedLogDir = path.resolve(dataDir.LOG_DIR);
        if (!resolvedPath.startsWith(resolvedLogDir + path.sep)) {
            return;
        }

        await fs.promises.unlink(filePath);
    }

    protected override getRetentionDays(): number {
        const customRetentionDays = config.Logging.retentionDays;
        if (customRetentionDays !== undefined && customRetentionDays !== 0) {
            return customRetentionDays;
        }
        return LOGGING_DEFAULT_RETENTION_DAYS;
    }

    // ==================== Server-Specific Methods ====================

    request(req: Request, res: Response, timeMs: number, responseLength: number | string = "?"): void {
        for (const bl of requestBlacklist) {
            if (req.url.startsWith(bl)) {
                return;
            }
        }

        if (req.url.includes(".js.map") || req.url.includes(".css.map")) {
            return;
        }

        this.info(`${timeMs >= 10 ? "Slow " : ""}${res.statusCode} ${req.method} ${req.url} with ${responseLength} bytes took ${timeMs}ms`);

        const { logSummary }: ResponseLocals = res.locals;
        if (logSummary) {
            this.info(logSummary);
        }
    }
}

type Style = Parameters<typeof styleText>[0];

// The styles approximate the `--log-*` palette of `trilium_log_highlighter.ts` in
// `packages/codemirror`, and the patterns match the same entries; keep the two in step.
const TIMESTAMP_STYLE: Style = "gray";
const SLOW_STYLE: Style = [ "bold", "yellow" ];
const VERB_STYLE: Style = [ "bold", "blueBright" ];
const URL_STYLE: Style = "cyan";
const QUERY_VERB_STYLE: Style = [ "bold", "magenta" ];
const SQL_STYLE: Style = "magentaBright";
const SEARCH_STYLE: Style = [ "bold", "cyan" ];
const ERROR_STYLE: Style = "red";
const WARNING_STYLE: Style = "yellow";
// The green of the leaves in `icon-color.svg`.
const LOGO_STYLE: Style = [ "bold", "green" ];
const MUTED_STYLE: Style = "gray";
const STATUS_STYLES: Record<string, Style> = {
    "2": [ "bold", "green" ],
    "3": [ "bold", "gray" ],
    "4": [ "bold", "yellow" ],
    "5": [ "bold", "red" ]
};

const HTTP_REQUEST = /^(Slow )?(\d{3}) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+)/;
const SLOW_QUERY = /^(Slow (?:recursive )?query)( took \d+ms)(?:(: )(.+))?/;
const SEARCH = /^(Search): .* {2}(\(returned \d+ items\))$/;
const ERROR_ENTRY = /^(?:JS Error|ERROR):/;
const WARNING_ENTRY = /^WARNING:/;
// The `📦 Versions:    …` rows of the startup intro.
const INTRO_ROW = /^\p{Extended_Pictographic}️? [^:]+:/u;
const LOGO_PREFIX = `\n${TRILIUM_LOGO} `;

/** Prefixes `message` with its `timestamp` and colours both the way the Backend Log note does. */
export function colorizeLogEntry(message: string, timestamp: string): string {
    // The logo and the blank line after the intro start their own lines.
    if (!message || message.startsWith("\n")) {
        return colorizeMessage(message);
    }
    return `${paint(TIMESTAMP_STYLE, timestamp)} ${colorizeMessage(message)}`;
}

function colorizeMessage(message: string): string {
    const http = HTTP_REQUEST.exec(message);
    if (http) {
        const [ matched, slowPrefix, status, verb, url ] = http;
        return [
            slowPrefix ? `${paint(SLOW_STYLE, "Slow")} ` : "",
            STATUS_STYLES[status[0]] ? paint(STATUS_STYLES[status[0]], status) : status,
            ` ${paint(VERB_STYLE, verb)} ${paint(URL_STYLE, url)}`,
            message.slice(matched.length)
        ].join("");
    }

    const query = SLOW_QUERY.exec(message);
    if (query) {
        const [ matched, queryVerb, took, separator = "", sql ] = query;
        return [
            paint(QUERY_VERB_STYLE, queryVerb),
            took,
            separator,
            sql ? paint(SQL_STYLE, sql) : "",
            message.slice(matched.length)
        ].join("");
    }

    const search = SEARCH.exec(message);
    if (search) {
        const [ , searchVerb, count ] = search;
        return paint(SEARCH_STYLE, searchVerb)
            + message.slice(searchVerb.length, -count.length)
            + paint(MUTED_STYLE, count);
    }

    if (message.startsWith(LOGO_PREFIX)) {
        const version = message.slice(LOGO_PREFIX.length).trimEnd();
        return `\n${paint(LOGO_STYLE, TRILIUM_LOGO)} ${paint(MUTED_STYLE, version)}\n`;
    }

    const introRow = INTRO_ROW.exec(message);
    if (introRow) {
        return paint(MUTED_STYLE, introRow[0]) + message.slice(introRow[0].length);
    }

    if (ERROR_ENTRY.test(message)) {
        return paint(ERROR_STYLE, message);
    }
    return WARNING_ENTRY.test(message) ? paint(WARNING_STYLE, message) : message;
}

function paint(style: Style, text: string): string {
    return styleText(style, text, { validateStream: false });
}

/** Asks `styleText` itself, so a TTY check, `NO_COLOR` and `FORCE_COLOR` all apply as Node rules. */
function supportsColor(stream: NodeJS.WriteStream): boolean {
    return styleText("red", "x", { stream }) !== "x";
}
