/**
 * Resolves the GitHub Copilot CLI binary the Copilot Agent provider drives.
 *
 * Like the Claude Agent provider, this runs in "bring-your-own-binary" mode:
 * nothing is bundled with Trilium — the provider spawns the user's own
 * installed `copilot` CLI in ACP mode (`copilot --acp`). Authentication is
 * owned entirely by the CLI (`copilot login`, or credentials shared with any
 * other GitHub Copilot editor integration on the machine).
 *
 * Resolution order: the TRILIUM_COPILOT_PATH override, then `copilot` on PATH
 * (see `findOnPath`, which also asks the login shell). The resolved binary is
 * probed with `--version` once so a broken/absent install surfaces as a clear,
 * actionable error instead of an opaque spawn failure mid-chat.
 *
 * The probe must cope with a wrapper standing in for the CLI: VS Code's
 * Copilot Chat extension puts a `copilot` bootstrapper on the PATH of its
 * terminals that, when the real CLI is not installed, prints why and asks on
 * stdin whether to install it. The probe closes stdin so the question reads
 * end-of-file instead of waiting out the timeout, and requires a version
 * number in the output, because the wrapper then exits 0 without one.
 */

import { getLog } from "@triliumnext/core";
import { existsSync } from "fs";

import { cachedProbe, findOnPath, runVersionProbe } from "./binary_lookup.js";

const PROBE_TIMEOUT_MS = 15000;

/** The probed binary, shared by concurrent first calls (see {@link cachedProbe}). */
const probed = cachedProbe(probeBinary);

export function resolveCopilotBinaryPath(): Promise<string> {
    return probed.resolve();
}

/** For tests: forget the probed binary so the next call re-resolves. */
export function resetCopilotBinaryCache(): void {
    probed.reset();
}

async function probeBinary(): Promise<string> {
    const binary = await locateBinary();

    // Probe once: confirms the binary actually runs on this host (catches a
    // wrong-arch/broken install) and records the version for diagnostics.
    // Async on purpose — this runs on the first chat request, and a sync probe
    // would freeze the whole server for up to the timeout.
    const { output, failure } = await runVersionProbe(binary, PROBE_TIMEOUT_MS);
    const version = failure ? undefined : output.split("\n").find((line) => /\d+\.\d+\.\d+/.test(line))?.trim();
    if (!version) {
        const reason = failure ?? "did not report a version";
        throw new Error([
            "Found GitHub Copilot CLI at:",
            binary,
            `but it failed to run: ${output ? `${reason}.\n\nIt printed:\n${output}` : reason}`,
            "",
            "Ensure it is installed correctly and that you've run `copilot login` on the machine running the Trilium server."
        ].join("\n"));
    }

    getLog().info(`Copilot Agent provider: using GitHub Copilot CLI at ${binary} (${version})`);
    return binary;
}

async function locateBinary(): Promise<string> {
    const override = process.env.TRILIUM_COPILOT_PATH?.trim();
    if (override) {
        if (!existsSync(override)) {
            throw new Error(`TRILIUM_COPILOT_PATH is set to "${override}", but no file exists there.`);
        }
        return override;
    }

    const onPath = await findOnPath("copilot");
    if (onPath) {
        return onPath;
    }

    throw new Error("GitHub Copilot CLI not found. Install it (`npm install -g @github/copilot`) and run `copilot login` on the machine running the Trilium server, or set the TRILIUM_COPILOT_PATH environment variable to its location.");
}
