import { describe, expect, it, vi } from "vitest";

const registrations = vi.hoisted(() => ({
    hostProviders: [] as { type: string; factory: () => unknown }[],
    skillReader: undefined as ((file: string) => string | null) | undefined
}));

vi.mock("@triliumnext/core/src/services/llm/host_providers.js", () => ({
    registerHostProvider: (type: string, factory: () => unknown) => { registrations.hostProviders.push({ type, factory }); }
}));
// Partial: dropping the tool-registry mock brings the real tool graph into this suite, and the
// skills tool reads the catalog at import time.
vi.mock("@triliumnext/core/src/services/llm/skills.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("@triliumnext/core/src/services/llm/skills.js")>(),
    registerSkillReader: (reader: (file: string) => string | null) => { registrations.skillReader = reader; }
}));

import { registerServerLlmExtensions } from "./index.js";
import { AntigravityAgentProvider } from "./providers/antigravity_agent.js";
import { ClaudeAgentProvider } from "./providers/claude_agent.js";
import { CodexAgentProvider } from "./providers/codex_agent.js";
import { CopilotAgentProvider } from "./providers/copilot_agent.js";

describe("registerServerLlmExtensions", () => {
    it("hands core every piece of the stack that needs Node", async () => {
        registerServerLlmExtensions();

        // The subscription providers, which shell out to the Claude Code and Copilot
        // CLIs, Google's Antigravity ACP server and the Codex ACP adapter, under the
        // types core knows them by. Registered as async factories that import their
        // module on first use, so neither the provider nor its agent SDK loads until
        // a chat asks for it.
        expect(registrations.hostProviders.map(p => p.type)).toEqual(["claude-agent", "copilot-agent", "antigravity-agent", "codex-agent"]);
        expect(await registrations.hostProviders[0].factory()).toBeInstanceOf(ClaudeAgentProvider);
        expect(await registrations.hostProviders[1].factory()).toBeInstanceOf(CopilotAgentProvider);
        expect(await registrations.hostProviders[2].factory()).toBeInstanceOf(AntigravityAgentProvider);
        expect(await registrations.hostProviders[3].factory()).toBeInstanceOf(CodexAgentProvider);
        // The skill sheets: core owns the catalog and the tool, the server only
        // knows how to get a sheet off disk.
        expect(registrations.skillReader?.("search_syntax.md")).toContain("#");
    });
});
