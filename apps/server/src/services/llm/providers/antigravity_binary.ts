/**
 * Resolves Google's Antigravity ACP server (`agy_acp_server`), which the
 * Antigravity Agent provider drives.
 *
 * Bring-your-own-binary like the other agent providers: nothing is bundled. The
 * server ships as a zip from Google (the ACP registry's `antigravity-acp`
 * entry), whose executable is `agy_acp_server.par` on Linux and macOS and
 * `agy_acp_server.exe` on Windows, next to the `localharness_external` helper it
 * launches — so it is run from where it was unpacked rather than copied.
 *
 * Resolution order: the TRILIUM_ANTIGRAVITY_ACP_PATH override, then the
 * executable on PATH (see `findOnPath`, which also asks the login shell). The
 * resolved binary is probed once (see {@link PROBE_ARGS}) so a broken or wrong-arch
 * download surfaces as a clear error instead of an opaque spawn failure
 * mid-chat.
 */

import { getLog } from "@triliumnext/core";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";

import { findOnPath } from "./binary_lookup.js";

const execFileAsync = promisify(execFile);

/**
 * Prints the build label and exits without starting the server. The Linux and
 * macOS `.par` builds print it for `--version`; the Windows build defines no
 * such flag, so `--undefok` lets it through and `--only_check_args` makes it
 * exit once the flags parse.
 */
const PROBE_ARGS = [ "--undefok=version", "--version", "--only_check_args" ];

/** The Windows build unpacks its bundled Python on every start, which takes about 15 seconds. */
const PROBE_TIMEOUT_MS = 60_000;

/** Where the setup steps live; the error messages point there. */
const SETUP_HINT = "See \"Google Antigravity\" in the AI section of the User Guide for how to download it.";

/**
 * The in-flight/successful resolution. Caching the promise lets concurrent
 * first calls share one probe; a failed probe clears it so a later install is
 * picked up without a restart.
 */
let cachedResolution: Promise<string> | undefined;

export function resolveAntigravityBinaryPath(): Promise<string> {
    if (!cachedResolution) {
        cachedResolution = probeBinary().catch((err: unknown) => {
            cachedResolution = undefined;
            throw err;
        });
    }
    return cachedResolution;
}

/** For tests: forget the probed binary so the next call re-resolves. */
export function resetAntigravityBinaryCache(): void {
    cachedResolution = undefined;
}

/**
 * The version from `--version`, which prints the build stamp: its
 * `Build label: agy_acp_server_1.1.1` line, or the first line when that is
 * missing.
 */
export function parseBuildLabel(output: string): string {
    return /^Build label:\s*(.+)$/m.exec(output)?.[1].trim() ?? output.split("\n")[0].trim();
}

async function probeBinary(): Promise<string> {
    const binary = await locateBinary();

    // Async on purpose — this runs on the first chat request, and a sync probe
    // would freeze the whole server for up to the timeout.
    let version: string;
    try {
        const { stdout } = await execFileAsync(binary, PROBE_ARGS, { timeout: PROBE_TIMEOUT_MS, encoding: "utf8" });
        version = parseBuildLabel(stdout) || "version not reported";
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Found Google's Antigravity ACP server at "${binary}" but it failed to run (${detail}). ${SETUP_HINT}`);
    }

    getLog().info(`Antigravity Agent provider: using the Antigravity ACP server at ${binary} (${version})`);
    return binary;
}

async function locateBinary(): Promise<string> {
    const override = process.env.TRILIUM_ANTIGRAVITY_ACP_PATH?.trim();
    if (override) {
        if (!existsSync(override)) {
            throw new Error(`TRILIUM_ANTIGRAVITY_ACP_PATH is set to "${override}", but no file exists there.`);
        }
        return override;
    }

    // `findOnPath` appends the Windows extensions itself.
    const onPath = await findOnPath(process.platform === "win32" ? "agy_acp_server" : "agy_acp_server.par");
    if (onPath) {
        return onPath;
    }

    throw new Error(`Google's Antigravity ACP server (agy_acp_server) was not found. Put the folder it was unpacked into on PATH, or set the TRILIUM_ANTIGRAVITY_ACP_PATH environment variable to the executable. ${SETUP_HINT}`);
}
