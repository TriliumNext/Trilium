import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The login-shell read drives the real execFile through util.promisify's
// callback fallback, so the mock receives (shell, args, options, callback).
type ExecFileCallback = (err: Error | null, result?: { stdout: string; stderr: string }) => void;
const execFileMock = vi.hoisted(() => vi.fn<(binary: string, args: string[], options: object, cb: ExecFileCallback) => void>());
vi.mock("child_process", () => ({ execFile: execFileMock }));

const existsSyncMock = vi.hoisted(() => vi.fn((_path: string) => true));
vi.mock("fs", () => ({ existsSync: existsSyncMock }));

vi.mock("@triliumnext/core", () => ({ getLog: () => ({ info: vi.fn(), error: vi.fn() }) }));

const { extractPathFromShellEnv, findOnPath, resetLoginShellPathCache } = await import("./binary_lookup.js");

const NVM_BIN = path.join("/home/user", ".nvm", "versions", "node", "v24.19.0", "bin");
const CLAUDE = path.join(NVM_BIN, "claude");

describe("findOnPath", () => {
    const originalPath = process.env.PATH;
    const originalShell = process.env.SHELL;
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

    beforeEach(() => {
        resetLoginShellPathCache();
        execFileMock.mockReset();
        existsSyncMock.mockReset();
        existsSyncMock.mockReturnValue(false);
        stubPlatform("linux");
        process.env.SHELL = "/bin/zsh";
    });

    afterEach(() => {
        process.env.PATH = originalPath;
        if (originalShell === undefined) {
            delete process.env.SHELL;
        } else {
            process.env.SHELL = originalShell;
        }
        if (originalPlatform) {
            Object.defineProperty(process, "platform", originalPlatform);
        }
    });

    function stubPlatform(platform: NodeJS.Platform) {
        Object.defineProperty(process, "platform", { ...originalPlatform, value: platform });
    }

    /** Answers the login-shell read with a delimited `env` dump exporting `path`. */
    function loginShellReports(shellPath: string) {
        execFileMock.mockImplementation((_shell, _args, _options, cb) => cb(null, {
            stdout: [
                "Welcome to your shell!",
                "__TRILIUM_SHELL_ENV__HOME=/home/user",
                `PATH=${shellPath}`,
                "SHELL=/bin/zsh__TRILIUM_SHELL_ENV__",
                "you have mail"
            ].join("\n"),
            stderr: ""
        }));
    }

    it("returns the inherited PATH hit without starting a shell", async () => {
        const hit = path.join("/usr/local/bin", "claude");
        process.env.PATH = ["", "/usr/bin", "/usr/local/bin"].join(path.delimiter);
        existsSyncMock.mockImplementation((candidate: string) => candidate === hit);

        await expect(findOnPath("claude")).resolves.toBe(hit);
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it("falls back to the login shell's PATH and adopts it, asking the shell only once", async () => {
        // The launchd PATH a GUI-launched app inherits — no version manager.
        process.env.PATH = ["/usr/bin", "/bin"].join(path.delimiter);
        existsSyncMock.mockImplementation((candidate: string) => candidate === CLAUDE);
        loginShellReports([NVM_BIN, "/usr/bin", "/bin"].join(path.delimiter));

        await expect(findOnPath("claude")).resolves.toBe(CLAUDE);

        // The subprocess needs the same PATH (an npm shim resolves `node`
        // through it), and the inherited entries keep their precedence.
        expect(process.env.PATH?.split(path.delimiter)).toEqual(["/usr/bin", "/bin", NVM_BIN]);

        const [shell, args] = execFileMock.mock.calls[0];
        expect(shell).toBe("/bin/zsh");
        expect(args[0]).toBe("-ilc");

        // A second lookup reuses the cached answer rather than paying for
        // another shell startup.
        await expect(findOnPath("claude")).resolves.toBe(CLAUDE);
        expect(execFileMock).toHaveBeenCalledTimes(1);
    });

    it("leaves PATH untouched when the login shell cannot reach the binary either", async () => {
        process.env.PATH = "/usr/bin";
        loginShellReports(["/usr/bin", "/opt/other/bin"].join(path.delimiter));

        await expect(findOnPath("claude")).resolves.toBeUndefined();
        expect(process.env.PATH).toBe("/usr/bin");
    });

    it("gives up quietly when the shell fails, reports no PATH, or there is none to ask", async () => {
        process.env.PATH = "/usr/bin";

        execFileMock.mockImplementation((_shell, _args, _options, cb) => cb(new Error("spawn EACCES")));
        await expect(findOnPath("claude")).resolves.toBeUndefined();

        resetLoginShellPathCache();
        loginShellReports("");
        await expect(findOnPath("claude")).resolves.toBeUndefined();

        resetLoginShellPathCache();
        execFileMock.mockReset();
        delete process.env.SHELL;
        await expect(findOnPath("claude")).resolves.toBeUndefined();
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it("skips the login shell on Windows and probes the executable extensions", async () => {
        stubPlatform("win32");
        const dir = path.join("npm", "prefix");
        const shim = path.join(dir, "claude.cmd");
        process.env.PATH = dir;
        existsSyncMock.mockImplementation((candidate: string) => candidate === shim);

        await expect(findOnPath("claude")).resolves.toBe(shim);

        // Only the unusable bare POSIX script is left: no .cmd/.exe/.bat, and
        // $SHELL is meaningless here, so nothing is spawned.
        existsSyncMock.mockImplementation((candidate: string) => candidate === path.join(dir, "claude"));
        await expect(findOnPath("claude")).resolves.toBeUndefined();
        expect(execFileMock).not.toHaveBeenCalled();
    });
});

describe("extractPathFromShellEnv", () => {
    it("reads PATH from between the delimiters, ignoring rc-file chatter around them", () => {
        const dump = `nvm loaded\n__TRILIUM_SHELL_ENV__A=1\nPATH=/a:/b\nZ=2__TRILIUM_SHELL_ENV__\nbye`;
        expect(extractPathFromShellEnv(dump)).toBe("/a:/b");
    });

    it("returns undefined for an unterminated dump, a missing PATH, or an empty one", () => {
        expect(extractPathFromShellEnv("__TRILIUM_SHELL_ENV__PATH=/a")).toBeUndefined();
        expect(extractPathFromShellEnv("__TRILIUM_SHELL_ENV__HOME=/h__TRILIUM_SHELL_ENV__")).toBeUndefined();
        expect(extractPathFromShellEnv("__TRILIUM_SHELL_ENV__PATH=__TRILIUM_SHELL_ENV__")).toBeUndefined();
        // A PATH printed outside the delimiters is rc-file output, not the env.
        expect(extractPathFromShellEnv("PATH=/spoofed")).toBeUndefined();
    });
});
