import { describe, expect, it } from "vitest";

import { ALLOWED_NOTE_TYPES, REVISION_SOURCES } from "./rows.js";

describe("REVISION_SOURCES", () => {
    it("contains the expected revision source values in order", () => {
        expect(REVISION_SOURCES).toEqual(["auto", "manual", "etapi", "llm", "restore"]);
    });
});

describe("ALLOWED_NOTE_TYPES", () => {
    it("is a non-empty array", () => {
        expect(Array.isArray(ALLOWED_NOTE_TYPES)).toBe(true);
        expect(ALLOWED_NOTE_TYPES.length).toBeGreaterThan(0);
    });

    it("includes the expected note types", () => {
        for (const type of ["text", "code", "spreadsheet", "llmChat"]) {
            expect(ALLOWED_NOTE_TYPES).toContain(type);
        }
    });

    it("matches the full set of allowed note types", () => {
        expect(ALLOWED_NOTE_TYPES).toEqual([
            "file",
            "image",
            "search",
            "noteMap",
            "launcher",
            "doc",
            "contentWidget",
            "text",
            "relationMap",
            "render",
            "canvas",
            "mermaid",
            "book",
            "webView",
            "code",
            "mindMap",
            "spreadsheet",
            "llmChat"
        ]);
    });
});
