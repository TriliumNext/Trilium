import { AnonymizedDbResponse, BUILTIN_ATTRIBUTES, DatabaseAnonymizeResponse } from "@triliumnext/commons";
import { date_utils as dateUtils } from "@triliumnext/core";
import Database from "better-sqlite3";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";

import dataDir from "./data_dir.js";
import sql from "./sql.js";

/** A copy is written under this name and renamed once it is scrubbed. The listing refuses it. */
const STAGING_NAME = /^anonymizing-[0-9a-f]{12}\.tmp$/;
const JOURNAL_SUFFIXES = [ "-journal", "-wal", "-shm" ];
/** How long a staging file must stay unchanged before a sweep deletes it. */
const STAGING_MAX_AGE_MS = 60 * 60 * 1000;

/** The staging files that a copy of this process is writing. */
const stagingInProgress = new Set<string>();

/**
 * Blanks what neither kind of copy must hold: the password, the document and sync secrets, the
 * second factor, the enrolled OpenID account and the sessions with their tokens.
 */
const CREDENTIALS_SCRIPT = /*sql*/`
UPDATE options SET value = 'anonymized' WHERE name IN
                    ('documentId', 'documentSecret', 'encryptedDataKey',
                    'passwordVerificationHash', 'passwordVerificationSalt',
                    'passwordDerivedKeySalt', 'username', 'syncServerHost', 'syncProxy')
                    AND value != '';
UPDATE options SET value = '' WHERE name IN
                    ('totpEncryptedSecret', 'totpEncryptionSalt', 'totpVerificationHash',
                    'recoveryCodesEncrypted', 'recoveryCodeSecurityKey',
                    'recoveryCodeInitialVector');
UPDATE options SET value = 'false' WHERE name = 'encryptedRecoveryCodes';
DELETE FROM user_data;
DELETE FROM sessions;
`;

/**
 * Deletes every notification with what belongs to it, and the entity changes of the four tables
 * that sync: the change of an erased notification keeps its time and the hash of its ID. Blanks
 * the owned labels of channel notes, where a channel keeps its settings.
 */
const NOTIFICATIONS_SCRIPT = /*sql*/`
UPDATE attributes SET value = '' WHERE type = 'label' AND noteId IN
                    (SELECT noteId FROM attributes WHERE type = 'label'
                    AND name IN ('notificationChannel', 'disabled:notificationChannel'));
DELETE FROM notifications;
DELETE FROM notification_marks;
DELETE FROM notification_private_texts;
DELETE FROM notification_channel_records;
DELETE FROM notification_deliveries;
DELETE FROM entity_changes WHERE entityName IN ('notifications', 'notification_marks',
                    'notification_private_texts', 'notification_channel_records');
`;

function getFullAnonymizationScript() {
    // we want to delete all non-builtin attributes because they can contain sensitive names and values
    // on the other hand builtin/system attrs should not contain any sensitive info -- except for the
    // ones whose name is system-defined but whose value is authored by the user (`#shareCredentials`,
    // `#geolocation`, ...), which `hasUserValue` marks so they get scrubbed like any other attribute
    const builtinAttrNames = BUILTIN_ATTRIBUTES.filter((attr) => !("hasUserValue" in attr && attr.hasUserValue))
        .map((attr) => `'${attr.name}'`)
        .join(", ");

    const anonymizeScript = /*sql*/`\
UPDATE etapi_tokens SET tokenHash = 'API token hash value';
UPDATE notes SET title = 'title' WHERE title NOT IN ('root', '_hidden', '_share');
UPDATE blobs SET content = 'text' WHERE content IS NOT NULL;
UPDATE revisions SET title = 'title';
UPDATE attachments SET title = 'title';

UPDATE attributes SET name = 'name', value = 'value' WHERE type = 'label' AND name NOT IN(${builtinAttrNames});
UPDATE attributes SET name = 'name' WHERE type = 'relation' AND name NOT IN (${builtinAttrNames});
UPDATE branches SET prefix = 'prefix' WHERE prefix IS NOT NULL AND prefix != 'recovered';
${CREDENTIALS_SCRIPT}
${NOTIFICATIONS_SCRIPT}
VACUUM;
`;

    return anonymizeScript;
}

function getLightAnonymizationScript() {
    // VACUUM drops the free pages, which hold the old text of every value replaced here and of what
    // the live database removed before the copy.
    return /*sql*/`UPDATE blobs SET content = 'text' WHERE content IS NOT NULL AND blobId NOT IN (
                SELECT blobId FROM notes WHERE mime IN ('application/javascript;env=backend', 'application/javascript;env=frontend')
            UNION ALL
                SELECT blobId FROM revisions WHERE mime IN ('application/javascript;env=backend', 'application/javascript;env=frontend')
            );
${CREDENTIALS_SCRIPT}
${NOTIFICATIONS_SCRIPT}
VACUUM;`;
}

/**
 * Copies the database into a staging file of its own, scrubs it, and only then renames it to its
 * final name. Both kinds of copy and the command line entry (`anonymize.ts`) go through here.
 */
async function createAnonymizedCopy(type: "full" | "light") {
    if (!["full", "light"].includes(type)) {
        throw new Error(`Unrecognized anonymization type '${type}'`);
    }

    const directory = getDirectory();
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    removeLeftoverStagingFiles();

    const stagingFile = path.join(directory, `anonymizing-${randomSuffix()}.tmp`);
    stagingInProgress.add(stagingFile);
    try {
        await sql.copyDatabase(stagingFile);
        runScript(stagingFile, type === "light"
            ? getLightAnonymizationScript()
            : getFullAnonymizationScript());

        // The random part gives two copies of the same second different names:
        // `getDateTimeForFile()` has whole seconds, and the command line entry is another process.
        const anonymizedFile = path.join(directory,
            `anonymized-${type}-${dateUtils.getDateTimeForFile()}-${randomSuffix()}.db`);
        fs.renameSync(stagingFile, anonymizedFile);

        return {
            success: true,
            anonymizedFilePath: anonymizedFile
        } satisfies DatabaseAnonymizeResponse;
    } catch (e) {
        removeStagingFile(stagingFile);
        throw e;
    } finally {
        stagingInProgress.delete(stagingFile);
    }
}

function runScript(databaseFile: string, script: string) {
    const db = new Database(databaseFile);
    try {
        // A rollback journal leaves no `-wal` file beside the copy, so the rename moves all of it.
        db.pragma("journal_mode = DELETE");
        db.exec(script);
    } finally {
        db.close();
    }
}

/**
 * Deletes the staging files that no copy of this process is writing and that have not changed for
 * an hour, with their journals. Runs at start and before every copy; a younger one can belong to a
 * copy of another process, such as the command line entry.
 */
function removeLeftoverStagingFiles() {
    const directory = getDirectory();
    let fileNames: string[];
    try {
        fileNames = fs.readdirSync(directory);
    } catch {
        return;
    }

    for (const fileName of fileNames.filter((name) => STAGING_NAME.test(name))) {
        const stagingFile = path.join(directory, fileName);
        if (stagingInProgress.has(stagingFile)) {
            continue;
        }

        // Judged by the newest of the group: a copy in WAL mode writes to its `-wal` file.
        const modified = [ "", ...JOURNAL_SUFFIXES ].map((suffix) =>
            fs.statSync(`${stagingFile}${suffix}`, { throwIfNoEntry: false })?.mtimeMs ?? 0);
        if (Date.now() - Math.max(...modified) >= STAGING_MAX_AGE_MS) {
            removeStagingFile(stagingFile);
        }
    }
}

function removeStagingFile(stagingFile: string) {
    for (const suffix of [ "", ...JOURNAL_SUFFIXES ]) {
        try {
            fs.rmSync(`${stagingFile}${suffix}`, { force: true });
        } catch {
            // Open in another process; a later sweep removes it.
        }
    }
}

function getExistingAnonymizedDatabases() {
    const directory = getDirectory();
    if (!fs.existsSync(directory)) {
        return [];
    }

    return fs
        .readdirSync(directory)
        .filter(isAnonymizedDatabaseName)
        .flatMap((fileName) => {
            const filePath = path.join(directory, fileName);
            const stat = fs.statSync(filePath, { throwIfNoEntry: false });
            if (!stat?.isFile()) {
                return [];
            }

            return [ { fileName, filePath, mtime: stat.mtime, fileSize: stat.size } ];
        }) satisfies AnonymizedDbResponse[];
}

/**
 * The absolute path of a copy that {@link getExistingAnonymizedDatabases} lists by its name, or
 * `null` for any other path. Every route that takes such a path from a client goes through here.
 */
function resolveAnonymizedDatabase(filePath: string): string | null {
    const resolvedPath = path.resolve(filePath);
    const isListed = path.dirname(resolvedPath) === getDirectory()
        && isAnonymizedDatabaseName(path.basename(resolvedPath));

    return isListed ? resolvedPath : null;
}

/** The extension check excludes the journal of a copy. */
function isAnonymizedDatabaseName(fileName: string) {
    return fileName.includes("anonymized") && fileName.endsWith(".db");
}

function getDirectory() {
    return path.resolve(dataDir.ANONYMIZED_DB_DIR);
}

function randomSuffix() {
    return randomBytes(6).toString("hex");
}

export default {
    getFullAnonymizationScript,
    createAnonymizedCopy,
    removeLeftoverStagingFiles,
    getExistingAnonymizedDatabases,
    resolveAnonymizedDatabase
};
