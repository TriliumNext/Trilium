import { describe, it, expect, beforeEach, vi } from "vitest";

import type { getTriliumDataDir as getTriliumDataDirType, getDataDirs as getDataDirsType, getPlatformAppDataDir as getPlatformAppDataDirType } from "./data_dir.js";

describe("data_dir.ts unit tests", async () => {
    let getTriliumDataDir: typeof getTriliumDataDirType;
    let getPlatformAppDataDir: typeof getPlatformAppDataDirType;
    let getDataDirs: typeof getDataDirsType;

    const mockFn = {
        existsSyncMock: vi.fn(),
        mkdirSyncMock: vi.fn(),
        statSyncMock: vi.fn(),
        osHomedirMock: vi.fn(),
        osPlatformMock: vi.fn(),
        pathJoinMock: vi.fn()
    };

    // using doMock, to avoid hoisting, so that we can use the mockFn object
    // to collect all mocked Fns
    vi.doMock("node:fs", () => {
        return {
            default: {
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

    vi.doMock("path", () => {
        return {
            join: mockFn.pathJoinMock
        };
    });

    // import function to test now, after creating the mocks
    ({ getTriliumDataDir } = await import("./data_dir.js"));
    ({ getPlatformAppDataDir } = await import("./data_dir.js"));
    ({ getDataDirs } = await import("./data_dir.js"));

    // helper to reset call counts
    const resetAllMocks = () => {
        Object.values(mockFn).forEach((mockedFn) => {
            mockedFn.mockReset();
        });
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
        const envKeys: Omit<keyof ReturnType<typeof getDataDirs>, "TRILIUM_DATA_DIR">[] = [ "DOCUMENT_PATH", "BACKUP_DIR", "LOG_DIR", "ANONYMIZED_DB_DIR", "CONFIG_INI_PATH", "TMP_DIR" ];

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
    });
});
