/**
 * The server's Node-only contributions to the LLM stack.
 *
 * The stack itself lives in `@triliumnext/core`, so the browser-hosted
 * (standalone) build can run it too. What could not follow it there is anything
 * that needs Node: the provider that spawns the Claude Code CLI, and the skill
 * sheets, whose catalog is core's while the reading is per-runtime. Core exposes
 * a seam for each; this is where the server fills them in.
 *
 * Each seam is keyed rather than bespoke, so the next host-provided provider
 * (GitHub Copilot and the like) is one more line here and one more entry in
 * core's HOST_PROVIDED_TYPES.
 */

import { registerHostProvider } from "@triliumnext/core/src/services/llm/index.js";
import { registerSkillReader } from "@triliumnext/core/src/services/llm/skills.js";

import { loadSkillSheet } from "../../core_assets.js";
import { ClaudeAgentProvider } from "./providers/claude_agent.js";

/**
 * Contribute those pieces to core. Called once from startup, beside the other
 * registrations there, rather than run as an import side effect: core's own LLM
 * routes reach the stack directly, so what a chat can use must not depend on
 * whether some module that happens to import this one was loaded first.
 */
export function registerServerLlmExtensions() {
    registerHostProvider("claude-agent", () => new ClaudeAgentProvider());
    registerSkillReader(loadSkillSheet);
}
