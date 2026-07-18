import { describe, expect, it } from "vitest";
import { convertIndentation } from "./reindentation";

describe("convertIndentation", () => {
    it("returns content unchanged when source and target match", () => {
        const content = "    const x = 1;\n        const y = 2;\n";
        expect(convertIndentation(content, { useTabs: false, width: 4 }, { useTabs: false, width: 4 })).toBe(content);
    });

    it("returns content unchanged for zero or negative widths", () => {
        const content = "    x\n";
        expect(convertIndentation(content, { useTabs: false, width: 0 }, { useTabs: false, width: 4 })).toBe(content);
        expect(convertIndentation(content, { useTabs: false, width: 4 }, { useTabs: false, width: 0 })).toBe(content);
    });

    it("converts spaces to a narrower width", () => {
        const input = "    a\n        b\n            c\n";
        const expected = "  a\n    b\n      c\n";
        expect(convertIndentation(input, { useTabs: false, width: 4 }, { useTabs: false, width: 2 })).toBe(expected);
    });

    it("converts spaces to a wider width", () => {
        const input = "  a\n    b\n";
        const expected = "    a\n        b\n";
        expect(convertIndentation(input, { useTabs: false, width: 2 }, { useTabs: false, width: 4 })).toBe(expected);
    });

    it("converts spaces to tabs", () => {
        const input = "    a\n        b\n";
        const expected = "\ta\n\t\tb\n";
        expect(convertIndentation(input, { useTabs: false, width: 4 }, { useTabs: true, width: 4 })).toBe(expected);
    });

    it("converts tabs to spaces", () => {
        const input = "\ta\n\t\tb\n";
        const expected = "    a\n        b\n";
        expect(convertIndentation(input, { useTabs: true, width: 4 }, { useTabs: false, width: 4 })).toBe(expected);
    });

    it("converts tabs to a different tab display width", () => {
        // When both source and target are tabs, the content doesn't change (tab count is preserved)
        // regardless of visual tab width.
        const input = "\ta\n\t\tb\n";
        expect(convertIndentation(input, { useTabs: true, width: 4 }, { useTabs: true, width: 2 })).toBe(input);
    });

    it("handles mixed tabs and spaces on the same line (tab then spaces)", () => {
        // One tab (→ col 4) + 2 spaces → 6 columns → 1 level + 2 remainder spaces at width=4.
        // Target spaces width=4: 1 level (4 spaces) + 2 remainder = 6 spaces.
        const input = "\t  statement;\n";
        expect(convertIndentation(input, { useTabs: true, width: 4 }, { useTabs: false, width: 4 })).toBe("      statement;\n");
    });

    it("preserves alignment remainder when converting spaces to tabs", () => {
        // 6 spaces at width=4 → 1 level + 2 remainder spaces.
        const input = "      alignedText\n";
        const expected = "\t  alignedText\n";
        expect(convertIndentation(input, { useTabs: false, width: 4 }, { useTabs: true, width: 4 })).toBe(expected);
    });

    it("preserves alignment remainder when converting spaces to narrower spaces", () => {
        // 5 spaces at width=4 → 1 level + 1 remainder → 1 level at width 2 = 2 spaces + 1 remainder = 3 spaces.
        const input = "     x\n";
        expect(convertIndentation(input, { useTabs: false, width: 4 }, { useTabs: false, width: 2 })).toBe("   x\n");
    });

    it("handles interleaved spaces and tabs (space, then tab)", () => {
        // "  \t" at tabWidth=4: 2 cols (spaces), then tab advances to next multiple of 4 = col 4.
        // Total 4 cols = 1 level.
        const input = "  \tstmt\n";
        expect(convertIndentation(input, { useTabs: true, width: 4 }, { useTabs: false, width: 4 })).toBe("    stmt\n");
    });

    it("does not touch non-leading whitespace", () => {
        const input = "const a = \"  \\t  \";\n    if (x)\n";
        const expected = "const a = \"  \\t  \";\n  if (x)\n";
        expect(convertIndentation(input, { useTabs: false, width: 4 }, { useTabs: false, width: 2 })).toBe(expected);
    });

    it("leaves blank lines alone", () => {
        const input = "    a\n\n    b\n";
        const expected = "  a\n\n  b\n";
        expect(convertIndentation(input, { useTabs: false, width: 4 }, { useTabs: false, width: 2 })).toBe(expected);
    });

    it("handles mixed indentation styles across lines", () => {
        // Line 1 uses tabs, line 2 uses spaces.
        const input = "\t\tnested\n        alsoNested\n";
        // At from=tabs,width=4: line 1 has 8 cols → 2 levels. Line 2 has 8 spaces → 8 cols → 2 levels.
        // Target = spaces width 2 → both lines become "    " (4 spaces).
        expect(convertIndentation(input, { useTabs: true, width: 4 }, { useTabs: false, width: 2 })).toBe("    nested\n    alsoNested\n");
    });

    it("preserves content without leading whitespace", () => {
        const input = "no indent\nalso no indent\n";
        expect(convertIndentation(input, { useTabs: false, width: 4 }, { useTabs: true, width: 4 })).toBe(input);
    });
});
