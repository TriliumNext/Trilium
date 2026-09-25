import { describe, expect, it } from "vitest";

import { LLM_REASONING_EFFORTS } from "./llm_api.js";

describe("LLM_REASONING_EFFORTS", () => {
    it("lists the levels weakest first, since providers pick the nearest level by position", () => {
        expect(LLM_REASONING_EFFORTS).toEqual([ "none", "minimal", "low", "medium", "high", "xhigh", "max" ]);
    });
});
