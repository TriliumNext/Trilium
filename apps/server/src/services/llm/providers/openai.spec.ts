import { describe, expect, it, vi, beforeEach } from "vitest";

const createOpenAIMock = vi.fn();

vi.mock("@ai-sdk/openai", () => ({
    createOpenAI: (opts: unknown) => {
        createOpenAIMock(opts);
        const fn: any = () => ({});
        fn.tools = { webSearch: () => ({}) };
        return fn;
    }
}));

import { OpenAiProvider } from "./openai.js";

describe("OpenAiProvider construction", () => {
    beforeEach(() => {
        createOpenAIMock.mockClear();
    });

    it("forwards apiKey only when no baseURL provided", () => {
        new OpenAiProvider("sk-test");
        expect(createOpenAIMock).toHaveBeenCalledTimes(1);
        expect(createOpenAIMock).toHaveBeenCalledWith({ apiKey: "sk-test" });
    });

    it("forwards apiKey and baseURL when both provided", () => {
        new OpenAiProvider("sk-test", "http://localhost:11434/v1");
        expect(createOpenAIMock).toHaveBeenCalledWith({
            apiKey: "sk-test",
            baseURL: "http://localhost:11434/v1"
        });
    });

    it("omits baseURL when empty string is provided", () => {
        new OpenAiProvider("sk-test", "");
        expect(createOpenAIMock).toHaveBeenCalledWith({ apiKey: "sk-test" });
    });

    it("throws when apiKey is missing", () => {
        expect(() => new OpenAiProvider("")).toThrow(/API key is required/);
    });
});
