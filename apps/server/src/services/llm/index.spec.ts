import { describe, expect, it, vi } from "vitest";

const registrations = vi.hoisted(() => ({
    hostProviders: [] as { type: string; factory: () => unknown }[],
    docNoteReader: undefined as ((note: unknown) => string | null) | undefined,
    skillReader: undefined as ((file: string) => string | null) | undefined,
    toolRegistryLoaders: [] as (() => Promise<unknown>)[]
}));

vi.mock("@triliumnext/core/src/services/llm/host_providers.js", () => ({
    registerHostProvider: (type: string, factory: () => unknown) => { registrations.hostProviders.push({ type, factory }); }
}));
vi.mock("@triliumnext/core/src/services/llm/skills.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("@triliumnext/core/src/services/llm/skills.js")>(),
    registerSkillReader: (reader: (file: string) => string | null) => { registrations.skillReader = reader; }
}));
vi.mock("@triliumnext/core/src/services/llm/tools/helpers.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("@triliumnext/core/src/services/llm/tools/helpers.js")>(),
    registerDocNoteHtmlReader: (reader: (note: unknown) => string | null) => { registrations.docNoteReader = reader; }
}));
vi.mock("@triliumnext/core/src/services/llm/tools/registration.js", () => ({
    registerToolRegistryLoader: (loader: () => Promise<unknown>) => { registrations.toolRegistryLoaders.push(loader); }
}));

import { registerServerLlmExtensions } from "./index.js";
import { ClaudeAgentProvider } from "./providers/claude_agent.js";
import { CopilotAgentProvider } from "./providers/copilot_agent.js";
import { helpTools } from "./tools/help_tools.js";

describe("registerServerLlmExtensions", () => {
    it("hands core every piece of the stack that needs Node", async () => {
        registerServerLlmExtensions();

        // The subscription providers, which shell out to the Claude Code and Copilot
        // CLIs, under the types core knows them by. Registered as async factories
        // that import their module on first use, so neither the provider nor its
        // agent SDK loads until a chat asks for it.
        expect(registrations.hostProviders.map(p => p.type)).toEqual(["claude-agent", "copilot-agent"]);
        expect(await registrations.hostProviders[0].factory()).toBeInstanceOf(ClaudeAgentProvider);
        expect(await registrations.hostProviders[1].factory()).toBeInstanceOf(CopilotAgentProvider);
        // The User Guide reader, which core's note-content helper calls for doc notes.
        expect(registrations.docNoteReader).toBeTypeOf("function");
        // The skill sheets: core owns the catalog and the tool, the server only
        // knows how to get a sheet off disk.
        expect(registrations.skillReader?.("search_syntax.md")).toContain("#");
        // The one registry still backed by files this build alone carries,
        // registered as a loader so the tool stack stays out of the startup path.
        expect(registrations.toolRegistryLoaders).toHaveLength(1);
        expect(await registrations.toolRegistryLoaders[0]()).toBe(helpTools);
    });
});
