/**
 * Locates and probes the bring-your-own-binary CLIs the agent providers drive
 * (Claude Code, GitHub Copilot, Google Antigravity, OpenAI Codex).
 *
 * A GUI-launched app does not inherit the user's shell environment: on macOS
 * launchd hands `Trilium.app` a bare `/usr/bin:/bin:/usr/sbin:/sbin`, and on
 * Linux a `.desktop` launcher is no better. Version managers (nvm, fnm, asdf,
 * volta) put their bin directory on PATH from an rc file, so the CLI that
 * `pnpm desktop:start` finds is invisible to the packaged build.
 *
 * So the inherited PATH is searched first, and only when that misses does the
 * user's login shell get asked for its own PATH. A hit there is adopted into
 * `process.env.PATH`, because the CLI subprocess needs it too — an npm shim
 * resolves its `node` through PATH.
 *
 * Inside a Flatpak, no CLI installed on the computer is visible. When the user
 * allows the app to talk to `org.freedesktop.Flatpak`, the CLI is looked up on
 * the host instead and started there through `flatpak-spawn --host`, by a
 * launcher script written into the data directory (see {@link buildHostLauncher}).
 */

import { getLog } from "@triliumnext/core";
import { execFile } from "child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { t } from "i18next";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Brackets the `env` dump so rc-file chatter can be discarded around it. */
const DELIMITER = "__TRILIUM_SHELL_ENV__";

/** Upper bound on the login shell's startup: rc files can source a lot. */
const LOGIN_SHELL_TIMEOUT_MS = 10000;

/** Upper bound on a `flatpak-spawn --host` call that only checks or looks something up. */
const HOST_LOOKUP_TIMEOUT_MS = 5000;

/** The `env` dump a login shell prints, delimited so rc-file chatter can be discarded. */
const ENV_DUMP_SCRIPT = `printf %s ${DELIMITER}; env; printf %s ${DELIMITER}`;

/**
 * The variables a host launcher passes from Trilium to the CLI. `flatpak-spawn --host` starts
 * the CLI with the session's environment, not Trilium's, so the variables the SDK and the
 * providers set (`CLAUDE_CODE_ENTRYPOINT`, `CODEX_HOME`, `GEMINI_HOME`) are passed explicitly.
 */
const HOST_ENV_PREFIXES = [ "ANTHROPIC_", "CLAUDE_", "CODEX_", "COPILOT_", "GEMINI_", "GH_", "GITHUB_" ];

/**
 * Finds `binary` on PATH, falling back to the login shell's PATH. Returns the
 * full path to the executable, or `undefined` if it is installed nowhere the
 * user's shell could reach it either. Inside a Flatpak that may start programs
 * on the host, returns a launcher for the host's `binary` instead.
 */
export async function findOnPath(binary: string): Promise<string | undefined> {
    if (process.env.FLATPAK_ID && await canReachFlatpakHost()) {
        return findOnFlatpakHost(binary);
    }

    const inherited = searchPath(process.env.PATH, binary);
    if (inherited) {
        return inherited;
    }

    const loginShellPath = await resolveLoginShellPath();
    if (!loginShellPath) {
        return undefined;
    }

    const found = searchPath(loginShellPath, binary);
    if (found) {
        process.env.PATH = mergePaths(process.env.PATH, loginShellPath);
        getLog().info(`Adopted PATH from the login shell to reach ${binary} at ${found}`);
    }
    return found;
}

/**
 * Why `cli` cannot be found when Trilium runs as a Flatpak that may not start programs on the
 * host, with the steps that allow it. `undefined` outside a Flatpak, or once the host is
 * reachable and the CLI is simply not installed there.
 */
export async function describeFlatpakSandbox(cli: string): Promise<string | undefined> {
    const appId = process.env.FLATPAK_ID;
    if (!appId || await canReachFlatpakHost()) {
        return undefined;
    }
    return t("llm_providers.flatpak_sandbox", {
        cli,
        grantCommand: `flatpak override --user --talk-name=org.freedesktop.Flatpak ${appId}`,
        revokeCommand: `flatpak override --user --no-talk-name=org.freedesktop.Flatpak ${appId}`
    });
}

/**
 * The script that starts `hostBinary` on the host from inside the Flatpak. It passes the
 * variables named by {@link HOST_ENV_PREFIXES}, and moves to the home directory when the
 * current one exists only in the sandbox, which `flatpak-spawn` would refuse to start in.
 * `hostPath` is the login shell's PATH, set when that is where the CLI was found.
 */
export function buildHostLauncher(hostBinary: string, hostPath?: string): string {
    const pathFlag = hostPath ? ` ${shellQuote(`--env=PATH=${hostPath}`)}` : "";
    const prefixes = HOST_ENV_PREFIXES.map((prefix) => `${prefix}*`).join("|");
    return `#!/bin/sh
# Written by Trilium: runs ${hostBinary} outside the Flatpak sandbox.
set -- ${shellQuote(hostBinary)} "$@"
for var in $(env | sed -n 's/^\\([A-Za-z_][A-Za-z0-9_]*\\)=.*/\\1/p'); do
    case "$var" in
        ${prefixes}) eval "set -- \\"--env=$var=\\\${$var}\\" \\"\\$@\\"" ;;
    esac
done
case "$PWD" in
    "$HOME" | "$HOME"/*) ;;
    *) cd "$HOME" || exit 1 ;;
esac
exec flatpak-spawn --host --watch-bus${pathFlag} "$@"
`;
}

/**
 * Memoize a binary probe: concurrent first calls share one run, and a failed
 * one is forgotten so a later install is picked up without a restart.
 */
export function cachedProbe(probe: () => Promise<string>): { resolve: () => Promise<string>; reset: () => void } {
    let cached: Promise<string> | undefined;
    return {
        resolve() {
            if (!cached) {
                cached = probe().catch((err: unknown) => {
                    cached = undefined;
                    throw err;
                });
            }
            return cached;
        },
        reset() {
            cached = undefined;
        }
    };
}

/**
 * Runs `binary --version` with stdin closed and resolves with everything it
 * printed, stdout before stderr. On failure, `failure` names the timeout or
 * carries execFile's own message for a spawn or exit failure.
 */
export function runVersionProbe(binary: string, timeoutMs: number): Promise<{ output: string; failure?: string }> {
    return new Promise((resolve) => {
        // `shell` is required for the .cmd/.bat shims npm creates on Windows —
        // Node refuses to spawn those directly (CVE-2024-27980). With a shell
        // the command line is not auto-quoted, so quote the path ourselves.
        const shell = needsShell(binary);
        const options = { timeout: timeoutMs, encoding: "utf8" as const, shell };
        const child = execFile(shell ? `"${binary}"` : binary, ["--version"], options, (err, stdout, stderr) => {
            const output = [stdout, stderr].map((text) => text.trim()).filter(Boolean).join("\n");
            if (!err) {
                resolve({ output });
            } else if (err.killed) {
                resolve({ output, failure: `did not exit within ${timeoutMs / 1000} seconds` });
            } else {
                // execFile's message already quotes stderr after the command.
                const failure = (err instanceof Error ? err.message : String(err)).trim();
                resolve({ output: stdout.trim(), failure });
            }
        });
        child.stdin?.end();
    });
}

/**
 * Whether the binary is an npm `.cmd`/`.bat` shim that can only be launched
 * through a shell. Used by the version probe and the ACP spawn.
 */
export function needsShell(binary: string): boolean {
    return /\.(cmd|bat)$/i.test(binary);
}

/** For tests: forget the login shell's PATH so the next call re-reads it. */
export function resetLoginShellPathCache(): void {
    cachedLoginShellPath = undefined;
    cachedHostReachable = undefined;
    cachedHostLoginShellPath = undefined;
}

/**
 * Extracts the `PATH` value from the delimited `env` dump a login shell wrote.
 * Returns `undefined` when the shell exited before both delimiters were
 * printed, or when it reported no PATH at all.
 */
export function extractPathFromShellEnv(shellOutput: string): string | undefined {
    const start = shellOutput.indexOf(DELIMITER);
    const end = shellOutput.lastIndexOf(DELIMITER);
    if (start === -1 || end <= start) {
        return undefined;
    }

    const env = shellOutput.slice(start + DELIMITER.length, end);
    return /^PATH=(.+)$/m.exec(env)?.[1];
}

function searchPath(rawPath: string | undefined, binary: string): string | undefined {
    // On Windows, npm-installed packages create a bare extensionless file (a
    // POSIX bash script for Git Bash/WSL) alongside the real .cmd/.exe shims.
    // The bash script can't be executed by Node's execFile/spawn, so we must
    // try the Windows-native extensions first and skip the bare name entirely.
    const extensions = process.platform === "win32" ? [".cmd", ".exe", ".bat"] : [""];
    for (const dir of (rawPath ?? "").split(path.delimiter)) {
        if (!dir) {
            continue;
        }
        for (const ext of extensions) {
            const candidate = path.join(dir, binary + ext);
            if (existsSync(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}

/**
 * The in-flight/successful login shell read. A failed read is cached too: the
 * shell is unlikely to answer differently before a restart, and every miss
 * costs a full shell startup.
 */
let cachedLoginShellPath: Promise<string | undefined> | undefined;

function resolveLoginShellPath(): Promise<string | undefined> {
    if (!cachedLoginShellPath) {
        cachedLoginShellPath = readLoginShellPath();
    }
    return cachedLoginShellPath;
}

async function readLoginShellPath(): Promise<string | undefined> {
    // Windows has no login-shell profile that PATH is built from, and $SHELL is
    // how the shell to ask is named.
    const shell = process.platform === "win32" ? undefined : process.env.SHELL?.trim();
    if (!shell) {
        return undefined;
    }

    // `printf` and `env` are external commands, so the dump reads the same under
    // bash, zsh, fish and dash. `-i` matters: nvm and fnm are commonly set up in
    // an interactive-only rc file (.zshrc, .bashrc).
    const args = ["-ilc", ENV_DUMP_SCRIPT];
    try {
        const { stdout } = await execFileAsync(shell, args, {
            timeout: LOGIN_SHELL_TIMEOUT_MS,
            encoding: "utf8",
            maxBuffer: 1024 * 1024,
            // A shell that believes it drives a terminal can redraw a prompt or
            // start an instant-prompt plugin over the output we parse.
            env: { ...process.env, TERM: "dumb" }
        });
        return extractPathFromShellEnv(stdout);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        getLog().info(`Could not read PATH from the login shell "${shell}" (${detail})`);
        return undefined;
    }
}

/** Keeps the inherited entries ahead of the login shell's, without duplicates. */
function mergePaths(inherited: string | undefined, loginShell: string): string {
    const entries = [
        ...(inherited ?? "").split(path.delimiter),
        ...loginShell.split(path.delimiter)
    ];
    return [...new Set(entries.filter((entry) => entry))].join(path.delimiter);
}

/** Whether `flatpak-spawn --host` works, which takes the user's `--talk-name` override. */
let cachedHostReachable: Promise<boolean> | undefined;

function canReachFlatpakHost(): Promise<boolean> {
    if (!cachedHostReachable) {
        cachedHostReachable = execFileAsync("flatpak-spawn", [ "--host", "true" ], { timeout: HOST_LOOKUP_TIMEOUT_MS })
            .then(() => true, (err: unknown) => {
                const detail = err instanceof Error ? err.message : String(err);
                getLog().info(`Running as a Flatpak that cannot start programs on the host (${detail})`);
                return false;
            });
    }
    return cachedHostReachable;
}

/**
 * Looks `binary` up on the host's PATH, then on its login shell's, and writes a launcher for it.
 * The lookup runs `command -v` in the host's `sh`, since no host path can be tested from inside
 * the sandbox.
 */
async function findOnFlatpakHost(binary: string): Promise<string | undefined> {
    const onSessionPath = await commandOnHost(binary);
    if (onSessionPath) {
        return writeHostLauncher(binary, onSessionPath);
    }

    const loginShellPath = await resolveHostLoginShellPath();
    const onLoginShellPath = loginShellPath ? await commandOnHost(binary, loginShellPath) : undefined;
    if (!onLoginShellPath) {
        return undefined;
    }
    getLog().info(`Found ${binary} at ${onLoginShellPath} on the PATH of the host's login shell`);
    return writeHostLauncher(binary, onLoginShellPath, loginShellPath);
}

async function commandOnHost(binary: string, hostPath?: string): Promise<string | undefined> {
    const pathFlag = hostPath ? [ `--env=PATH=${hostPath}` ] : [];
    try {
        const { stdout } = await execFileAsync("flatpak-spawn", [
            "--host", ...pathFlag, "sh", "-c", "command -v \"$1\"", "sh", binary
        ], { timeout: HOST_LOOKUP_TIMEOUT_MS, encoding: "utf8" });
        const found = stdout.trim();
        // `command -v` prints a bare name for a builtin, function or alias.
        return path.posix.isAbsolute(found) ? found : undefined;
    } catch {
        return undefined;
    }
}

/** The host login shell's PATH; a failed read is cached too, as for {@link resolveLoginShellPath}. */
let cachedHostLoginShellPath: Promise<string | undefined> | undefined;

function resolveHostLoginShellPath(): Promise<string | undefined> {
    if (!cachedHostLoginShellPath) {
        cachedHostLoginShellPath = readHostLoginShellPath();
    }
    return cachedHostLoginShellPath;
}

async function readHostLoginShellPath(): Promise<string | undefined> {
    // The sandbox sets SHELL to its own /bin/sh, so the host's `sh` reads the session's SHELL.
    try {
        const { stdout } = await execFileAsync("flatpak-spawn", [
            "--host", "--env=TERM=dumb", "sh", "-c", "exec \"${SHELL:-/bin/sh}\" -ilc \"$1\"", "sh", ENV_DUMP_SCRIPT
        ], { timeout: LOGIN_SHELL_TIMEOUT_MS, encoding: "utf8", maxBuffer: 1024 * 1024 });
        return extractPathFromShellEnv(stdout);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        getLog().info(`Could not read PATH from the host's login shell (${detail})`);
        return undefined;
    }
}

async function writeHostLauncher(binary: string, hostBinary: string, hostPath?: string): Promise<string> {
    // Imported here: data_dir resolves the data directory as soon as it loads.
    const { default: dataDirs } = await import("../../data_dir.js");
    const dir = path.resolve(dataDirs.TRILIUM_DATA_DIR, "flatpak-host");
    mkdirSync(dir, { recursive: true });
    const launcher = path.join(dir, binary);
    writeFileSync(launcher, buildHostLauncher(hostBinary, hostPath));
    chmodSync(launcher, 0o755);
    return launcher;
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}
