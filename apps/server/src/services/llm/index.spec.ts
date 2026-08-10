import { describe, expect, it, vi } from "vitest";

const registrations = vi.hoisted(() => ({
    hostProviders: [] as { type: string; factory: () => unknown }[],
    docNoteReader: undefined as ((note: unknown) => string | null) | undefined,
    skillReader: undefined as ((file: string) => string | null) | undefined,
    toolRegistries: [] as unknown[]
}));

vi.mock("@triliumnext/core/src/services/llm/index.js", () => ({
    registerHostProvider: (type: string, factory: () => unknown) => { registrations.hostProviders.push({ type, factory }); }
}));
// Partial: dropping the tool-registry mock brings the real tool graph into this suite, and the
// skills tool reads the catalog at import time.
vi.mock("@triliumnext/core/src/services/llm/skills.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("@triliumnext/core/src/services/llm/skills.js")>(),
    registerSkillReader: (reader: (file: string) => string | null) => { registrations.skillReader = reader; }
}));
vi.mock("@triliumnext/core/src/services/llm/tools/helpers.js", () => ({
    registerDocNoteHtmlReader: (reader: (note: unknown) => string | null) => { registrations.docNoteReader = reader; }
}));
import { registerServerLlmExtensions } from "./index.js";
import { ClaudeAgentProvider } from "./providers/claude_agent.js";

describe("registerServerLlmExtensions", () => {
    it("hands core every piece of the stack that needs Node", () => {
        registerServerLlmExtensions();

        // The subscription provider, which shells out to the Claude Code CLI, under
        // the type core knows it by. Registered as a factory, so nothing is
        // constructed until a chat asks for it.
        expect(registrations.hostProviders.map(p => p.type)).toEqual(["claude-agent"]);
        expect(registrations.hostProviders[0].factory()).toBeInstanceOf(ClaudeAgentProvider);
        // The User Guide reader, which core's note-content helper calls for doc notes.
        expect(registrations.docNoteReader).toBeTypeOf("function");
        // The skill sheets: core owns the catalog and the tool, the server only
        // knows how to get a sheet off disk.
        expect(registrations.skillReader?.("search_syntax.md")).toContain("#");
        // No tool registry of its own: the help tools read note content like every other
        // tool, so core carries them and standalone gets them too.
        expect(registrations.toolRegistries).toEqual([]);
    });
});
