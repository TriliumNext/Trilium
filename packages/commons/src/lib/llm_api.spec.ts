import { describe, expect, it } from "vitest";

import { isToolErrorResult, LLM_REASONING_EFFORTS } from "./llm_api.js";

describe("LLM_REASONING_EFFORTS", () => {
    it("lists the levels weakest first, since providers pick the nearest level by position", () => {
        expect(LLM_REASONING_EFFORTS).toEqual([ "none", "minimal", "low", "medium", "high", "xhigh", "max" ]);
    });
});

describe("isToolErrorResult", () => {
    it("recognizes the { error } a tool returns on failure, as an object or as its JSON", () => {
        expect(isToolErrorResult({ error: "Note not found" })).toBe(true);
        expect(isToolErrorResult(JSON.stringify({ error: "Note not found" }))).toBe(true);
        expect(isToolErrorResult({ noteId: "a" })).toBe(false);
        expect(isToolErrorResult(JSON.stringify([ { error: "x" } ]))).toBe(false);
        expect(isToolErrorResult("Sunny")).toBe(false);
        expect(isToolErrorResult(null)).toBe(false);
        expect(isToolErrorResult(undefined)).toBe(false);
    });
});
