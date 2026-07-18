import { describe, expect, it } from "vitest";

import { SYSTEM_MONOSPACE_FONT_STACK, SYSTEM_SANS_SERIF_FONT_STACK } from "./options_interface.js";

describe("SYSTEM_SANS_SERIF_FONT_STACK", () => {
    it("is a comma-joined font stack starting with system-ui and ending in sans-serif", () => {
        expect(typeof SYSTEM_SANS_SERIF_FONT_STACK).toBe("string");

        const fonts = SYSTEM_SANS_SERIF_FONT_STACK.split(",");
        expect(fonts[0]).toBe("system-ui");
        expect(fonts).toContain("sans-serif");
        expect(fonts).toEqual([
            "system-ui",
            "-apple-system",
            "BlinkMacSystemFont",
            "Segoe UI",
            "Cantarell",
            "Ubuntu",
            "Noto Sans",
            "Helvetica",
            "Arial",
            "sans-serif",
            "Apple Color Emoji",
            "Segoe UI Emoji"
        ]);
    });
});

describe("SYSTEM_MONOSPACE_FONT_STACK", () => {
    it("is a comma-joined font stack starting with ui-monospace and ending in monospace", () => {
        expect(typeof SYSTEM_MONOSPACE_FONT_STACK).toBe("string");

        const fonts = SYSTEM_MONOSPACE_FONT_STACK.split(",");
        expect(fonts[0]).toBe("ui-monospace");
        expect(fonts).toContain("monospace");
        expect(fonts).toEqual([
            "ui-monospace",
            "SFMono-Regular",
            "SF Mono",
            "Consolas",
            "Source Code Pro",
            "Ubuntu Mono",
            "Menlo",
            "Liberation Mono",
            "monospace"
        ]);
    });
});
