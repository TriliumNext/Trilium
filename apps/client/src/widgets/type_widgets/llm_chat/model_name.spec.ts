import { describe, expect, it } from "vitest";

import { shortModelName } from "./model_name.js";

describe("shortModelName", () => {
    it("drops the vendor word when a family word remains", () => {
        expect(shortModelName("Claude Sonnet 4.5", "anthropic")).toBe("Sonnet 4.5");
        expect(shortModelName("Claude Opus 4.8", "claude-agent")).toBe("Opus 4.8");
        expect(shortModelName("DeepSeek V4 Pro", "deepseek")).toBe("V4 Pro");
    });

    it("keeps the vendor word when dropping it would leave a bare version", () => {
        // For Gemini the vendor word is the family word — "3.1 Pro" identifies nothing.
        expect(shortModelName("Gemini 3.1 Pro", "google")).toBe("Gemini 3.1 Pro");
        expect(shortModelName("Gemini 3.5 Flash Lite", "google")).toBe("Gemini 3.5 Flash Lite");
        // ...but a named Gemini model shortens like any other.
        expect(shortModelName("Gemini Nano Pro", "google")).toBe("Nano Pro");
    });

    it("leaves alone providers that don't prefix, and names that don't carry the prefix", () => {
        expect(shortModelName("GPT-5", "openai")).toBe("GPT-5");
        expect(shortModelName("GPT-4.1 Mini", "openai")).toBe("GPT-4.1 Mini");
        expect(shortModelName("llama3.2", "ollama")).toBe("llama3.2");
        // Right vendor, but the name doesn't start with it.
        expect(shortModelName("Sonnet 4.5", "anthropic")).toBe("Sonnet 4.5");
    });

    it("only strips a whole leading word, never a partial match", () => {
        // "Claudette" starts with "Claude" as a substring but is a different word.
        expect(shortModelName("Claudette 2", "anthropic")).toBe("Claudette 2");
        expect(shortModelName("Claude", "anthropic")).toBe("Claude");
    });

    it("handles an unknown or missing provider without guessing", () => {
        expect(shortModelName("Claude Sonnet 4.5", undefined)).toBe("Claude Sonnet 4.5");
        expect(shortModelName("Claude Sonnet 4.5", "openai-compatible")).toBe("Claude Sonnet 4.5");
    });
});
