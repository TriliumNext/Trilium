import { describe, expect, it } from "vitest";
import { extractCodeBlocks } from "./markdown_renderer.js";

describe("extractCodeBlocks", () => {
    it("should extract a fenced code block", () => {
        const input = "before\n```js\nconsole.log('hi');\n```\nafter";
        const { processedText, placeholderMap } = extractCodeBlocks(input);

        expect(placeholderMap.size).toBe(1);
        expect(processedText).toContain("before\n");
        expect(processedText).toContain("\nafter");
        expect(processedText).not.toContain("```");

        const placeholder = [...placeholderMap.keys()][0];
        expect(placeholderMap.get(placeholder)).toBe("```js\nconsole.log('hi');\n```");
    });

    it("should extract inline code", () => {
        const input = "use `console.log` here";
        const { processedText, placeholderMap } = extractCodeBlocks(input);

        expect(placeholderMap.size).toBe(1);
        expect(processedText).not.toContain("`console.log`");

        const placeholder = [...placeholderMap.keys()][0];
        expect(placeholderMap.get(placeholder)).toBe("`console.log`");
    });

    it("should extract multiple fenced code blocks independently", () => {
        const input = "```js\na\n```\ntext\n```py\nb\n```";
        const { processedText, placeholderMap } = extractCodeBlocks(input);

        expect(placeholderMap.size).toBe(2);
        expect(processedText).toContain("text");
    });

    it("should not treat inline backtick-escaped triple backticks as a fenced code block", () => {
        const input = [
            "*   Code blocks with syntax highlight (e.g. ` ```js `) and automatic syntax highlight",
            "*   Block quotes & admonitions",
            "*   Math Equations",
            "*   Mermaid Diagrams using ` ```mermaid `"
        ].join("\n");

        const { processedText, placeholderMap } = extractCodeBlocks(input);

        // All four bullet points must survive
        expect(processedText).toContain("Block quotes & admonitions");
        expect(processedText).toContain("Math Equations");
        expect(processedText).toContain("Mermaid Diagrams");
        expect(processedText).toContain("automatic syntax highlight");

        // The inline code spans should be extracted, not fenced code blocks
        for (const value of placeholderMap.values()) {
            expect(value).not.toMatch(/^```[\s\S]*```$/);
        }
    });

    it("should not swallow content between two inline triple-backtick mentions", () => {
        const input = "Use ` ```js ` for JS and ` ```py ` for Python";
        const { processedText } = extractCodeBlocks(input);

        expect(processedText).toContain("for JS and");
        expect(processedText).toContain("for Python");
    });

    it("should handle a real fenced code block after inline triple backticks", () => {
        const input = [
            "Use ` ```js ` for JavaScript.",
            "",
            "```py",
            "print('hello')",
            "```"
        ].join("\n");

        const { processedText, placeholderMap } = extractCodeBlocks(input);

        expect(processedText).toContain("for JavaScript.");

        // Should have the inline code and the fenced block as separate entries
        const values = [...placeholderMap.values()];
        const hasFencedBlock = values.some((v) => v.includes("print('hello')"));
        expect(hasFencedBlock).toBe(true);
    });
});
