import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { getDataDirs as getDataDirsType, getPlatformAppDataDir as getPlatformAppDataDirType,getTriliumDataDir as getTriliumDataDirType } from "./data_dir.js";

describe("data_dir.ts unit tests", () => {
    let getTriliumDataDir: typeof getTriliumDataDirType;
    let getPlatformAppDataDir: typeof getPlatformAppDataDirType;
    let getDataDirs: typeof getDataDirsType;

    const mockFn = {
        accessSyncMock: vi.fn(),
        existsSyncMock: vi.fn(),
        mkdirSyncMock: vi.fn(),
        statSyncMock: vi.fn(),
        osHomedirMock: vi.fn(),
        osPlatformMock: vi.fn(),
        pathJoinMock: vi.fn()
    };

    beforeAll(async () => {
        // Reset the module cache so the dynamic imports below get a fresh instance
        // of data_dir.ts with the mocked dependencies rather than the cached copy
        // loaded by spec/setup.ts. This must run inside beforeAll (not at
        // describe-level) so that spec/setup.ts's beforeAll completes first.
        vi.resetModules();

        // using doMock, to avoid hoisting, so that we can use the mockFn object
        // to collect all mocked Fns
        vi.doMock("node:fs", () => {
            return {
                default: {
                    accessSync: mockFn.accessSyncMock,
                    constants: { R_OK: 4, W_OK: 2, X_OK: 1 },
                    existsSync: mockFn.existsSyncMock,
                    mkdirSync: mockFn.mkdirSyncMock,
                    statSync: mockFn.statSyncMock
                }
            };
        });

        vi.doMock("node:os", () => {
            return {
                default: {
                    homedir: mockFn.osHomedirMock,
                    platform: mockFn.osPlatformMock
                }
            };
        });

        const { dirname } = await vi.importActual<typeof import("node:path")>("node:path");
        vi.doMock("node:path", () => {
            return {
                dirname,
                join: mockFn.pathJoinMock
            };
        });

        // import function to test now, after creating the mocks
        ({ getTriliumDataDir } = await import("./data_dir.js"));
        ({ getPlatformAppDataDir } = await import("./data_dir.js"));
        ({ getDataDirs } = await import("./data_dir.js"));
    });

    // helper to reset call counts
    const resetAllMocks = () => {
        Object.values(mockFn).forEach((mockedFn) => {
            mockedFn.mockReset();
        });
    };

    type ProcessWithIds = NodeJS.Process & { getuid?: () => number; getgid?: () => number };
    const proc = process as ProcessWithIds;
    const originalIds = { getuid: proc.getuid, getgid: proc.getgid };

    // Sets the UID and GID process.getuid()/getgid() report, or removes both as on Windows (null).
    const stubUser = (id: number | null) => {
        if (id === null) {
            delete proc.getuid;
            delete proc.getgid;
        } else {
            proc.getuid = () => id;
            proc.getgid = () => id;
        }
    };

    const restoreUser = () => {
        if (originalIds.getuid && originalIds.getgid) {
            proc.getuid = originalIds.getuid;
            proc.getgid = originalIds.getgid;
        } else {
            stubUser(null);
        }
    };

    // Runs `run` with process.exit stubbed and returns what was printed before exiting.
    const runUntilExit = (run: () => unknown) => {
        const exit = vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("process.exit");
        });
        expect(run).toThrow("process.exit");
        expect(exit).toHaveBeenCalledWith(1);
        expect(console.error).toHaveBeenCalledTimes(1);
        return String(vi.mocked(console.error).mock.calls[0][0]);
    };

    // helper to set mocked Platform
    const setMockPlatform = (osPlatform: string, homedir: string, pathJoin: string) => {
        mockFn.osPlatformMock.mockImplementation(() => osPlatform);
        mockFn.osHomedirMock.mockImplementation(() => homedir);
        mockFn.pathJoinMock.mockImplementation(() => pathJoin);
    };

    describe("#getPlatformAppDataDir()", () => {
        type TestCaseGetPlatformAppDataDir = [description: string, fnValue: Parameters<typeof getPlatformAppDataDir>, expectedValue: string | null, osHomedirMockValue: string | null];

        const testCases: TestCaseGetPlatformAppDataDir[] = [
            [ "w/ unsupported OS it should return 'null'", [ "aix", undefined ], null, null ],

            [ "w/ win32 and no APPDATA set it should return 'null'", [ "win32", undefined ], null, null ],

            [ "w/ win32 and set APPDATA it should return set 'APPDATA'", [ "win32", "AppData" ], "AppData", null ],

            [ "w/ linux it should return '~/.local/share'", [ "linux", undefined ], "/home/mock/.local/share", "/home/mock" ],

            [ "w/ linux and wrongly set APPDATA it should ignore APPDATA and return '~/.local/share'", [ "linux", "FakeAppData" ], "/home/mock/.local/share", "/home/mock" ],

            [ "w/ darwin it should return '~/Library/Application Support'", [ "darwin", undefined ], "/Users/mock/Library/Application Support", "/Users/mock" ]
        ];

        beforeEach(() => {
            // make sure OS does not set its own process.env.APPDATA, so that we can use our own supplied value
            delete process.env.APPDATA;
        });

        testCases.forEach((testCase) => {
            const [ testDescription, fnValues, expected, osHomedirMockValue ] = testCase;
            return it(testDescription, () => {
                mockFn.osHomedirMock.mockReturnValue(osHomedirMockValue);
                const actual = getPlatformAppDataDir(...fnValues);
                expect(actual).toEqual(expected);
            });
        });
    });

    describe("#getTriliumDataDir", async () => {
        beforeEach(() => {
            // make sure these are not set
            delete process.env.TRILIUM_DATA_DIR;
            delete process.env.APPDATA;

            resetAllMocks();
        });

        /**
         * case A – process.env.TRILIUM_DATA_DIR is set
         * case B – process.env.TRILIUM_DATA_DIR is not set and Trilium folder is existing in platform
         * case C – process.env.TRILIUM_DATA_DIR is not set and Trilium folder is not existing in platform's home dir
         * case D – fallback to creating Trilium folder in home dir
         */

        describe("case A", () => {
            it("when folder exists – it should return the path, handling EEXIST gracefully", async () => {
                const mockTriliumDataPath = "/home/mock/trilium-data-ENV-A1";
                process.env.TRILIUM_DATA_DIR = mockTriliumDataPath;

                // mkdirSync throws EEXIST when folder already exists (EAFP pattern)
                const eexistError = new Error("EEXIST: file already exists") as NodeJS.ErrnoException;
                eexistError.code = "EEXIST";
                mockFn.mkdirSyncMock.mockImplementation(() => { throw eexistError; });

                // statSync confirms it's a directory
                mockFn.statSyncMock.mockImplementation(() => ({ isDirectory: () => true }));

                const result = getTriliumDataDir("trilium-data");

                // createDirIfNotExisting tries mkdirSync first (EAFP), then statSync to verify it's a directory
                expect(mockFn.mkdirSyncMock).toHaveBeenCalledTimes(1);
                expect(mockFn.statSyncMock).toHaveBeenCalledTimes(1);
                expect(result).toEqual(process.env.TRILIUM_DATA_DIR);
            });

            it("when folder does not exist – it should create the folder and return the path", async () => {
                const mockTriliumDataPath = "/home/mock/trilium-data-ENV-A2";
                process.env.TRILIUM_DATA_DIR = mockTriliumDataPath;

                // mkdirSync succeeds when folder doesn't exist
                mockFn.mkdirSyncMock.mockImplementation(() => undefined);

                const result = getTriliumDataDir("trilium-data");

                // createDirIfNotExisting calls mkdirSync which succeeds
                expect(mockFn.mkdirSyncMock).toHaveBeenCalledTimes(1);
                expect(result).toEqual(process.env.TRILIUM_DATA_DIR);
            });
        });

        describe("case B", () => {
            it("it should check if folder exists and return it", async () => {
                const homedir = "/home/mock";
                const dataDirName = "trilium-data";
                const mockTriliumDataPath = `${homedir}/${dataDirName}`;

                mockFn.pathJoinMock.mockImplementation(() => mockTriliumDataPath);

                // set fs.existsSync to true, i.e. the folder does exist
                mockFn.existsSyncMock.mockImplementation(() => true);

                const result = getTriliumDataDir(dataDirName);

                expect(mockFn.existsSyncMock).toHaveBeenCalledTimes(1);
                expect(result).toEqual(mockTriliumDataPath);
            });
        });

        describe("case C", () => {
            it("w/ Platform 'Linux', an existing App Data Folder (~/.local/share) but non-existing Trilium dir (~/.local/share/trilium-data) – it should attempt to create the dir", async () => {
                const homedir = "/home/mock";
                const dataDirName = "trilium-data";
                const mockPlatformDataPath = `${homedir}/.local/share/${dataDirName}`;

                // mock set: os.platform, os.homedir and pathJoin return values
                setMockPlatform("linux", homedir, mockPlatformDataPath);

                // use Generator to precisely control order of fs.existSync return values
                const existsSyncMockGen = (function* () {
                    // 1) fs.existSync -> case B -> checking if folder exists in home dir
                    yield false;
                    // 2) fs.existSync -> case C -> checking if default OS PlatformAppDataDir exists
                    yield true;
                })();

                mockFn.existsSyncMock.mockImplementation(() => existsSyncMockGen.next().value);
                // mkdirSync succeeds (folder doesn't exist)
                mockFn.mkdirSyncMock.mockImplementation(() => undefined);

                const result = getTriliumDataDir(dataDirName);

                expect(mockFn.existsSyncMock).toHaveBeenCalledTimes(2);
                expect(mockFn.mkdirSyncMock).toHaveBeenCalledTimes(1);
                expect(result).toEqual(mockPlatformDataPath);
            });

            it("w/ Platform Linux, an existing App Data Folder (~/.local/share) AND an existing Trilium Data dir – it should return path to the dir", async () => {
                const homedir = "/home/mock";
                const dataDirName = "trilium-data";
                const mockPlatformDataPath = `${homedir}/.local/share/${dataDirName}`;

                // mock set: os.platform, os.homedir and pathJoin return values
                setMockPlatform("linux", homedir, mockPlatformDataPath);

                // use Generator to precisely control order of fs.existSync return values
                const existsSyncMockGen = (function* () {
                    // 1) fs.existSync -> case B -> checking if folder exists in home dir
                    yield false;
                    // 2) fs.existSync -> case C -> checking if default OS PlatformAppDataDir exists
                    yield true;
                })();

                mockFn.existsSyncMock.mockImplementation(() => existsSyncMockGen.next().value);

                // mkdirSync throws EEXIST (folder already exists), statSync confirms it's a directory
                const eexistError = new Error("EEXIST: file already exists") as NodeJS.ErrnoException;
                eexistError.code = "EEXIST";
                mockFn.mkdirSyncMock.mockImplementation(() => { throw eexistError; });
                mockFn.statSyncMock.mockImplementation(() => ({ isDirectory: () => true }));

                const result = getTriliumDataDir(dataDirName);

                expect(result).toEqual(mockPlatformDataPath);
                expect(mockFn.existsSyncMock).toHaveBeenCalledTimes(2);
                expect(mockFn.mkdirSyncMock).toHaveBeenCalledTimes(1);
                expect(mockFn.statSyncMock).toHaveBeenCalledTimes(1);
            });

            it("w/ Platform 'win32' and set process.env.APPDATA behaviour", async () => {
                const homedir = "C:\\Users\\mock";
                const dataDirName = "trilium-data";
                const appDataDir = `${homedir}\\AppData\\Roaming`;
                const mockPlatformDataPath = `${appDataDir}\\${dataDirName}`;
                process.env.APPDATA = `${appDataDir}`;

                // mock set: os.platform, os.homedir and pathJoin return values
                setMockPlatform("win32", homedir, mockPlatformDataPath);

                // use Generator to precisely control order of fs.existSync return values
                const existsSyncMockGen = (function* () {
                    // 1) fs.existSync -> case B -> checking if folder exists in home dir
                    yield false;
                    // 2) fs.existSync -> case C -> checking if default OS PlatformAppDataDir exists
                    yield true;
                })();

                mockFn.existsSyncMock.mockImplementation(() => existsSyncMockGen.next().value);
                // mkdirSync succeeds (folder doesn't exist)
                mockFn.mkdirSyncMock.mockImplementation(() => undefined);

                const result = getTriliumDataDir(dataDirName);

                expect(result).toEqual(mockPlatformDataPath);
                expect(mockFn.existsSyncMock).toHaveBeenCalledTimes(2);
                expect(mockFn.mkdirSyncMock).toHaveBeenCalledTimes(1);
            });
        });

        describe("case D", () => {
            it("w/ unknown PlatformAppDataDir it should attempt to create the folder in the homefolder", async () => {
                const homedir = "/home/mock";
                const dataDirName = "trilium-data";
                const mockPlatformDataPath = `${homedir}/${dataDirName}`;

                setMockPlatform("aix", homedir, mockPlatformDataPath);

                // fs.existSync -> case B -> checking if folder exists in home folder
                mockFn.existsSyncMock.mockImplementation(() => false);
                // mkdirSync succeeds (folder doesn't exist)
                mockFn.mkdirSyncMock.mockImplementation(() => undefined);

                const result = getTriliumDataDir(dataDirName);

                expect(result).toEqual(mockPlatformDataPath);
                expect(mockFn.existsSyncMock).toHaveBeenCalledTimes(1);
                expect(mockFn.mkdirSyncMock).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe("#getDataDirs()", () => {
        const envKeys: Omit<keyof ReturnType<typeof getDataDirs>, "TRILIUM_DATA_DIR">[] = [ "DOCUMENT_PATH", "BACKUP_DIR", "LOG_DIR", "ANONYMIZED_DB_DIR", "CONFIG_INI_PATH", "TMP_DIR", "OCR_CACHE_DIR" ];

        const setMockedEnv = (prefix: string | null) => {
            envKeys.forEach((key) => {
                if (prefix) {
                    process.env[`TRILIUM_${key}`] = `${prefix}_${key}`;
                } else {
                    delete process.env[`TRILIUM_${key}`];
                }
            });
        };

        it("w/ process.env values present, it should return an object using values from process.env", () => {
            // set mocked values
            const mockValuePrefix = "MOCK";
            setMockedEnv(mockValuePrefix);

            // get result
            const result = getDataDirs(`${mockValuePrefix}_TRILIUM_DATA_DIR`);

            for (const key in result) {
                expect(result[key as keyof typeof result]).toEqual(`${mockValuePrefix}_${key}`);
            }
        });

        it("w/ NO process.env values present, it should return an object using supplied TRILIUM_DATA_DIR as base", () => {
            // make sure values are undefined
            setMockedEnv(null);

            // mock pathJoin implementation to just return mockDataDir
            const mockDataDir = "/home/test/MOCK_TRILIUM_DATA_DIR";
            mockFn.pathJoinMock.mockImplementation(() => mockDataDir);

            const result = getDataDirs(mockDataDir);

            for (const key in result) {
                expect(result[key as keyof typeof result].startsWith(mockDataDir)).toBeTruthy();
            }

            mockFn.pathJoinMock.mockReset();
        });

        it("should ignore attempts to change a property on the returned object", () => {
            // make sure values are undefined
            setMockedEnv(null);

            const mockDataDirBase = "/home/test/MOCK_TRILIUM_DATA_DIR";
            const result = getDataDirs(mockDataDirBase);

            // as per MDN: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze#description
            // Any attempt to change a frozen object will, either silently be ignored or
            // throw a TypeError exception (most commonly, but not exclusively, when in strict mode).
            // so be safe and check for both, even though it looks weird

            const getChangeAttemptResult = () => {
                try {
                    //@ts-expect-error - attempt to change value of readonly property
                    result.BACKUP_DIR = "attempt to change";
                    return result.BACKUP_DIR;
                } catch (error) {
                    return error;
                }
            };

            const changeAttemptResult = getChangeAttemptResult();

            if (typeof changeAttemptResult === "string") {
                // if it didn't throw above: assert that it did not change the value of it or any other keys of the object
                for (const key in result) {
                    expect(result[key as keyof typeof result].startsWith(mockDataDirBase)).toBeTruthy();
                }
            } else {
                expect(changeAttemptResult).toBeInstanceOf(TypeError);
            }
        });

        describe("w/ existing entries", () => {
            const W_OK = 2;
            const blockWrites = (...paths: string[]) => {
                mockFn.accessSyncMock.mockImplementation((path: string, mode: number) => {
                    if (paths.includes(path) && (mode & W_OK)) {
                        throw new Error("EACCES");
                    }
                });
            };

            beforeEach(() => {
                resetAllMocks();
                setMockedEnv(null);
                mockFn.pathJoinMock.mockImplementation((...parts: string[]) => parts.join("/"));
                mockFn.existsSyncMock.mockReturnValue(true);
                mockFn.statSyncMock.mockImplementation((path: string) => ({
                    uid: 1000,
                    gid: 1000,
                    mode: path === "/data/log" ? 0o40700 : 0o100644,
                    isFile: () => path !== "/data/log"
                }));
                vi.spyOn(console, "error").mockImplementation(() => {});
                stubUser(1234);
            });

            afterEach(() => {
                restoreUser();
                vi.restoreAllMocks();
                resetAllMocks();
            });

            it("that the user can use – returns the paths", () => {
                expect(getDataDirs("/data").DOCUMENT_PATH).toBe("/data/document.db");
                expect(mockFn.accessSyncMock).toHaveBeenCalledWith("/data/document.db", expect.any(Number));
                expect(console.error).not.toHaveBeenCalled();
            });

            it("that the user cannot write – lists them with the chown that fixes them and exits", () => {
                blockWrites("/data/document.db", "/data/log", "/data/config.ini");

                const message = runUntilExit(() => getDataDirs("/data"));
                expect(message).toContain("Trilium cannot start because it cannot use some of the files in its data directory, /data.");
                expect(message).toContain([
                    "Trilium runs as UID:GID 1234:1234, but:",
                    "  - document.db is owned by UID:GID 1000:1000 with permissions 644",
                    "  - log is owned by UID:GID 1000:1000 with permissions 700",
                    ""
                ].join("\n"));
                expect(message).toContain("  sudo chown -R 1234:1234 /data");
                expect(message).toContain("In Docker, the paths above are inside the container.");
                // config.ini is only read, so a denied write must not flag it.
                expect(message).not.toContain("config.ini");
            });

            it("on Windows – says which files are read-only, without UIDs or a chown", () => {
                stubUser(null);
                blockWrites("/data/document.db");
                mockFn.statSyncMock.mockImplementation(() => ({ uid: 0, gid: 0, mode: 0o100444, isFile: () => true }));

                const message = runUntilExit(() => getDataDirs("/data"));
                expect(message).toContain("The user running Trilium cannot use them:\n  - document.db is read-only\n");
                expect(message).toContain("give the user running Trilium full control of the data directory");
                expect(message).not.toContain("UID:GID");
                expect(message).not.toContain("sudo");
            });
        });
    });

    describe("createDirIfNotExisting error handling (via getTriliumDataDir case A)", () => {
        beforeEach(() => {
            resetAllMocks();
            process.env.TRILIUM_DATA_DIR = "/home/mock/trilium-data-ERR";
            vi.spyOn(console, "error").mockImplementation(() => {});
            stubUser(1000);
        });

        afterEach(() => {
            delete process.env.TRILIUM_DATA_DIR;
            restoreUser();
            vi.restoreAllMocks();
        });

        const mkdirThrows = (code: string) => {
            const err = new Error(code) as NodeJS.ErrnoException;
            err.code = code;
            mockFn.mkdirSyncMock.mockImplementation(() => { throw err; });
            return err;
        };

        const ownedByRoot = () => ({ uid: 0, gid: 0, mode: 0o40755, isFile: () => false });

        it("EACCES creating the data directory – suggests creating it for the user and exits", () => {
            mkdirThrows("EACCES");
            mockFn.statSyncMock.mockImplementation(ownedByRoot);

            const message = runUntilExit(() => getTriliumDataDir("trilium-data"));
            expect(message).toContain("Trilium cannot start because it cannot create /home/mock/trilium-data-ERR.");
            expect(message).toContain("Trilium runs as UID:GID 1000:1000, which cannot write to /home/mock: it is owned by UID:GID 0:0 with permissions 755.");
            expect(message).toContain("  sudo mkdir -p /home/mock/trilium-data-ERR && sudo chown 1000:1000 /home/mock/trilium-data-ERR");
            expect(message).toContain("Or set TRILIUM_DATA_DIR to a directory that user owns.");
            expect(message).toContain("In Docker, the paths above are inside the container.");
            expect(message).not.toContain("chown -R");
        });

        it("EACCES creating a directory inside the data directory – suggests a chown of the data directory and exits", () => {
            delete process.env.TRILIUM_TMP_DIR;
            mockFn.pathJoinMock.mockImplementation((...parts: string[]) => parts.join("/"));
            mkdirThrows("EACCES");
            mockFn.statSyncMock.mockImplementation(ownedByRoot);

            const message = runUntilExit(() => getDataDirs("/data"));
            expect(message).toContain("Trilium cannot start because it cannot create /data/tmp.");
            expect(message).toContain("Trilium runs as UID:GID 1000:1000, which cannot write to its data directory, /data: it is owned by UID:GID 0:0 with permissions 755.");
            expect(message).toContain("  sudo chown -R 1000:1000 /data");
            expect(message).not.toContain("mkdir");
        });

        it("EACCES when the data directory itself cannot be entered – suggests a chown of it and exits", () => {
            stubUser(1234);
            delete process.env.TRILIUM_TMP_DIR;
            mockFn.pathJoinMock.mockImplementation((...parts: string[]) => parts.join("/"));
            mkdirThrows("EACCES");
            mockFn.accessSyncMock.mockImplementation((path: string) => {
                if (path === "/data") {
                    throw new Error("EACCES");
                }
            });
            mockFn.statSyncMock.mockImplementation(() => ({ uid: 1000, gid: 1000, mode: 0o40700, isFile: () => false }));

            const message = runUntilExit(() => getDataDirs("/data"));
            expect(message).toContain("Trilium cannot start because it cannot create /data/tmp.");
            expect(message).toContain("Trilium runs as UID:GID 1234:1234, which cannot use its data directory, /data: it is owned by UID:GID 1000:1000 with permissions 700.");
            expect(message).toContain("  sudo chown -R 1234:1234 /data");
            expect(message).not.toContain("chmod");
        });

        it("EACCES – names the ancestor that cannot be entered and exits", () => {
            stubUser(1234);
            mkdirThrows("EACCES");
            mockFn.accessSyncMock.mockImplementation((path: string) => {
                if (path === "/home/mock") {
                    throw new Error("EACCES");
                }
            });
            mockFn.statSyncMock.mockImplementation(() => ({ uid: 1000, gid: 1000, mode: 0o40700, isFile: () => false }));

            const message = runUntilExit(() => getTriliumDataDir("trilium-data"));
            expect(message).toContain("Trilium cannot start because it cannot reach /home/mock/trilium-data-ERR.");
            expect(message).toContain("Trilium runs as UID:GID 1234:1234, which cannot enter /home/mock: it is owned by UID:GID 1000:1000 with permissions 700.");
            expect(message).toContain("  sudo chmod o+x /home/mock");
            expect(mockFn.statSyncMock).toHaveBeenCalledWith("/home/mock");
        });

        it("EACCES – reports a parent that cannot be inspected and exits", () => {
            mkdirThrows("EACCES");
            mockFn.statSyncMock.mockImplementation(() => { throw new Error("no access"); });

            expect(runUntilExit(() => getTriliumDataDir("trilium-data")))
                .toContain("which cannot write to /home/mock: it cannot be inspected.");
        });

        it("EACCES under Electron – throws the explanation for the main-process error dialog", () => {
            const err = mkdirThrows("EACCES");
            mockFn.statSyncMock.mockImplementation(ownedByRoot);
            const exit = vi.spyOn(process, "exit");
            Object.defineProperty(process.versions, "electron", { value: "1.0.0", configurable: true });

            try {
                let thrown: unknown;
                try {
                    getTriliumDataDir("trilium-data");
                } catch (e) {
                    thrown = e;
                }
                expect(thrown).toBeInstanceOf(Error);
                const message = (thrown as Error).message;
                expect(message).toContain("Trilium cannot start because it cannot create /home/mock/trilium-data-ERR.");
                expect(message).not.toContain("In Docker");
                expect((thrown as Error).cause).toBe(err);
                expect(exit).not.toHaveBeenCalled();
            } finally {
                delete (process.versions as Record<string, string | undefined>).electron;
            }
        });

        it("EEXIST but target is not a directory – rethrows", () => {
            const err = mkdirThrows("EEXIST");
            mockFn.statSyncMock.mockImplementation(() => ({ isDirectory: () => false }));

            expect(() => getTriliumDataDir("trilium-data")).toThrow(err);
        });

        it("EEXIST but stat throws – rethrows the original error", () => {
            const err = mkdirThrows("EEXIST");
            mockFn.statSyncMock.mockImplementation(() => { throw new Error("cannot stat"); });

            expect(() => getTriliumDataDir("trilium-data")).toThrow(err);
        });

        it("other error codes – rethrows directly", () => {
            const err = mkdirThrows("ENOSPC");

            expect(() => getTriliumDataDir("trilium-data")).toThrow(err);
        });

        it("non-Error throw value – rethrows as-is", () => {
            mockFn.mkdirSyncMock.mockImplementation(() => { throw "weird"; });

            expect(() => getTriliumDataDir("trilium-data")).toThrow("weird");
        });
    });
});
