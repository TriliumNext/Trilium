/**
 * Resolves the GitHub Copilot CLI binary the Copilot Agent provider drives.
 *
 * Like the Claude Agent provider, this runs in "bring-your-own-binary" mode:
 * nothing is bundled with Trilium — the provider spawns the user's own
 * installed `copilot` CLI in ACP mode (`copilot --acp`). Authentication is
 * owned entirely by the CLI (`copilot login`, or credentials shared with any
 * other GitHub Copilot editor integration on the machine).
 *
 * Resolution order: the TRILIUM_COPILOT_PATH override, then `copilot` on
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

export function resolveCopilotBinaryPath(): Promise<string> {
    if (!cachedResolution) {
        cachedResolution = probeBinary().catch((err: unknown) => {
            cachedResolution = undefined;
            throw err;
        });
    }
    return cachedResolution;
}

/** For tests: forget the probed binary so the next call re-resolves. */
export function resetCopilotBinaryCache(): void {
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
        // `shell` is required for the .cmd/.bat shims npm creates on Windows —
        // Node refuses to spawn those directly (CVE-2024-27980). With a shell
        // the command line is not auto-quoted, so quote the path ourselves.
        const shell = needsShell(binary);
        version = (await execFileAsync(shell ? `"${binary}"` : binary, ["--version"], { timeout: 15000, encoding: "utf8", shell })).stdout.trim();
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Found GitHub Copilot CLI at "${binary}" but it failed to run (${detail}). Ensure it is installed correctly and that you've run \`copilot login\` on the machine running the Trilium server.`);
    }

    getLog().info(`Copilot Agent provider: using GitHub Copilot CLI at ${binary} (${version})`);
    return binary;
}

function locateBinary(): string {
    const override = process.env.TRILIUM_COPILOT_PATH?.trim();
    if (override) {
        if (!existsSync(override)) {
            throw new Error(`TRILIUM_COPILOT_PATH is set to "${override}", but no file exists there.`);
        }
        return override;
    }

    const onPath = findOnPath("copilot");
    if (onPath) {
        return onPath;
    }

    throw new Error("GitHub Copilot CLI not found. Install it (`npm install -g @github/copilot`) and run `copilot login` on the machine running the Trilium server, or set the TRILIUM_COPILOT_PATH environment variable to its location.");
}

/**
 * Whether the binary is an npm `.cmd`/`.bat` shim that can only be launched
 * through a shell. Used by both the probe and the ACP spawn.
 */
export function needsShell(binary: string): boolean {
    return /\.(cmd|bat)$/i.test(binary);
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
