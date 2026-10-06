/*
 * This file resolves trilium data path in this order of priority:
 * - case A) if TRILIUM_DATA_DIR environment variable exists, then its value is used as the path
 * - case B) if "trilium-data" dir exists directly in the home dir, then it is used
 * - case C) based on OS convention, if the "app data directory" exists, we'll use or create "trilium-data" directory there
 * - case D) as a fallback if the previous step fails, we'll use home dir
 */

import fs from "node:fs";
import os from "node:os";
import { dirname, join as pathJoin } from "node:path";

const DIR_NAME = "trilium-data";
const FOLDER_PERMISSIONS = 0o700;

export function getTriliumDataDir(dataDirName: string) {
    // case A
    if (process.env.TRILIUM_DATA_DIR) {
        createDirIfNotExisting(process.env.TRILIUM_DATA_DIR);
        return process.env.TRILIUM_DATA_DIR;
    }

    // case B
    const homePath = pathJoin(os.homedir(), dataDirName);
    if (fs.existsSync(homePath)) {
        return homePath;
    }

    // case C
    const platformAppDataDir = getPlatformAppDataDir(os.platform(), process.env.APPDATA);
    if (platformAppDataDir && fs.existsSync(platformAppDataDir)) {
        const appDataDirPath = pathJoin(platformAppDataDir, dataDirName);
        createDirIfNotExisting(appDataDirPath);
        return appDataDirPath;
    }

    // case D
    createDirIfNotExisting(homePath);
    return homePath;
}

export function getDataDirs(TRILIUM_DATA_DIR: string) {
    const dataDirs = {
        TRILIUM_DATA_DIR,
        DOCUMENT_PATH: process.env.TRILIUM_DOCUMENT_PATH || pathJoin(TRILIUM_DATA_DIR, "document.db"),
        BACKUP_DIR: process.env.TRILIUM_BACKUP_DIR || pathJoin(TRILIUM_DATA_DIR, "backup"),
        LOG_DIR: process.env.TRILIUM_LOG_DIR || pathJoin(TRILIUM_DATA_DIR, "log"),
        TMP_DIR: process.env.TRILIUM_TMP_DIR || pathJoin(TRILIUM_DATA_DIR, "tmp"),
        ANONYMIZED_DB_DIR: process.env.TRILIUM_ANONYMIZED_DB_DIR || pathJoin(TRILIUM_DATA_DIR, "anonymized-db"),
        CONFIG_INI_PATH: process.env.TRILIUM_CONFIG_INI_PATH || pathJoin(TRILIUM_DATA_DIR, "config.ini"),
        OCR_CACHE_DIR: process.env.TRILIUM_OCR_CACHE_DIR || pathJoin(TRILIUM_DATA_DIR, "ocr-cache")
    } as const;

    createDirIfNotExisting(dataDirs.TMP_DIR, TRILIUM_DATA_DIR);
    checkExistingEntries(dataDirs);

    Object.freeze(dataDirs);
    return dataDirs;
}

/**
 * Stops startup when entries left in the data directory cannot be used, typically because
 * an earlier run as another user (root, `sudo`, a container without `--user`) owns them.
 * Otherwise SQLite opens such a database read-only and only fails at the first write.
 */
function checkExistingEntries(dataDirs: ReturnType<typeof getDataDirs>) {
    const { R_OK, W_OK, X_OK } = fs.constants;
    const inDataDir = (name: string) => pathJoin(dataDirs.TRILIUM_DATA_DIR, name);
    const required: [ path: string, mode: number ][] = [
        [ dataDirs.DOCUMENT_PATH, R_OK | W_OK ],
        [ `${dataDirs.DOCUMENT_PATH}-wal`, R_OK | W_OK ],
        [ `${dataDirs.DOCUMENT_PATH}-shm`, R_OK | W_OK ],
        [ dataDirs.LOG_DIR, R_OK | W_OK | X_OK ],
        [ dataDirs.TMP_DIR, R_OK | W_OK | X_OK ],
        [ dataDirs.BACKUP_DIR, R_OK | W_OK | X_OK ],
        [ dataDirs.ANONYMIZED_DB_DIR, R_OK | W_OK | X_OK ],
        [ dataDirs.OCR_CACHE_DIR, R_OK | W_OK | X_OK ],
        [ dataDirs.CONFIG_INI_PATH, R_OK ],
        [ inDataDir("session_secret.txt"), R_OK ]
    ];

    const unusable = required.filter(([ path, mode ]) => {
        if (!fs.existsSync(path)) {
            return false;
        }
        try {
            fs.accessSync(path, mode);
            return false;
        } catch {
            return true;
        }
    });
    if (!unusable.length) {
        return;
    }

    const dataDir = dataDirs.TRILIUM_DATA_DIR;
    const user = getProcessUser();
    stopStartup([
        `Trilium cannot start because it cannot use some of the files in its data directory, ${dataDir}.`,
        "",
        user ? `Trilium runs as UID:GID ${user}, but:` : "The user running Trilium cannot use them:",
        ...unusable.map(([ path ]) => `  - ${relativeToDir(path, dataDir)} ${describeOwnership(path)}`),
        "",
        ...(user
            ? [ "To fix this, give the data directory and everything in it to that user:", `  sudo chown -R ${user} ${dataDir}` ]
            : [ "To fix this, give the user running Trilium full control of the data directory and everything in it." ]),
        ...containerHint()
    ].join("\n"));
}

export function getPlatformAppDataDir(platform: ReturnType<typeof os.platform>, ENV_APPDATA_DIR: string | undefined = process.env.APPDATA) {
    switch (true) {
        case platform === "win32" && !!ENV_APPDATA_DIR:
            return ENV_APPDATA_DIR;

        case platform === "linux":
            return `${os.homedir()}/.local/share`;

        case platform === "darwin":
            return `${os.homedir()}/Library/Application Support`;

        default:
            // if OS is not recognized
            return null;
    }
}

/**
 * Stops startup with `message`. The server prints it and exits, since a stack trace adds nothing.
 * Electron shows an uncaught main-process error in a dialog, which is the only place a desktop
 * user sees it, so there the message is thrown.
 */
function stopStartup(message: string, cause?: unknown): never {
    if (process.versions.electron) {
        throw new Error(message, { cause });
    }
    console.error(`\n${message}\n`);
    process.exit(1);
}

/** Returns the process's `UID:GID`, or `undefined` on Windows, which has neither. */
function getProcessUser() {
    if (process.getuid && process.getgid) {
        return `${process.getuid()}:${process.getgid()}`;
    }
}

/**
 * Completes a sentence about `path`: "is owned by UID:GID 1000:1000 with permissions 700". Windows
 * has no UIDs, and `fs.statSync()` reports 0 there, so it only says whether a file is read-only.
 */
function describeOwnership(path: string) {
    try {
        const stats = fs.statSync(path);
        if (!getProcessUser()) {
            return stats.isFile() && !(stats.mode & 0o200) ? "is read-only" : "cannot be accessed";
        }
        return `is owned by UID:GID ${stats.uid}:${stats.gid} with permissions ${(stats.mode & 0o777).toString(8)}`;
    } catch {
        return "cannot be inspected";
    }
}

/**
 * The paths in a message are the ones Trilium sees, which in a container are not the host paths a
 * fix has to be applied to. Desktop never runs in a container, so its dialog leaves this out.
 */
function containerHint() {
    if (process.versions.electron) {
        return [];
    }
    return [
        "",
        "In Docker, the paths above are inside the container. Apply the fix to the directory mounted",
        "there from the host, or start the container without --user."
    ];
}

function relativeToDir(path: string, dir: string) {
    const separator = path.charAt(dir.length);
    return path.startsWith(dir) && (separator === "/" || separator === "\\") ? path.slice(dir.length + 1) : path;
}

function failWithPermissionError(targetPath: fs.PathLike, dataDir: string | undefined, cause: unknown): never {
    stopStartup(describePermissionError(targetPath.toString(), dataDir), cause);
}

/**
 * Explains why `path` cannot be created. `dataDir` is the data directory `path` belongs in, or
 * `undefined` when `path` is the data directory itself.
 */
function describePermissionError(path: string, dataDir: string | undefined) {
    const parent = dirname(path);
    const blockedDir = findUnreachableAncestor(parent);
    const user = getProcessUser();
    const subject = user ? `Trilium runs as UID:GID ${user}, which` : "The user running Trilium";

    let lines: string[];
    if (blockedDir && blockedDir !== dataDir) {
        lines = [
            `Trilium cannot start because it cannot reach ${path}.`,
            "",
            `${subject} cannot enter ${blockedDir}: it ${describeOwnership(blockedDir)}.`,
            "",
            ...(user
                ? [ "To fix this, let that user enter it:", `  sudo chmod o+x ${blockedDir}` ]
                : [ `To fix this, let the user running Trilium enter ${blockedDir}.` ]),
            "Or set TRILIUM_DATA_DIR to a directory that user can reach."
        ];
    } else if (dataDir && (blockedDir === dataDir || parent === dataDir)) {
        // A data directory the user cannot enter needs the same fix as one it cannot write to.
        const access = blockedDir ? "use" : "write to";
        lines = [
            `Trilium cannot start because it cannot create ${path}.`,
            "",
            `${subject} cannot ${access} its data directory, ${dataDir}: it ${describeOwnership(dataDir)}.`,
            "",
            ...(user
                ? [ "To fix this, give the data directory and everything in it to that user:", `  sudo chown -R ${user} ${dataDir}` ]
                : [ "To fix this, give the user running Trilium full control of the data directory." ]),
            "Or set TRILIUM_DATA_DIR to a directory that user owns."
        ];
    } else {
        lines = [
            `Trilium cannot start because it cannot create ${path}.`,
            "",
            `${subject} cannot write to ${parent}: it ${describeOwnership(parent)}.`,
            "",
            ...(user
                ? [ "To fix this, create the directory for that user:", `  sudo mkdir -p ${path} && sudo chown ${user} ${path}` ]
                : [ "To fix this, create the directory and give the user running Trilium full control of it." ])
        ];
        if (!dataDir) {
            lines.push("Or set TRILIUM_DATA_DIR to a directory that user owns.");
        }
    }
    return [ ...lines, ...containerHint() ].join("\n");
}

/**
 * Returns the highest directory on the way to `dir` that the process cannot enter. Every
 * directory below it fails the same check, so it is the one whose permissions need fixing.
 */
function findUnreachableAncestor(dir: string) {
    let blocked: string | undefined;
    for (let current = dir; ; current = dirname(current)) {
        try {
            fs.accessSync(current, fs.constants.X_OK);
        } catch {
            blocked = current;
        }
        if (dirname(current) === current) {
            return blocked;
        }
    }
}

/** `dataDir` is the data directory `path` belongs in, or `undefined` when `path` is the data directory. */
function createDirIfNotExisting(path: fs.PathLike, dataDir?: string) {
    try {
        fs.mkdirSync(path, FOLDER_PERMISSIONS);
    } catch (err: unknown) {
        if (err && typeof err === "object" && "code" in err) {
            const code = (err as { code: string }).code;

            if (code === "EACCES") {
                failWithPermissionError(path, dataDir, err);
            } else if (code === "EEXIST") {
                // Directory already exists - verify it's actually a directory
                try {
                    if (fs.statSync(path).isDirectory()) {
                        return;
                    }
                } catch {
                    // If we can't stat it, fall through to re-throw original error
                }
            }
        }
        throw err;
    }
}

const TRILIUM_DATA_DIR = getTriliumDataDir(DIR_NAME);
const dataDirs = getDataDirs(TRILIUM_DATA_DIR);

export default dataDirs;
