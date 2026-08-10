import { afterEach, describe, expect, it } from "vitest";

import { registerSkillReader, SKILLS } from "../skills.js";
import type { ToolDefinition } from "./tool_registry.js";
import { skillTools } from "./skill_tools.js";

function loadSkillTool(): ToolDefinition {
    for (const [name, def] of skillTools) {
        if (name === "load_skill") return def;
    }
    throw new Error("load_skill tool not registered");
}

afterEach(() => registerSkillReader(() => null));

describe("load_skill", () => {
    it("hands back the sheet the host produced", () => {
        registerSkillReader((file) => `contents of ${file}`);

        expect(loadSkillTool().execute({ name: "search_syntax" }))
            .toEqual({ skill: "search_syntax", instructions: "contents of search_syntax.md" });
    });

    it("lists what is on offer when asked for something else", () => {
        registerSkillReader(() => "SHEET");

        const result = loadSkillTool().execute({ name: "no_such_skill" }) as { error: string };
        expect(result.error).toContain("Unknown skill: 'no_such_skill'");
        for (const skill of SKILLS) {
            expect(result.error).toContain(skill.name);
        }
    });

    it("says the same when the host cannot produce the sheet, rather than returning an empty one", () => {
        // A build with no reader, or one whose file went missing: the model gets a
        // refusal it can act on instead of instructions that say nothing.
        registerSkillReader(() => null);

        expect(loadSkillTool().execute({ name: "search_syntax" }))
            .toHaveProperty("error", expect.stringContaining("Unknown skill: 'search_syntax'"));
    });

    it("names every catalogued skill in its description, which is all the model sees up front", () => {
        const description = loadSkillTool().description;
        for (const skill of SKILLS) {
            expect(description).toContain(`- ${skill.name}: ${skill.description}`);
        }
    });
});
