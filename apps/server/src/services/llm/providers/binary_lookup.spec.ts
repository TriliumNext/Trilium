import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The login-shell read drives the real execFile through util.promisify's
// callback fallback, so the mock receives (shell, args, options, callback).
type ExecFileCallback = (err: Error | null, result?: { stdout: string; stderr: string }) => void;
const execFileMock = vi.hoisted(() => vi.fn<(binary: string, args: string[], options: object, cb: ExecFileCallback) => void>());
vi.mock("child_process", () => ({ execFile: execFileMock }));

const existsSyncMock = vi.hoisted(() => vi.fn((_path: string) => true));
const writeFileSyncMock = vi.hoisted(() => vi.fn<(file: string, content: string) => void>());
vi.mock("fs", () => ({ existsSync: existsSyncMock, mkdirSync: vi.fn(), writeFileSync: writeFileSyncMock, chmodSync: vi.fn() }));
vi.mock("../../data_dir.js", () => ({ default: { TRILIUM_DATA_DIR: "/data" } }));

vi.mock("@triliumnext/core", () => ({ getLog: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock("i18next", () => ({ t: (key: string, options: object) => `${key} ${JSON.stringify(options)}` }));

const { buildHostLauncher, describeFlatpakSandbox, extractPathFromShellEnv, findOnPath, needsShell, resetLoginShellPathCache } = await import("./binary_lookup.js");

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

describe("needsShell", () => {
    it("is true only for .cmd/.bat shims", () => {
        expect(needsShell("C:\\npm\\copilot.cmd")).toBe(true);
        expect(needsShell("C:\\npm\\copilot.bat")).toBe(true);
        expect(needsShell("C:\\npm\\copilot.CMD")).toBe(true);
        expect(needsShell("/usr/bin/copilot")).toBe(false);
        expect(needsShell("C:\\npm\\copilot.exe")).toBe(false);
    });
});

describe("inside a Flatpak", () => {
    const LAUNCHER = path.resolve("/data", "flatpak-host", "claude");

    beforeEach(() => {
        resetLoginShellPathCache();
        execFileMock.mockReset();
        writeFileSyncMock.mockReset();
        process.env.FLATPAK_ID = "org.triliumnotes.Trilium";
    });

    afterEach(() => {
        delete process.env.FLATPAK_ID;
    });

    /** Answers each `flatpak-spawn` call by the host command it runs. */
    function hostAnswers(answer: (hostArgs: string[]) => string | Error) {
        execFileMock.mockImplementation((binary, args, _options, cb) => {
            expect(binary).toBe("flatpak-spawn");
            const result = answer(args);
            if (result instanceof Error) {
                cb(result);
            } else {
                cb(null, { stdout: result, stderr: "" });
            }
        });
    }

    it("finds the CLI on the host's PATH and returns a launcher for it", async () => {
        hostAnswers((args) => (args.includes("command -v \"$1\"") ? "/usr/bin/claude\n" : ""));

        await expect(findOnPath("claude")).resolves.toBe(LAUNCHER);
        expect(execFileMock.mock.calls.map(([ , args ]) => args)).toEqual([
            [ "--host", "true" ],
            [ "--host", "sh", "-c", "command -v \"$1\"", "sh", "claude" ]
        ]);
        expect(writeFileSyncMock).toHaveBeenCalledWith(LAUNCHER, buildHostLauncher("/usr/bin/claude"));
    });

    it("falls back to the host's login shell, whose PATH the launcher then carries", async () => {
        const loginPath = "/home/user/.nvm/bin:/usr/bin";
        hostAnswers((args) => {
            if (args.includes("--env=TERM=dumb")) {
                return `__TRILIUM_SHELL_ENV__PATH=${loginPath}\n__TRILIUM_SHELL_ENV__`;
            }
            if (args.includes("command -v \"$1\"")) {
                return args.includes(`--env=PATH=${loginPath}`) ? "/home/user/.nvm/bin/claude\n" : "";
            }
            return "";
        });

        await expect(findOnPath("claude")).resolves.toBe(LAUNCHER);
        expect(writeFileSyncMock).toHaveBeenCalledWith(
            LAUNCHER, buildHostLauncher("/home/user/.nvm/bin/claude", loginPath));
    });

    it("reports no CLI when the host has none, or `command -v` names a builtin or alias", async () => {
        hostAnswers((args) => (args.includes("command -v \"$1\"") ? "claude\n" : ""));
        await expect(findOnPath("claude")).resolves.toBeUndefined();
        expect(writeFileSyncMock).not.toHaveBeenCalled();
        // Asked on the session's PATH, then on the login shell's, which reported none.
        expect(execFileMock.mock.calls.filter(([ , args ]) => args.includes("command -v \"$1\""))).toHaveLength(1);
        expect(execFileMock.mock.calls.some(([ , args ]) => args.includes("--env=TERM=dumb"))).toBe(true);
    });

    it("explains the override only when the sandbox blocks the host", async () => {
        hostAnswers(() => new Error("Portal call failed: org.freedesktop.DBus.Error.ServiceUnknown"));
        const message = await describeFlatpakSandbox("Claude Code");
        expect(message).toBe(`llm_providers.flatpak_sandbox ${JSON.stringify({
            cli: "Claude Code",
            grantCommand: "flatpak override --user --talk-name=org.freedesktop.Flatpak org.triliumnotes.Trilium",
            revokeCommand: "flatpak override --user --no-talk-name=org.freedesktop.Flatpak org.triliumnotes.Trilium"
        })}`);
        // The lookup stays on the sandbox's own PATH, where a CLI could still be.
        expect(execFileMock.mock.calls.filter(([ , args ]) => args.includes("command -v \"$1\""))).toEqual([]);

        resetLoginShellPathCache();
        hostAnswers(() => "");
        await expect(describeFlatpakSandbox("Claude Code")).resolves.toBeUndefined();

        delete process.env.FLATPAK_ID;
        await expect(describeFlatpakSandbox("Claude Code")).resolves.toBeUndefined();
    });
});

describe.skipIf(process.platform === "win32")("buildHostLauncher", () => {
    it("runs the CLI through flatpak-spawn with the CLI's variables and a host directory", async () => {
        const realFs = await vi.importActual<typeof import("fs")>("fs");
        const { execFileSync } = await vi.importActual<typeof import("child_process")>("child_process");
        const os = await vi.importActual<typeof import("os")>("os");
        const dir = realFs.mkdtempSync(path.join(os.tmpdir(), "trilium-launcher-"));
        try {
            // A stand-in for flatpak-spawn that prints its directory and arguments.
            const fakeSpawn = path.join(dir, "flatpak-spawn");
            realFs.writeFileSync(fakeSpawn, "#!/bin/sh\npwd\nfor arg in \"$@\"; do printf '%s\\n' \"$arg\"; done\n");
            realFs.chmodSync(fakeSpawn, 0o755);
            const launcher = path.join(dir, "claude");
            realFs.writeFileSync(launcher, buildHostLauncher("/opt/it's/claude", "/host/bin:/usr/bin"));
            realFs.chmodSync(launcher, 0o755);

            const home = realFs.mkdtempSync(path.join(dir, "home-"));
            const output = execFileSync(launcher, [ "--print", "two words", "$HOME" ], {
                cwd: dir,
                encoding: "utf8",
                env: {
                    PATH: `${dir}:${process.env.PATH}`,
                    HOME: home,
                    CLAUDE_CODE_ENTRYPOINT: "sdk-ts \"quoted\" $(not run)",
                    CODEX_HOME: "/data/codex-agent",
                    UNRELATED: "left out"
                }
            });

            const [ cwd, ...args ] = output.trimEnd().split("\n");
            // `dir` is outside HOME, so the launcher moved to HOME first.
            expect(cwd).toBe(home);
            expect(args.slice(0, 3)).toEqual([ "--host", "--watch-bus", "--env=PATH=/host/bin:/usr/bin" ]);
            expect(args.slice(-4)).toEqual([ "/opt/it's/claude", "--print", "two words", "$HOME" ]);
            expect(args.slice(3, -4).sort()).toEqual([
                "--env=CLAUDE_CODE_ENTRYPOINT=sdk-ts \"quoted\" $(not run)",
                "--env=CODEX_HOME=/data/codex-agent"
            ]);
        } finally {
            realFs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
