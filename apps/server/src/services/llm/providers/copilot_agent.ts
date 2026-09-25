/**
 * Copilot Agent provider — drives the GitHub Copilot CLI in ACP mode
 * (`copilot --acp`, the Agent Client Protocol) as a subprocess. This lets
 * users with a GitHub Copilot subscription (Pro/Pro+/Business/Enterprise) use
 * the in-app chat without an API key: authentication is owned entirely by the
 * CLI (`copilot login`, or credentials shared with any other Copilot editor
 * integration on the machine), and usage is billed to the subscription.
 *
 * Bring-your-own-binary: nothing is bundled — the provider spawns the user's
 * own installed `copilot` CLI (see copilot_binary.ts). The protocol handling is
 * shared with the other ACP providers (see acp_agent.ts); Copilot's built-in
 * file/shell tools are denied on its command line and again in the permission
 * callback.
 */

import type { ModelInfo } from "@triliumnext/core/src/services/llm/types.js";

import { AcpAgentProvider, type AcpLaunchSpec, type AcpModel, type AcpSessionModelState, describeError, resetAcpAgentStateForTests } from "./acp_agent.js";
import { AcpError } from "./acp_client.js";
import { needsShell, resolveCopilotBinaryPath } from "./copilot_binary.js";

/**
 * The catalog available without asking the CLI. It holds only the two ids the
 * provider itself names — `auto`, the default a chat falls back to when it has
 * none stored, and {@link TITLE_MODEL}. Pricing is zero throughout because the
 * subscription covers it.
 */
const AVAILABLE_MODELS: ModelInfo[] = [
    { id: "auto", name: "Auto", pricing: { input: 0, output: 0 }, isDefault: true, isSubscription: true },
    { id: "gpt-5-mini", name: "GPT-5 mini", pricing: { input: 0, output: 0 }, isSubscription: true }
];

/** Free-tier model used for the cheap title turn. */
const TITLE_MODEL = "gpt-5-mini";

/**
 * Premium-request multipliers from the last successful probe, by model id.
 *
 * Kept beside the catalog rather than on {@link ModelInfo}, which has no field
 * for it: the multiplier is a Copilot-plan quota rate, not a price, and is only
 * comparable against other Copilot models. {@link
 * CopilotAgentProvider.recommendedModelIds} is its one consumer.
 */
const premiumMultiplierById = new Map<string, number>();

/**
 * CLI arguments. These form the *primary* security boundary; the permission
 * callback (see `denyPermission` in acp_agent.ts) is a fail-closed backstop.
 *   - `--acp` runs the CLI as an ACP agent over stdio.
 *   - `--allow-tool=trilium` auto-approves every tool from our "trilium" MCP
 *     server, so note tools run without a permission round-trip (and without
 *     relying on us recognizing them — the CLI presents MCP tool calls with
 *     opaque IDs and human-friendly titles that don't embed the server name).
 *   - `--deny-tool` on each built-in file/shell/network tool guarantees they
 *     can never run even if a future CLI build changed the permission-prompt
 *     defaults. The agent's only capability surface is Trilium's note tools.
 *   - `--no-custom-instructions` keeps any AGENTS.md/copilot-instructions.md in
 *     an enclosing directory out of the notes chat.
 *   - `--no-auto-update` keeps the pinned binary from mutating under us.
 */
const COPILOT_ACP_ARGS = [
    "--acp",
    "--allow-tool=trilium",
    ...["shell", "powershell", "write", "edit", "create", "view", "glob", "grep", "task", "web_fetch"].map(t => `--deny-tool=${t}`),
    "--no-custom-instructions",
    "--no-auto-update"
];

export class CopilotAgentProvider extends AcpAgentProvider {
    name = "copilot-agent";
    protected readonly logLabel = "Copilot Agent provider";
    protected readonly fallbackModels = AVAILABLE_MODELS;
    protected readonly defaultModelId = "auto";
    protected readonly agentDirName = "copilot-agent";

    /**
     * Everything except the models that bill at more than one premium request
     * per turn.
     *
     * Copilot meters a monthly allowance of premium requests, not tokens, and
     * the multipliers span two orders of magnitude — a turn on Opus 5 (15x)
     * spends what fifteen Sonnet turns would. Pre-selecting those would let a
     * user empty the month's allowance from a picker that gave no hint of it, so
     * the expensive models stay one deliberate tick away while the 1x-and-under
     * bulk of the catalog is on by default.
     *
     * Anything whose rate the CLI didn't report — `auto`, or a model listed by a
     * future CLI that drops the metadata — is recommended: the flag only seeds a
     * selection the user can change, so failing open costs less than hiding a
     * model that may well be the cheap one.
     */
    recommendedModelIds(models: ModelInfo[]): Set<string> {
        return new Set(models.filter(m => (premiumMultiplierById.get(m.id) ?? 0) <= 1).map(m => m.id));
    }

    protected titleModelId(): string {
        return TITLE_MODEL;
    }

    protected async launchSpec(): Promise<AcpLaunchSpec> {
        const binary = await resolveCopilotBinaryPath();
        return { binary, args: COPILOT_ACP_ARGS, shell: needsShell(binary) };
    }

    protected buildModelList(remote: AcpSessionModelState): ModelInfo[] {
        return buildCopilotModelList(remote.availableModels ?? [], AVAILABLE_MODELS);
    }

    /** Map failures to actionable messages (auth problems name the fix). */
    protected describeFailure(error: unknown): string {
        const text = describeError(error);
        if (error instanceof AcpError && (error.code === -32000 || /auth|login|subscription/i.test(text))) {
            return "GitHub Copilot CLI is not authenticated. Run `copilot login` on the machine running the Trilium server to sign in with your GitHub Copilot subscription.";
        }
        if (/ENOENT|spawn/i.test(text)) {
            return `Failed to start the GitHub Copilot CLI: ${text}`;
        }
        return text;
    }
}

/**
 * Turn the CLI's reported catalog into Trilium's model list, recording each
 * model's premium-request multiplier on the way through.
 *
 * The CLI's order is kept as-is rather than re-sorted or filed behind the
 * curated entries: unlike an HTTP `/models` endpoint, which dumps every id a
 * vendor has ever shipped, this list *is* the picker GitHub shows in the
 * terminal — already chosen and already ordered for a human. The curated list
 * contributes only a display name for anything the CLI leaves unnamed.
 *
 * Models the CLI marks as not enabled are dropped: they appear so the terminal
 * picker can grey them out with a reason, which a checkbox list has nowhere to
 * put, and selecting one would fail at the first turn. Copilot puts its quota
 * accounting in `_meta`: `copilotUsage` is the premium-request multiplier as a
 * display string ("0.33x", "15x"), and `copilotEnablement` marks models the
 * account or its policy can't actually use.
 */
export function buildCopilotModelList(remote: AcpModel[], curated: ModelInfo[]): ModelInfo[] {
    const curatedById = new Map(curated.map(m => [m.id, m]));
    premiumMultiplierById.clear();

    const models = remote
        .filter(m => m.modelId && (metaString(m, "copilotEnablement") ?? "enabled") === "enabled")
        .map<ModelInfo>(m => {
            const multiplier = parsePremiumMultiplier(metaString(m, "copilotUsage"));
            if (multiplier !== undefined) {
                premiumMultiplierById.set(m.modelId, multiplier);
            }
            return {
                id: m.modelId,
                name: m.name ?? curatedById.get(m.modelId)?.name ?? m.modelId,
                // Every model on a Copilot plan is covered by the subscription;
                // the picker says so instead of showing a per-token price.
                pricing: { input: 0, output: 0 },
                isSubscription: true
            };
        });

    // Nothing usable came back — an account with no model entitlements at all,
    // or a CLI that stopped reporting them. Fall back rather than hand the
    // picker an empty list it would render as "no models".
    if (models.length === 0) {
        return curated;
    }

    // `find(m => m.isDefault)` is how the chat resolves an unset model, so the
    // list must always carry one. Prefer the curated default (`auto`) when the
    // account still offers it; otherwise the first model the CLI listed, which
    // is the one its own picker leads with.
    const preferred = models.find(m => curatedById.get(m.id)?.isDefault) ?? models[0];
    return models.map(m => (m === preferred ? { ...m, isDefault: true } : m));
}

/** For tests: forget the probed catalog and the premium rates recorded from it. */
export function resetModelCatalogCacheForTests(): void {
    resetAcpAgentStateForTests();
    premiumMultiplierById.clear();
}

function metaString(model: AcpModel, key: string): string | undefined {
    const value = model._meta?.[key];
    return typeof value === "string" ? value : undefined;
}

/** `"0.33x"` → `0.33`. Undefined for a missing or unparseable rate. */
function parsePremiumMultiplier(usage: string | undefined): number | undefined {
    if (!usage) {
        return undefined;
    }
    const parsed = Number.parseFloat(usage);
    return Number.isFinite(parsed) ? parsed : undefined;
}
