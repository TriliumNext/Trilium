import { BUILTIN_ATTRIBUTES } from "@triliumnext/commons";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (hoisted above the module-under-test import) ---

const mockFs = {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn()
};

vi.mock("fs", () => ({ default: mockFs, ...mockFs }));

const mockDbInstance = {
    exec: vi.fn(),
    close: vi.fn()
};
// Must be a normal (non-arrow) function so `new Database(...)` works.
const DatabaseCtor = vi.fn(function (this: any) {
    return mockDbInstance;
});

vi.mock("better-sqlite3", () => ({ default: DatabaseCtor }));

const mockSql = { copyDatabase: vi.fn().mockResolvedValue(undefined) };
vi.mock("./sql.js", () => ({ default: mockSql }));

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        date_utils: { ...actual.date_utils, getDateTimeForFile: () => "2025-01-01_00-00-00" }
    };
});

// data_dir.ts runs createDirIfNotExisting at import time; provide a directory result.
mockFs.existsSync.mockReturnValue(true);

const { default: anonymization } = await import("./anonymization.js");
const { default: dataDir } = await import("./data_dir.js");

beforeEach(() => {
    vi.clearAllMocks();
    mockSql.copyDatabase.mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

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

        // share-specific attributes are intentionally excluded from the keep-list.
        expect(script).not.toContain("'shareCredentials'");
        expect(script).not.toContain("'shareAlias'");

        // Sanity: every other builtin attribute name appears in the keep-list.
        const expectedNames = BUILTIN_ATTRIBUTES
            .filter((a) => !["shareCredentials", "shareAlias"].includes(a.name))
            .map((a) => a.name);
        for (const name of expectedNames) {
            expect(script).toContain(`'${name}'`);
        }
    });
});

describe("createAnonymizedCopy", () => {
    it("rejects unrecognized anonymization types", async () => {
        await expect(anonymization.createAnonymizedCopy("invalid" as any))
            .rejects.toThrow(/Unrecognized anonymization type/);
        expect(mockSql.copyDatabase).not.toHaveBeenCalled();
    });

    it("creates the anonymized-db dir when missing, then copies + runs the full script", async () => {
        mockFs.existsSync.mockReturnValue(false);

        const result = await anonymization.createAnonymizedCopy("full");

        expect(mockFs.mkdirSync).toHaveBeenCalledWith(dataDir.ANONYMIZED_DB_DIR, 0o700);
        const expectedPath = `${dataDir.ANONYMIZED_DB_DIR}/anonymized-full-2025-01-01_00-00-00.db`;
        expect(mockSql.copyDatabase).toHaveBeenCalledWith(expectedPath);
        expect(DatabaseCtor).toHaveBeenCalledWith(expectedPath);
        // full script ends in VACUUM
        expect(mockDbInstance.exec).toHaveBeenCalledWith(expect.stringContaining("VACUUM;"));
        expect(mockDbInstance.close).toHaveBeenCalled();
        expect(result).toEqual({ success: true, anonymizedFilePath: expectedPath });
    });

    it("skips dir creation when it already exists and runs the light script", async () => {
        mockFs.existsSync.mockReturnValue(true);

        const result = await anonymization.createAnonymizedCopy("light");

        expect(mockFs.mkdirSync).not.toHaveBeenCalled();
        // light script targets js notes' blobs and does NOT vacuum
        const execArg = mockDbInstance.exec.mock.calls[0][0] as string;
        expect(execArg).toContain("application/javascript;env=backend");
        expect(execArg).not.toContain("VACUUM");
        expect(result.success).toBe(true);
        expect(result.anonymizedFilePath).toContain("anonymized-light-");
    });
});

describe("getExistingAnonymizedDatabases", () => {
    it("returns an empty list when the directory does not exist", () => {
        mockFs.existsSync.mockReturnValue(false);
        expect(anonymization.getExistingAnonymizedDatabases()).toEqual([]);
        expect(mockFs.readdirSync).not.toHaveBeenCalled();
    });

    it("lists only files whose name includes 'anonymized'", () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readdirSync.mockReturnValue([
            "anonymized-full-x.db",
            "document.db",
            "anonymized-light-y.db",
            "backup.zip"
        ]);

        const result = anonymization.getExistingAnonymizedDatabases();

        expect(result.map((r) => r.fileName)).toEqual([
            "anonymized-full-x.db",
            "anonymized-light-y.db"
        ]);
        for (const entry of result) {
            // filePath must be the fully-resolved path under the anonymized-db dir,
            // not merely a string that happens to contain the file name.
            expect(entry.filePath).toBe(path.resolve(dataDir.ANONYMIZED_DB_DIR, entry.fileName));
        }
    });
});
