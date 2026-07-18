/**
 * pnpm install hook.
 *
 * Strips the per-platform native binary packages bundled by agent SDKs whose
 * providers run in "bring-your-own-binary" mode. Trilium's Claude Agent
 * provider (apps/server) drives the SDK's JS wrapper but points it at the
 * user's own installed CLI via `pathToClaudeCodeExecutable`, so the ~250 MB
 * bundled binary is never used — and must not be downloaded into every server
 * install and Docker layer. The tiny JS wrapper is kept; only the
 * `@anthropic-ai/claude-agent-sdk-<platform>` optionalDependencies are removed.
 */

/** SDK package name → prefix of the platform-binary optionalDependencies to drop. */
const BYO_BINARY_SDKS = {
    "@anthropic-ai/claude-agent-sdk": "@anthropic-ai/claude-agent-sdk-"
};

function readPackage(pkg) {
    const prefix = BYO_BINARY_SDKS[pkg.name];
    if (prefix && pkg.optionalDependencies) {
        for (const dep of Object.keys(pkg.optionalDependencies)) {
            if (dep.startsWith(prefix)) {
                delete pkg.optionalDependencies[dep];
            }
        }
    }
    return pkg;
}

module.exports = { hooks: { readPackage } };
