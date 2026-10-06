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
 */

import { getLog } from "@triliumnext/core";
import { execFile } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Brackets the `env` dump so rc-file chatter can be discarded around it. */
const DELIMITER = "__TRILIUM_SHELL_ENV__";

/** Upper bound on the login shell's startup: rc files can source a lot. */
const LOGIN_SHELL_TIMEOUT_MS = 10000;

/**
 * Finds `binary` on PATH, falling back to the login shell's PATH. Returns the
 * full path to the executable, or `undefined` if it is installed nowhere the
 * user's shell could reach it either.
 */
export async function findOnPath(binary: string): Promise<string | undefined> {
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
    const args = ["-ilc", `printf %s ${DELIMITER}; env; printf %s ${DELIMITER}`];
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
