import { describe, expect, it } from "vitest";

import { getMermaidConfig, parseMermaidTheme } from "./mermaid_config.js";

describe("getMermaidConfig", () => {
    it("uses the given theme and pins the pre-12 layout and look", () => {
        const config = getMermaidConfig("dark");

        expect(config.theme).toBe("dark");
        expect(config.layout).toBe("dagre");
        expect(config.look).toBe("classic");
        expect(config.securityLevel).toBe("antiscript");
        expect(config.flowchart).toEqual({ useMaxWidth: false });
        expect(config.pie).toEqual({ useMaxWidth: true });
    });
});

describe("parseMermaidTheme", () => {
    it("trims a known theme and falls back to default for an empty or unknown one", () => {
        expect(parseMermaidTheme("  dark  ")).toBe("dark");
        expect(parseMermaidTheme("neutral")).toBe("neutral");
        expect(parseMermaidTheme("")).toBe("default");
        expect(parseMermaidTheme("midnight")).toBe("default");
    });
});
