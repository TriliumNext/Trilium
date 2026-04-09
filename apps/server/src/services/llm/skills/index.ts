/**
 * LLM skills — on-demand instruction sets that an LLM can load when it needs
 * specialized knowledge (e.g. search syntax). Only names and descriptions are
 * included in the system prompt; full content is fetched via the load_skill tool.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { z } from "zod";

import resourceDir from "../../resource_dir.js";
import { defineTools } from "../tools/tool_registry.js";

const SKILLS_DIR = join(resourceDir.RESOURCE_DIR, "llm", "skills");

interface SkillDefinition {
    name: string;
    description: string;
    file: string;
}

const SKILLS: SkillDefinition[] = [
    {
        name: "search_syntax",
        description: "Trilium search query syntax reference — labels, relations, note properties, boolean logic, ordering, and more.",
        file: "search_syntax.md"
    },
    {
        name: "backend_scripting",
        description: "Backend (Node.js) scripting API — creating notes, handling events, accessing entities, database operations, and automation.",
        file: "backend_scripting.md"
    },
    {
        name: "frontend_scripting",
        description: "Frontend (browser) scripting API — UI widgets, navigation, dialogs, editor access, Preact/JSX components, and keyboard shortcuts.",
        file: "frontend_scripting.md"
    }
];

function loadSkillContent(name: string): string | null {
    const skill = SKILLS.find((s) => s.name === name);
    if (!skill) {
        return null;
    }
    return readFileSync(join(SKILLS_DIR, skill.file), "utf-8");
}

/**
 * Returns a summary of available skills for inclusion in the system prompt.
 */
export function getSkillsSummary(): string {
    return SKILLS
        .map((s) => `- **${s.name}**: ${s.description}`)
        .join("\n");
}

export const skillTools = defineTools({
    load_skill: {
        description: "Load a skill to get specialized instructions. Available skills:\n"
            + SKILLS.map((s) => `- ${s.name}: ${s.description}`).join("\n"),
        inputSchema: z.object({
            name: z.string().describe("The skill name to load")
        }),
        execute: ({ name }) => {
            const content = loadSkillContent(name);
            if (!content) {
                return { error: `Unknown skill: '${name}'. Available: ${SKILLS.map((s) => s.name).join(", ")}` };
            }
            return { skill: name, instructions: content };
        }
    }
});
