import { BUILTIN_ATTRIBUTES } from "@triliumnext/commons";
import Database from "better-sqlite3";
import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    /** Replaces `sql.copyDatabase()`, which backs up the live connection to a file. */
    copyDatabase: async (_target: string): Promise<void> => {}
}));

// A folder of this spec's own, so no other spec's files meet the sweep.
vi.mock("./data_dir.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("./data_dir.js")>();
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const root = join(tmpdir(), `trilium-anonymization-spec-${process.pid}`);

    return {
        ...original,
        default: { ...original.default, ANONYMIZED_DB_DIR: join(root, "anonymized-db") }
    };
});

vi.mock("./sql.js", () => ({
    default: { copyDatabase: (target: string) => h.copyDatabase(target) }
}));

const { loadCoreSchema } = await import("../core_assets.js");
const { default: anonymization } = await import("./anonymization.js");
const { default: dataDir } = await import("./data_dir.js");
const { default: databaseRoute } = await import("../routes/api/database.js");

const COPIES_DIR = path.resolve(dataDir.ANONYMIZED_DB_DIR);
const ROOT = path.dirname(COPIES_DIR);
const LIVE_DATABASE = path.join(ROOT, "document.db");
const HOUR = 60 * 60 * 1000;

/** Text that no support copy may hold, in its rows or anywhere in its bytes. */
const MARKERS = {
    removedBeforeCopy: "MARKER-REMOVED-BEFORE-COPY",
    blobContent: "MARKER-BLOB-CONTENT",
    documentSecret: "MARKER-DOCUMENT-SECRET",
    totpSecret: "MARKER-TOTP-SECRET",
    totpSalt: "MARKER-TOTP-SALT",
    totpHash: "MARKER-TOTP-HASH",
    recoveryCodes: "MARKER-RECOVERY-CODES",
    recoveryKey: "MARKER-RECOVERY-KEY",
    recoveryIv: "MARKER-RECOVERY-IV",
    openIdUser: "MARKER-OPENID-USER",
    session: "MARKER-SESSION-DATA"
};

const SECOND_FACTOR_OPTIONS: Record<string, string> = {
    totpEncryptedSecret: MARKERS.totpSecret,
    totpEncryptionSalt: MARKERS.totpSalt,
    totpVerificationHash: MARKERS.totpHash,
    recoveryCodesEncrypted: MARKERS.recoveryCodes,
    recoveryCodeSecurityKey: MARKERS.recoveryKey,
    recoveryCodeInitialVector: MARKERS.recoveryIv
};

let live: Database.Database;
/** Every path that `copyDatabase()` was asked to write. */
let copyTargets: string[];

/** A live database in WAL mode, as the server keeps it, holding every marker. */
function openLiveDatabase() {
    const db = new Database(LIVE_DATABASE);
    db.pragma("journal_mode = WAL");
    db.exec(loadCoreSchema());

    const insertOption = db.prepare(/*sql*/`INSERT INTO options
        (name, value, isSynced, utcDateModified) VALUES (?, ?, 0, '2026-01-01')`);
    // Large enough for pages of its own, which a delete leaves on the freelist.
    insertOption.run("removedBeforeCopy", MARKERS.removedBeforeCopy.repeat(1000));
    db.prepare("DELETE FROM options WHERE name = 'removedBeforeCopy'").run();
    insertOption.run("documentSecret", MARKERS.documentSecret);
    insertOption.run("encryptedRecoveryCodes", "true");
    for (const [ name, value ] of Object.entries(SECOND_FACTOR_OPTIONS)) {
        insertOption.run(name, value);
    }

    db.prepare(/*sql*/`INSERT INTO blobs (blobId, content, dateModified, utcDateModified)
        VALUES (?, ?, '', '')`).run("blob1", MARKERS.blobContent.repeat(1000));
    db.prepare("INSERT INTO user_data (tmpID, username, email, salt) VALUES (0, ?, ?, ?)")
        .run(MARKERS.openIdUser, MARKERS.openIdUser, MARKERS.openIdUser);
    db.prepare("INSERT INTO sessions (id, data, expires) VALUES (?, ?, 0)")
        .run("session1", MARKERS.session);

    return db;
}

function namesIn(directory: string) {
    return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}

function fakeRes() {
    const calls: { status?: number; download?: unknown[] } = {};
    const res = {
        status(code: number) { calls.status = code; return this; },
        send() { return this; },
        download(...args: unknown[]) { calls.download = args; return this; }
    } as unknown as Response;

    return { res, calls };
}

/** Whether the download and the delete route both refuse the path. */
function expectRefusedByRoutes(filePath: string) {
    const request = { query: { filePath } } as unknown as Request;
    const { res, calls } = fakeRes();
    databaseRoute.downloadAnonymizedDatabase(request, res);
    expect(calls.status).toBe(403);
    expect(calls.download).toBeUndefined();

    expect(() => databaseRoute.deleteAnonymizedDatabase(request))
        .toThrow("Not an anonymized database.");
}

/** Whether the bytes of a file contain `marker` anywhere. */
function fileContains(filePath: string, marker: string) {
    return fs.readFileSync(filePath).toString("latin1").includes(marker);
}

/** Sets a file's modification time `ageMs` into the past. */
function age(filePath: string, ageMs: number) {
    const time = new Date(Date.now() - ageMs);
    fs.utimesSync(filePath, time, time);
}

beforeEach(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
    live = openLiveDatabase();
    copyTargets = [];
    h.copyDatabase = async (target) => {
        copyTargets.push(target);
        await live.backup(target);
    };
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    live.close();
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe("getFullAnonymizationScript", () => {
    it("contains the expected destructive statements and builtin attribute names", () => {
        const script = anonymization.getFullAnonymizationScript();

        // Locks the structural shape of the anonymization SQL.
        expect(script).toContain("UPDATE etapi_tokens SET tokenHash");
        expect(script).toContain("UPDATE notes SET title = 'title'");
        expect(script).toContain("UPDATE blobs SET content = 'text'");
        expect(script).toContain("UPDATE revisions SET title = 'title'");
        expect(script).toContain("UPDATE attachments SET title = 'title'");
        expect(script).toContain("UPDATE attributes SET name = 'name', value = 'value'");
        expect(script).toContain("UPDATE branches SET prefix = 'prefix'");
        expect(script).toContain("UPDATE options SET value = 'anonymized'");
        expect(script).toContain("VACUUM;");

        // Builtin attribute names are preserved (kept out of the anonymization).
        expect(script).toContain("'inbox'");
        expect(script).toContain("'archived'");

        // Builtin names whose value is user-authored are intentionally excluded from the keep-list, so
        // that the value gets scrubbed along with the ordinary user attributes.
        expect(script).not.toContain("'shareCredentials'");
        expect(script).not.toContain("'shareAlias'");
        expect(script).not.toContain("'geolocation'");
        expect(script).not.toContain("'searchString'");

        // Sanity: every other builtin attribute name appears in the keep-list.
        const expectedNames = BUILTIN_ATTRIBUTES
            .filter((a) => !("hasUserValue" in a && a.hasUserValue))
            .map((a) => a.name);
        for (const name of expectedNames) {
            expect(script).toContain(`'${name}'`);
        }
    });
});

describe("createAnonymizedCopy", () => {
    it("rejects unrecognized anonymization types", async () => {
        const invalid = "invalid" as Parameters<typeof anonymization.createAnonymizedCopy>[0];
        await expect(anonymization.createAnonymizedCopy(invalid))
            .rejects.toThrow(/Unrecognized anonymization type/);
        expect(copyTargets).toEqual([]);
    });

    it.each([ "light", "full" ] as const)("leaves no scrubbed value in a %s copy", async (type) => {
        const { success, anonymizedFilePath } = await anonymization.createAnonymizedCopy(type);

        expect(success).toBe(true);
        expect(path.dirname(anonymizedFilePath)).toBe(COPIES_DIR);
        expect(path.basename(anonymizedFilePath))
            .toMatch(new RegExp(`^anonymized-${type}-.+-[0-9a-f]+\\.db$`));
        // One self-contained file, with no journal beside it.
        expect(namesIn(COPIES_DIR)).toEqual([ path.basename(anonymizedFilePath) ]);

        const markersInBytes = Object.values(MARKERS)
            .filter((marker) => fileContains(anonymizedFilePath, marker));
        expect(markersInBytes).toEqual([]);

        const copy = new Database(anonymizedFilePath, { readonly: true });
        try {
            const value = (name: string) => copy.prepare("SELECT value FROM options WHERE name = ?")
                .pluck().get(name);
            const count = (table: string) =>
                copy.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get();
            for (const name of Object.keys(SECOND_FACTOR_OPTIONS)) {
                expect(value(name), name).toBe("");
            }
            expect(value("encryptedRecoveryCodes")).toBe("false");
            expect(count("user_data")).toBe(0);
            expect(count("sessions")).toBe(0);
        } finally {
            copy.close();
        }

        expect(anonymization.getExistingAnonymizedDatabases().map((db) => db.filePath))
            .toEqual([ anonymizedFilePath ]);
    });

    it.each([
        [
            "after the copy",
            async (target: string) => {
                copyTargets.push(target);
                fs.writeFileSync(target, "not a database");
            }
        ],
        [
            "inside the script",
            async (target: string) => {
                copyTargets.push(target);
                await live.backup(target);
                vi.spyOn(Database.prototype, "exec").mockImplementation(() => {
                    throw new Error("no such table: blobs");
                });
            }
        ]
    ])("deletes its staging file when a step fails %s", async (_label, copy) => {
        h.copyDatabase = copy;

        await expect(anonymization.createAnonymizedCopy("full")).rejects.toThrow();

        expect(copyTargets).toHaveLength(1);
        expect(namesIn(COPIES_DIR)).toEqual([]);
        expect(anonymization.getExistingAnonymizedDatabases()).toEqual([]);
        // The name it held while unscrubbed is refused by both routes.
        expectRefusedByRoutes(copyTargets[0]);
    });

    it("keeps a staging file that a crash left until it has not changed for an hour", async () => {
        // Learn the name of a staging file, then write one as a killed process leaves it.
        await anonymization.createAnonymizedCopy("light");
        const staging = copyTargets[0];
        const leftovers = [ staging, `${staging}-journal` ];
        for (const filePath of leftovers) {
            fs.writeFileSync(filePath, MARKERS.documentSecret);
        }
        age(staging, 2 * HOUR);

        anonymization.removeLeftoverStagingFiles();
        await anonymization.createAnonymizedCopy("full");

        // The journal changed within the hour, so the pair is young.
        expect(leftovers.every((filePath) => fs.existsSync(filePath))).toBe(true);
        expect(anonymization.getExistingAnonymizedDatabases().map((db) => db.filePath))
            .not.toContain(staging);
        for (const filePath of leftovers) {
            expectRefusedByRoutes(filePath);
        }

        age(`${staging}-journal`, HOUR + 1000);
        anonymization.removeLeftoverStagingFiles();

        expect(leftovers.some((filePath) => fs.existsSync(filePath))).toBe(false);
        expect(anonymization.getExistingAnonymizedDatabases()).toHaveLength(2);
    });

    it("never sweeps the staging file of a copy that this process is still writing", async () => {
        let resume: () => void = () => {};
        h.copyDatabase = async (target) => {
            copyTargets.push(target);
            await live.backup(target);
            // Dated two hours back, as after a slow copy of a large database.
            age(target, 2 * HOUR);
            await new Promise<void>((resolve) => {
                resume = resolve;
            });
        };
        const slow = anonymization.createAnonymizedCopy("full");
        await vi.waitFor(() => expect(copyTargets).toHaveLength(1));

        h.copyDatabase = async (target) => {
            copyTargets.push(target);
            await live.backup(target);
        };
        await anonymization.createAnonymizedCopy("light");
        anonymization.removeLeftoverStagingFiles();
        expect(fs.existsSync(copyTargets[0])).toBe(true);

        resume();
        const { anonymizedFilePath } = await slow;
        expect(fileContains(anonymizedFilePath, MARKERS.documentSecret)).toBe(false);
        expect(anonymization.getExistingAnonymizedDatabases()).toHaveLength(2);
    });

    it("publishes a complete and clean file for each of two copies run together", async () => {
        const copies = await Promise.all([
            anonymization.createAnonymizedCopy("light"),
            anonymization.createAnonymizedCopy("full")
        ]);

        for (const { anonymizedFilePath } of copies) {
            const copy = new Database(anonymizedFilePath, { readonly: true });
            expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
            copy.close();
            expect(fileContains(anonymizedFilePath, MARKERS.totpSecret)).toBe(false);
        }
        expect(namesIn(COPIES_DIR)).toHaveLength(2);
    });

    it("gives two full copies of one second a file each, each answer naming its own", async () => {
        vi.useFakeTimers({ toFake: [ "Date" ] });
        vi.setSystemTime(new Date("2026-11-26T10:15:30Z"));

        const [ first, second ] = await Promise.all([
            anonymization.createAnonymizedCopy("full"),
            anonymization.createAnonymizedCopy("full")
        ]);

        expect(first.anonymizedFilePath).not.toBe(second.anonymizedFilePath);
        for (const { anonymizedFilePath } of [ first, second ]) {
            const fileName = path.basename(anonymizedFilePath);
            expect(fileName).toMatch(/^anonymized-full-2026-11-26T101530-[0-9a-f]+\.db$/);
            expect(fs.existsSync(anonymizedFilePath)).toBe(true);
        }
        expect(namesIn(COPIES_DIR)).toHaveLength(2);
    });
});

describe("getExistingAnonymizedDatabases", () => {
    it("returns an empty list when the directory does not exist", () => {
        expect(anonymization.getExistingAnonymizedDatabases()).toEqual([]);
    });

    it("lists only anonymized .db files, with their modification date and size", () => {
        fs.mkdirSync(path.join(COPIES_DIR, "anonymized-folder.db"), { recursive: true });
        for (const fileName of [
            "anonymized-full-x.db",
            "document.db",
            "anonymized-light-y.db",
            // intermediate SQLite file of an in-progress anonymization must be excluded
            "anonymized-full-z.db-journal",
            "backup.zip"
        ]) {
            fs.writeFileSync(path.join(COPIES_DIR, fileName), "bytes");
        }

        const result = anonymization.getExistingAnonymizedDatabases();

        expect(result.map((r) => r.fileName).sort()).toEqual([
            "anonymized-full-x.db",
            "anonymized-light-y.db"
        ]);
        for (const entry of result) {
            expect(entry.filePath).toBe(path.resolve(COPIES_DIR, entry.fileName));
            expect(entry.mtime).toBeInstanceOf(Date);
            expect(entry.fileSize).toBe("bytes".length);
        }
    });
});
