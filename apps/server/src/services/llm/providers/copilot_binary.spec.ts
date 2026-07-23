import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The probe drives the real execFile through util.promisify's callback
// fallback, so the mock receives (binary, args, options, callback).
type ExecFileCallback = (err: Error | null, result?: { stdout: string; stderr: string }) => void;
const execFileMock = vi.hoisted(() => vi.fn<(binary: string, args: string[], options: object, cb: ExecFileCallback) => void>());
vi.mock("child_process", () => ({ execFile: execFileMock }));

const existsSyncMock = vi.hoisted(() => vi.fn((_path: string) => true));
vi.mock("fs", () => ({ existsSync: existsSyncMock }));

vi.mock("@triliumnext/core", () => ({ getLog: () => ({ info: vi.fn(), error: vi.fn() }) }));

const { needsShell, resetCopilotBinaryCache, resolveCopilotBinaryPath } = await import("./copilot_binary.js");

describe("resolveCopilotBinaryPath", () => {
    const originalOverride = process.env.TRILIUM_COPILOT_PATH;
    const originalPath = process.env.PATH;
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

    beforeEach(() => {
        resetCopilotBinaryCache();
        execFileMock.mockReset();
        existsSyncMock.mockReset();
        existsSyncMock.mockReturnValue(true);
        process.env.TRILIUM_COPILOT_PATH = "/opt/copilot/copilot";
    });

    afterEach(() => {
        if (originalOverride === undefined) {
            delete process.env.TRILIUM_COPILOT_PATH;
        } else {
            process.env.TRILIUM_COPILOT_PATH = originalOverride;
        }
        process.env.PATH = originalPath;
        if (originalPlatform) {
            Object.defineProperty(process, "platform", originalPlatform);
        }
    });

    function stubPlatform(platform: NodeJS.Platform) {
        Object.defineProperty(process, "platform", { ...originalPlatform, value: platform });
    }

    function probeSucceeds() {
        execFileMock.mockImplementation((_binary, _args, _options, cb) => cb(null, { stdout: "1.0.71\n", stderr: "" }));
    }

    it("probes the overridden binary once and shares the result across calls (even concurrent ones)", async () => {
        probeSucceeds();

        const [first, second] = await Promise.all([resolveCopilotBinaryPath(), resolveCopilotBinaryPath()]);
        const third = await resolveCopilotBinaryPath();

        expect(first).toBe("/opt/copilot/copilot");
        expect(second).toBe("/opt/copilot/copilot");
        expect(third).toBe("/opt/copilot/copilot");
        expect(execFileMock).toHaveBeenCalledTimes(1);
        expect(execFileMock.mock.calls[0][0]).toBe("/opt/copilot/copilot");
        expect(execFileMock.mock.calls[0][1]).toEqual(["--version"]);
    });

    it("rejects with an actionable message on a broken binary and re-probes on the next call", async () => {
        execFileMock.mockImplementationOnce((_binary, _args, _options, cb) => cb(new Error("spawn ENOENT")));

        await expect(resolveCopilotBinaryPath()).rejects.toThrow(/failed to run.*copilot login/s);

        // The failure must not be cached — a later (fixed) install is picked up.
        probeSucceeds();
        await expect(resolveCopilotBinaryPath()).resolves.toBe("/opt/copilot/copilot");
        expect(execFileMock).toHaveBeenCalledTimes(2);
    });

    it("stringifies non-Error probe failures into the actionable message", async () => {
        execFileMock.mockImplementationOnce((_binary, _args, _options, cb) => cb("killed by signal" as unknown as Error));

        await expect(resolveCopilotBinaryPath()).rejects.toThrow(/failed to run \(killed by signal\)/);
    });

    it("rejects when TRILIUM_COPILOT_PATH points at a missing file, without probing", async () => {
        existsSyncMock.mockReturnValue(false);

        await expect(resolveCopilotBinaryPath()).rejects.toThrow(/TRILIUM_COPILOT_PATH/);
        expect(execFileMock).not.toHaveBeenCalled();
    });

    describe("PATH fallback (no override)", () => {
        beforeEach(() => {
            delete process.env.TRILIUM_COPILOT_PATH;
        });

        it("finds the bare `copilot` binary on POSIX, skipping empty PATH segments", async () => {
            stubPlatform("linux");
            const hit = path.join("/home/user/bin", "copilot");
            // Leading empty segment exercises the `if (!dir) continue` guard.
            process.env.PATH = ["", "/usr/local/bin", "/home/user/bin"].join(path.delimiter);
            existsSyncMock.mockImplementation((candidate: string) => candidate === hit);
            probeSucceeds();

            await expect(resolveCopilotBinaryPath()).resolves.toBe(hit);
            expect(execFileMock.mock.calls[0][0]).toBe(hit);
        });

        it("probes PATHEXT-style extensions on Windows and quotes the shimmed path for the shell", async () => {
            stubPlatform("win32");
            // No drive letter: a `C:` prefix would be split apart by the POSIX
            // `:` PATH delimiter when this spec runs on a non-Windows host.
            const dir = path.join("npm", "prefix");
            const hit = path.join(dir, "copilot.cmd");
            process.env.PATH = dir;
            existsSyncMock.mockImplementation((candidate: string) => candidate === hit);
            probeSucceeds();

            await expect(resolveCopilotBinaryPath()).resolves.toBe(hit);
            // .cmd shim must be launched through a shell, with the path quoted.
            expect(execFileMock.mock.calls[0][0]).toBe(`"${hit}"`);
            expect(execFileMock.mock.calls[0][2]).toMatchObject({ shell: true });
        });

        it("prefers the .cmd shim over the extensionless bash script npm installs beside it", async () => {
            stubPlatform("win32");
            // The real `npm install -g @github/copilot` layout: a POSIX `sh`
            // script (for Git Bash) sits next to the Windows shims. Node cannot
            // spawn the bash script — resolving it fails with a misleading
            // "found it but it failed to run" ENOENT.
            const dir = path.join("npm", "prefix");
            const shim = path.join(dir, "copilot.cmd");
            const bashScript = path.join(dir, "copilot");
            process.env.PATH = dir;
            existsSyncMock.mockImplementation((candidate: string) => candidate === shim || candidate === bashScript);
            probeSucceeds();

            await expect(resolveCopilotBinaryPath()).resolves.toBe(shim);

            // With only the unusable bash script present, the bare name is
            // skipped entirely so the user gets the actionable install message
            // instead of an opaque spawn failure.
            resetCopilotBinaryCache();
            existsSyncMock.mockImplementation((candidate: string) => candidate === bashScript);

            await expect(resolveCopilotBinaryPath()).rejects.toThrow(/GitHub Copilot CLI not found/);
        });

        it("rejects with install instructions when `copilot` is nowhere on PATH (or PATH is unset)", async () => {
            stubPlatform("linux");
            delete process.env.PATH;
            existsSyncMock.mockReturnValue(false);

            await expect(resolveCopilotBinaryPath()).rejects.toThrow(/GitHub Copilot CLI not found/);
            expect(execFileMock).not.toHaveBeenCalled();
        });
    });

    describe("needsShell", () => {
        it("is true only for .cmd/.bat shims", () => {
            expect(needsShell("C:\\npm\\copilot.cmd")).toBe(true);
            expect(needsShell("C:\\npm\\copilot.bat")).toBe(true);
            expect(needsShell("C:\\npm\\copilot.CMD")).toBe(true);
            expect(needsShell("/usr/bin/copilot")).toBe(false);
            expect(needsShell("C:\\npm\\copilot.exe")).toBe(false);
        });
    });
});
