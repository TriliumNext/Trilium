/**
 * Resolves the Claude Code CLI binary the Claude Agent provider drives.
 *
 * The provider runs in "bring-your-own-binary" mode: the ~250 MB native binary
 * that the SDK would otherwise bundle is stripped at install time (see
 * `ignoredOptionalDependencies` in the root pnpm-workspace.yaml), so we point
 * the SDK at the user's own installed CLI via
 * `pathToClaudeCodeExecutable`. This keeps the server install lean and lets each
 * platform provide a binary that actually runs there (e.g. the nixpkgs wrapper
 * on NixOS, which needs no glibc/nix-ld shim — unlike the SDK's bundled ELF).
 *
 * Resolution order: the TRILIUM_CLAUDE_CODE_PATH override, then `claude` on
 * PATH. The resolved binary is probed with `--version` once so a broken/absent
 * install surfaces as a clear, actionable error instead of an opaque spawn
 * failure mid-chat.
 */

import { getLog } from "@triliumnext/core";
import { execFile } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * The in-flight/successful resolution. Caching the promise lets concurrent
 * first calls share one probe; a failed probe clears it so a later install is
 * picked up without a restart.
 */
let cachedResolution: Promise<string> | undefined;

export function resolveClaudeBinaryPath(): Promise<string> {
    if (!cachedResolution) {
        cachedResolution = probeBinary().catch((err: unknown) => {
            cachedResolution = undefined;
            throw err;
        });
    }
    return cachedResolution;
}

/** For tests: forget the probed binary so the next call re-resolves. */
export function resetClaudeBinaryCache(): void {
    cachedResolution = undefined;
}

async function probeBinary(): Promise<string> {
    const binary = locateBinary();

    // Probe once: confirms the binary actually runs on this host (catches a
    // wrong-arch/broken install) and records the version for diagnostics.
    // Async on purpose — this runs on the first chat request, and a sync probe
    // would freeze the whole server for up to the 15 s timeout.
    let version: string;
    try {
        version = (await execFileAsync(binary, ["--version"], {
            timeout: 15000,
            encoding: "utf8",
            // On Windows the resolved binary is typically a .cmd batch file
            // (npm shim); Node's execFile cannot run .cmd files directly —
            // it must delegate to cmd.exe via `shell: true`.
            shell: process.platform === "win32"
        })).stdout.trim();
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Found Claude Code at "${binary}" but it failed to run (${detail}). Ensure it is installed correctly and that you've run \`claude /login\` on the machine running the Trilium server.`);
    }

    getLog().info(`Claude Agent provider: using Claude Code at ${binary} (${version})`);
    return binary;
}

function locateBinary(): string {
    const override = process.env.TRILIUM_CLAUDE_CODE_PATH?.trim();
    if (override) {
        if (!existsSync(override)) {
            throw new Error(`TRILIUM_CLAUDE_CODE_PATH is set to "${override}", but no file exists there.`);
        }
        return override;
    }

    const onPath = findOnPath("claude");
    if (onPath) {
        return onPath;
    }

    throw new Error("Claude Code CLI not found. Install it (`npm install -g @anthropic-ai/claude-code`) and run `claude /login` on the machine running the Trilium server, or set the TRILIUM_CLAUDE_CODE_PATH environment variable to its location.");
}

function findOnPath(binary: string): string | undefined {
    // On Windows, npm-installed packages create a bare extensionless file (a
    // POSIX bash script for Git Bash/WSL) alongside the real .cmd/.exe shims.
    // The bash script can't be executed by Node's execFile/spawn, so we must
    // try the Windows-native extensions first and skip the bare name entirely.
    const extensions = process.platform === "win32" ? [".cmd", ".exe", ".bat"] : [""];
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
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
