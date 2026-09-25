import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The probe drives the real execFile through util.promisify's callback
// fallback, so the mock receives (binary, args, options, callback).
type ExecFileCallback = (err: Error | null, result?: { stdout: string; stderr: string }) => void;
const execFileMock = vi.hoisted(() => vi.fn<(binary: string, args: string[], options: { timeout?: number }, cb: ExecFileCallback) => void>());
vi.mock("child_process", () => ({ execFile: execFileMock }));

const existsSyncMock = vi.hoisted(() => vi.fn((_path: string) => true));
vi.mock("fs", () => ({ existsSync: existsSyncMock }));

const findOnPathMock = vi.hoisted(() => vi.fn<(binary: string) => Promise<string | undefined>>());
vi.mock("./binary_lookup.js", () => ({ findOnPath: findOnPathMock }));

const logInfoMock = vi.hoisted(() => vi.fn());
vi.mock("@triliumnext/core", () => ({ getLog: () => ({ info: logInfoMock, error: vi.fn() }) }));

const { parseBuildLabel, resetAntigravityBinaryCache, resolveAntigravityBinaryPath } = await import("./antigravity_binary.js");

describe("resolveAntigravityBinaryPath", () => {
    const BINARY = "C:\\agy\\agy_acp_server.exe";
    const originalOverride = process.env.TRILIUM_ANTIGRAVITY_ACP_PATH;

    beforeEach(() => {
        resetAntigravityBinaryCache();
        execFileMock.mockReset();
        logInfoMock.mockReset();
        process.env.TRILIUM_ANTIGRAVITY_ACP_PATH = BINARY;
    });

    afterEach(() => {
        if (originalOverride === undefined) {
            delete process.env.TRILIUM_ANTIGRAVITY_ACP_PATH;
        } else {
            process.env.TRILIUM_ANTIGRAVITY_ACP_PATH = originalOverride;
        }
    });

    function probeReturns(stdout: string) {
        execFileMock.mockImplementation((_binary, _args, _options, cb) => cb(null, { stdout, stderr: "" }));
    }

    it("probes with flags every build accepts, and logs the build label where there is one", async () => {
        probeReturns("Build label: agy_acp_server_1.1.1\nBuild target: x\n");

        await expect(resolveAntigravityBinaryPath()).resolves.toBe(BINARY);

        // The Windows build defines no --version: --undefok lets it through, and
        // --only_check_args exits after parsing instead of starting the server.
        const [ binary, args, options ] = execFileMock.mock.calls[0];
        expect(binary).toBe(BINARY);
        expect(args).toEqual([ "--undefok=version", "--version", "--only_check_args" ]);
        // A Windows start unpacks the bundled Python first, about 15 s.
        expect(options.timeout).toBe(60_000);
        expect(logInfoMock).toHaveBeenCalledWith(expect.stringContaining("(agy_acp_server_1.1.1)"));
    });

    it("accepts a build that prints no version", async () => {
        probeReturns("");

        await expect(resolveAntigravityBinaryPath()).resolves.toBe(BINARY);
        expect(logInfoMock).toHaveBeenCalledWith(expect.stringContaining("(version not reported)"));
    });

    it("rejects with the setup hint on a broken binary and re-probes on the next call", async () => {
        execFileMock.mockImplementationOnce((_binary, _args, _options, cb) => cb(new Error("spawn ENOENT")));

        await expect(resolveAntigravityBinaryPath()).rejects.toThrow(/failed to run \(spawn ENOENT\).*Google Antigravity/s);

        probeReturns("");
        await expect(resolveAntigravityBinaryPath()).resolves.toBe(BINARY);
        expect(execFileMock).toHaveBeenCalledTimes(2);
    });

    it("probes once for concurrent callers, and reports a failure that is no Error", async () => {
        probeReturns("");
        const [ first, second ] = await Promise.all([ resolveAntigravityBinaryPath(), resolveAntigravityBinaryPath() ]);
        expect([ first, second ]).toEqual([ BINARY, BINARY ]);
        expect(execFileMock).toHaveBeenCalledTimes(1);

        resetAntigravityBinaryCache();
        execFileMock.mockImplementationOnce((_binary, _args, _options, cb) => cb("killed by signal" as unknown as Error));
        await expect(resolveAntigravityBinaryPath()).rejects.toThrow(/failed to run \(killed by signal\)/);
    });

    it("refuses an override that names no file", async () => {
        existsSyncMock.mockReturnValueOnce(false);
        await expect(resolveAntigravityBinaryPath()).rejects.toThrow(`TRILIUM_ANTIGRAVITY_ACP_PATH is set to "${BINARY}", but no file exists there.`);
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it("looks for the platform's executable on PATH without an override", async () => {
        const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
        delete process.env.TRILIUM_ANTIGRAVITY_ACP_PATH;
        probeReturns("");
        try {
            Object.defineProperty(process, "platform", { ...originalPlatform, value: "linux" });
            findOnPathMock.mockResolvedValueOnce("/opt/agy/agy_acp_server.par");
            await expect(resolveAntigravityBinaryPath()).resolves.toBe("/opt/agy/agy_acp_server.par");
            expect(findOnPathMock).toHaveBeenLastCalledWith("agy_acp_server.par");

            resetAntigravityBinaryCache();
            Object.defineProperty(process, "platform", { ...originalPlatform, value: "win32" });
            findOnPathMock.mockResolvedValueOnce(undefined);
            await expect(resolveAntigravityBinaryPath()).rejects.toThrow(/was not found\. Put the folder.*Google Antigravity/s);
            expect(findOnPathMock).toHaveBeenLastCalledWith("agy_acp_server");
        } finally {
            if (originalPlatform) {
                Object.defineProperty(process, "platform", originalPlatform);
            }
        }
    });
});

describe("parseBuildLabel", () => {
    it("reads the build label, falling back to the first line", () => {
        expect(parseBuildLabel("Built on: today\nBuild label: agy_acp_server_1.2.1 \n")).toBe("agy_acp_server_1.2.1");
        expect(parseBuildLabel("1.2.1\nmore")).toBe("1.2.1");
        expect(parseBuildLabel("")).toBe("");
    });
});
