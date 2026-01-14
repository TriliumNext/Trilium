import { getLog } from "@triliumnext/core/src/services/log.js";
import type { Request, Response } from "express";
import fs from "fs";
import { EOL } from "os";
import path from "path";

import cls from "./cls.js";
import config, { LOGGING_DEFAULT_RETENTION_DAYS } from "./config.js";
import dataDir from "./data_dir.js";

if (!fs.existsSync(dataDir.LOG_DIR)) {
    fs.mkdirSync(dataDir.LOG_DIR, 0o700);
}

let logFile: fs.WriteStream | undefined;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MINIMUM_FILES_TO_KEEP = 7;

let todaysMidnight!: Date;

initLogFile();

function getTodaysMidnight() {
    const now = new Date();

    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

async function cleanupOldLogFiles() {
    try {
        // Get retention days from environment or options
        let retentionDays = LOGGING_DEFAULT_RETENTION_DAYS;
        const customRetentionDays = config.Logging.retentionDays;
        if (customRetentionDays > 0) {
            retentionDays = customRetentionDays;
        } else if (customRetentionDays <= -1){
            info(`Log cleanup: keeping all log files, as specified by configuration.`);
            return;
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        // Read all log files
        const files = await fs.promises.readdir(dataDir.LOG_DIR);
        const logFiles: Array<{name: string, mtime: Date, path: string}> = [];

        for (const file of files) {
            // Security: Only process files matching our log pattern
            if (!/^trilium-\d{4}-\d{2}-\d{2}\.log$/.test(file)) {
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
                logFiles.push({ name: file, mtime: stats.mtime, path: filePath });
            } catch (err) {
                // Skip files we can't stat
            }
        }

        // Sort by modification time (oldest first)
        logFiles.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

        // Keep minimum number of files
        if (logFiles.length <= MINIMUM_FILES_TO_KEEP) {
            return;
        }

        // Delete old files, keeping minimum
        let deletedCount = 0;
        for (let i = 0; i < logFiles.length - MINIMUM_FILES_TO_KEEP; i++) {
            const file = logFiles[i];
            if (file.mtime < cutoffDate) {
                try {
                    await fs.promises.unlink(file.path);
                    deletedCount++;
                } catch (err) {
                    // Log deletion failed, but continue with others
                }
            }
        }

        if (deletedCount > 0) {
            info(`Log cleanup: deleted ${deletedCount} old log files`);
        }
    } catch (err) {
        // Cleanup failed, but don't crash the log rotation
    }
}

function initLogFile() {
    todaysMidnight = getTodaysMidnight();

    const logPath = `${dataDir.LOG_DIR}/trilium-${formatDate()}.log`;
    const isRotating = !!logFile;

    if (isRotating) {
        logFile!.end();
    }

    logFile = fs.createWriteStream(logPath, { flags: "a" });

    // Clean up old log files when rotating to a new file
    if (isRotating) {
        cleanupOldLogFiles().catch(() => {
            // Ignore cleanup errors
        });
    }
}

function checkDate(millisSinceMidnight: number) {
    if (millisSinceMidnight >= DAY) {
        initLogFile();

        millisSinceMidnight -= DAY;
    }

    return millisSinceMidnight;
}

function log(str: string | Error) {
    const bundleNoteId = cls.get("bundleNoteId");

    if (bundleNoteId) {
        str = `[Script ${bundleNoteId}] ${str}`;
    }

    let millisSinceMidnight = Date.now() - todaysMidnight.getTime();

    millisSinceMidnight = checkDate(millisSinceMidnight);

    logFile!.write(`${formatTime(millisSinceMidnight)} ${str}${EOL}`);

    console.log(str);
}

function info(message: string | Error) {
    getLog().info(message);
}

function error(message: string | Error | unknown) {
    getLog().error(message);
}

const requestBlacklist = ["/app", "/images", "/stylesheets", "/api/recent-notes"];

function request(req: Request, res: Response, timeMs: number, responseLength: number | string = "?") {
    for (const bl of requestBlacklist) {
        if (req.url.startsWith(bl)) {
            return;
        }
    }

    if (req.url.includes(".js.map") || req.url.includes(".css.map")) {
        return;
    }

    info(`${timeMs >= 10 ? "Slow " : ""  }${res.statusCode} ${req.method} ${req.url} with ${responseLength} bytes took ${timeMs}ms`);
}

function pad(num: number) {
    num = Math.floor(num);

    return num < 10 ? `0${num}` : num.toString();
}

function padMilli(num: number) {
    if (num < 10) {
        return `00${num}`;
    } else if (num < 100) {
        return `0${num}`;
    }
    return num.toString();

}

function formatTime(millisSinceMidnight: number) {
    return `${pad(millisSinceMidnight / HOUR)}:${pad((millisSinceMidnight % HOUR) / MINUTE)}:${pad((millisSinceMidnight % MINUTE) / SECOND)}.${padMilli(millisSinceMidnight % SECOND)}`;
}

function formatDate() {
    return `${pad(todaysMidnight.getFullYear())}-${pad(todaysMidnight.getMonth() + 1)}-${pad(todaysMidnight.getDate())}`;
}

export default {
    info,
    error,
    request
};
