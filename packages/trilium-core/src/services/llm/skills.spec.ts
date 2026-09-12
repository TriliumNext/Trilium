import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";

import { getSkillsSummary, readSkill, registerSkillReader, SKILLS } from "./skills.js";

/**
 * This file's directory, taken apart rather than composed with
 * `new URL(…, import.meta.url)`: core's specs run under the standalone project
 * too, whose browser-flavoured Vite config rewrites that expression into a
 * dev-server asset URL (`http://localhost:3000/@fs/…`) that no filesystem call
 * can use.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Restore the "no host has registered anything" state the module starts in. */
function clearReader() {
    registerSkillReader(() => null);
}

afterEach(clearReader);

describe("llm skill sheets", () => {
    it("ships a markdown sheet for every catalogued skill", () => {
        // The catalog is the contract between core and both readers: an entry with
        // no file behind it is a tool call that fails at the far end of a chat.
        for (const skill of SKILLS) {
            const path = join(HERE, "../../assets/llm/skills", skill.file);
            expect(existsSync(path), `missing sheet: ${skill.file}`).toBe(true);
        }
    });

    it("asks the host's reader for the catalogued file name", () => {
        const asked: string[] = [];
        registerSkillReader((file) => {
            asked.push(file);
            return file === "search_syntax.md" ? "SHEET" : null;
        });

        expect(readSkill("search_syntax")).toBe("SHEET");
        expect(asked).toEqual(["search_syntax.md"]);
    });

    it("answers with nothing for a skill outside the catalog, without troubling the reader", () => {
        let asked = false;
        registerSkillReader(() => { asked = true; return "SHEET"; });

        expect(readSkill("no_such_skill")).toBeNull();
        expect(asked).toBe(false);
    });

    it("answers with nothing where no host has registered a reader", () => {
        clearReader();
        expect(readSkill("search_syntax")).toBeNull();
    });

    it("summarises the skills inline, never as a bulleted list", () => {
        // Bullets of `- name: description` read as a tool catalog to some models
        // (notably Gemini), which then invent calls to the skill names.
        const summary = getSkillsSummary();
        expect(summary).not.toContain("\n");
        for (const skill of SKILLS) {
            expect(summary).toContain(`"${skill.name}"`);
        }
    });
});
