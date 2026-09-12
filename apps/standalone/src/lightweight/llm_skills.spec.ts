import { readSkill, SKILLS } from "@triliumnext/core/src/services/llm/skills.js";
import { describe, expect, it } from "vitest";

import { registerStandaloneLlmExtensions } from "./llm_skills.js";

describe("standalone skill sheets", () => {
    it("inlines a sheet for every skill core catalogues", () => {
        registerStandaloneLlmExtensions();

        // The failure this guards against is a catalog entry added in core without
        // its `?raw` import here: on the server the tool keeps working, and only
        // this build answers "unknown skill" for something it advertises.
        for (const skill of SKILLS) {
            const sheet = readSkill(skill.name);
            expect(sheet, `no inlined sheet for ${skill.name}`).toBeTruthy();
            expect(sheet?.length).toBeGreaterThan(100);
        }
    });

    it("answers with nothing for a file it does not carry", () => {
        registerStandaloneLlmExtensions();
        expect(readSkill("no_such_skill")).toBeNull();
    });
});
