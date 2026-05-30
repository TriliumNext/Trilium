import { describe, expect, it } from "vitest";

import type { ToolDefinition } from "../tools/tool_registry.js";
import { getSkillsSummary, skillTools } from "./index.js";

function loadSkillTool(): ToolDefinition {
    for (const [name, def] of skillTools) {
        if (name === "load_skill") return def;
    }
    throw new Error("load_skill tool not registered");
}

describe("llm skills", () => {
    it("getSkillsSummary lists each skill name inline (no bullets)", () => {
        const summary = getSkillsSummary();
        // Inline prose, not a bulleted catalog (bullets confuse some models).
        expect(summary).not.toContain("\n");
        expect(summary).toContain('"search_syntax"');
        expect(summary).toContain('"backend_scripting"');
        expect(summary).toContain('"frontend_scripting"');
    });

    describe("load_skill tool", () => {
        it("loads the markdown content of a known skill", () => {
            const result = loadSkillTool().execute({ name: "search_syntax" }) as {
                skill: string;
                instructions: string;
            };
            expect(result.skill).toBe("search_syntax");
            expect(typeof result.instructions).toBe("string");
            expect(result.instructions.length).toBeGreaterThan(0);
        });

        it("returns an error listing available skills for an unknown name", () => {
            const result = loadSkillTool().execute({ name: "no_such_skill" }) as { error: string };
            expect(result.error).toContain("Unknown skill: 'no_such_skill'");
            expect(result.error).toContain("search_syntax");
        });
    });
});
