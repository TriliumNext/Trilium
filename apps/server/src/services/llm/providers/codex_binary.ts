/**
 * Resolves what the Codex Agent provider runs: the Codex ACP adapter, which
 * Trilium ships, and the user's own Codex CLI, which the adapter drives.
 *
 * The adapter (`@agentclientprotocol/codex-acp`) is one bundled script that
 * translates ACP into Codex's `codex app-server` protocol. It runs in a worker
 * thread (see `AcpClient.startWorker`), so no Node is needed on the host. The
 * Codex CLI stays bring-your-own like the other agent CLIs: its native build is
 * 300-400 MB per platform, and it must update as fast as OpenAI ships models.
 *
 * The CLI is resolved from the TRILIUM_CODEX_PATH override, then `codex` on
 * PATH (see `findOnPath`, which also asks the login shell), and probed with
 * `--version` once so a broken install surfaces as a clear error instead of an
 * opaque failure mid-chat.
 */

import { getLog } from "@triliumnext/core";
import { existsSync } from "fs";
import path from "path";

import { RESOURCE_DIR } from "../../resource_dir.js";
import { cachedProbe, findOnPath, runVersionProbe } from "./binary_lookup.js";

const PROBE_TIMEOUT_MS = 15000;

const INSTALL_HINT = "Install it (for example with `npm install -g @openai/codex`) on the machine running the Trilium server, or set the TRILIUM_CODEX_PATH environment variable to its location.";

/** The probed binary, shared by concurrent first calls (see {@link cachedProbe}). */
const probed = cachedProbe(probeBinary);

export function resolveCodexBinaryPath(): Promise<string> {
    return probed.resolve();
}

/** For tests: forget the probed binary so the next call re-resolves. */
export function resetCodexBinaryCache(): void {
    probed.reset();
}

/**
 * The adapter script: the copy the build places under RESOURCE_DIR, or the
 * installed package when running from source.
 */
export function resolveCodexAcpScript(): string {
    const bundled = path.join(RESOURCE_DIR, "codex-acp.mjs");
    return existsSync(bundled) ? bundled : require.resolve("@agentclientprotocol/codex-acp");
}

async function probeBinary(): Promise<string> {
    const binary = await locateBinary();

    // Async on purpose — this runs on the first chat request, and a sync probe
    // would freeze the whole server for up to the timeout.
    const { output, failure } = await runVersionProbe(binary, PROBE_TIMEOUT_MS);
    if (failure) {
        throw new Error(`Found the Codex CLI at "${binary}" but it failed to run (${failure}). ${INSTALL_HINT}`);
    }

    const version = /\d+\.\d+\.\d+\S*/.exec(output)?.[0];
    if (!version) {
        throw new Error(`Found the Codex CLI at "${binary}" but it did not report a version${output ? ` (it printed: ${output})` : ""}. ${INSTALL_HINT}`);
    }

    getLog().info(`Codex Agent provider: using the Codex CLI at ${binary} (${version})`);
    return binary;
}

async function locateBinary(): Promise<string> {
    const override = process.env.TRILIUM_CODEX_PATH?.trim();
    if (override) {
        if (!existsSync(override)) {
            throw new Error(`TRILIUM_CODEX_PATH is set to "${override}", but no file exists there.`);
        }
        return override;
    }

    const onPath = await findOnPath("codex");
    if (onPath) {
        return onPath;
    }

    throw new Error(`The Codex CLI (codex) was not found. ${INSTALL_HINT}`);
}
