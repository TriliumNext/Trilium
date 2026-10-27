/**
 * The server's Node-only contributions to the LLM stack.
 *
 * The stack itself lives in `@triliumnext/core`, so the browser-hosted
 * (standalone) build can run it too. What could not follow it there is anything
 * that needs Node: the providers that spawn the Claude Code and GitHub Copilot
 * CLIs, Google's Antigravity ACP server and the Codex ACP adapter, and the skill
 * sheets, whose catalog is core's while the reading is per-runtime. Core exposes
 * a seam for each; this is where the server fills them in.
 *
 * Each seam is keyed rather than bespoke, so the next host-provided provider is
 * one more line here and one more entry in core's HOST_PROVIDED_TYPES.
 */

import { registerHostProvider } from "@triliumnext/core/src/services/llm/host_providers.js";
import { registerSkillReader } from "@triliumnext/core/src/services/llm/skills.js";

import { loadSkillSheet } from "../../core_assets.js";

/**
 * Contribute those pieces to core. Called once from startup, beside the other
 * registrations there, rather than run as an import side effect: core's own LLM
 * routes reach the stack directly, so what a chat can use must not depend on
 * whether some module that happens to import this one was loaded first.
 *
 * The providers are registered as loaders, not values: their modules carry the
 * agent SDKs, and importing them here would put all of that in the startup path
 * of every install. The registration
 * seams are light on purpose — core resolves each loader on first use.
 */
export function registerServerLlmExtensions() {
    registerHostProvider("claude-agent", async () => new (await import("./providers/claude_agent.js")).ClaudeAgentProvider());
    registerHostProvider("copilot-agent", async () => new (await import("./providers/copilot_agent.js")).CopilotAgentProvider());
    registerHostProvider("antigravity-agent", async () => new (await import("./providers/antigravity_agent.js")).AntigravityAgentProvider());
    registerHostProvider("codex-agent", async () => new (await import("./providers/codex_agent.js")).CodexAgentProvider());
    registerSkillReader(loadSkillSheet);
}
