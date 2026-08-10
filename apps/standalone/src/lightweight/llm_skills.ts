import backendScripting from "@triliumnext/core/src/assets/llm/skills/backend_scripting.md?raw";
import dashboards from "@triliumnext/core/src/assets/llm/skills/dashboards.md?raw";
import frontendScripting from "@triliumnext/core/src/assets/llm/skills/frontend_scripting.md?raw";
import searchSyntax from "@triliumnext/core/src/assets/llm/skills/search_syntax.md?raw";
import { registerSkillReader } from "@triliumnext/core/src/services/llm/skills.js";

/**
 * The skill sheets, inlined by the bundler.
 *
 * The server reads them from RESOURCE_DIR; there is no disk here, and no useful
 * moment to fetch them either — a tool's `execute` is synchronous by contract,
 * so the sheets have to already be in memory when the model asks. `?raw` settles
 * that at build time, the same way this build already takes core's schema.sql,
 * and costs ~44 KB of markdown in an app that ships a SQLite engine.
 *
 * Keyed by file name, which is what core's catalog asks a reader for.
 */
const SKILL_SHEETS: Record<string, string> = {
    "search_syntax.md": searchSyntax,
    "backend_scripting.md": backendScripting,
    "frontend_scripting.md": frontendScripting,
    "dashboards.md": dashboards
};

/**
 * The standalone build's contribution to the LLM stack, alongside the server's
 * {@link registerServerLlmExtensions}. Called once from worker startup.
 */
export function registerStandaloneLlmExtensions() {
    registerSkillReader((file) => SKILL_SHEETS[file] ?? null);
}
