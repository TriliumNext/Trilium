/**
 * The server's Node-only contributions to the LLM stack.
 *
 * The stack itself lives in `@triliumnext/core`, so the browser-hosted
 * (standalone) build can run it too. What could not follow it there is anything
 * that needs Node: the providers that spawn the Claude Code and GitHub Copilot
 * CLIs, and the User Guide tools, which read pages off disk. Core exposes a seam
 * for each; this is where the server fills them in — including the skill sheets,
 * whose catalog is core's while the reading is per-runtime.
 *
 * Each seam is keyed rather than bespoke, so the next host-provided provider is
 * one more line here and one more entry in core's HOST_PROVIDED_TYPES.
 */

import { registerHostProvider } from "@triliumnext/core/src/services/llm/host_providers.js";
import { registerSkillReader } from "@triliumnext/core/src/services/llm/skills.js";
import { registerDocNoteHtmlReader } from "@triliumnext/core/src/services/llm/tools/helpers.js";
import { registerToolRegistryLoader } from "@triliumnext/core/src/services/llm/tools/registration.js";

import { loadSkillSheet } from "../../core_assets.js";
import { getDocNoteHtml } from "./tools/doc_notes.js";

/**
 * Contribute those pieces to core. Called once from startup, beside the other
 * registrations there, rather than run as an import side effect: core's own LLM
 * routes reach the stack directly, so what a chat can use must not depend on
 * whether some module that happens to import this one was loaded first.
 *
 * The providers and the help tools are registered as loaders, not values: their
 * modules carry the agent SDKs and the tool stack, and importing them here
 * would put all of that in the startup path of every install. The registration
 * seams are light on purpose — core resolves each loader on first use.
 */
export function registerServerLlmExtensions() {
    registerHostProvider("claude-agent", async () => new (await import("./providers/claude_agent.js")).ClaudeAgentProvider());
    registerHostProvider("copilot-agent", async () => new (await import("./providers/copilot_agent.js")).CopilotAgentProvider());
    registerDocNoteHtmlReader(getDocNoteHtml);
    registerSkillReader(loadSkillSheet);
    registerToolRegistryLoader(async () => (await import("./tools/help_tools.js")).helpTools);
}
