import { describe, expect, it, vi, beforeEach } from "vitest";

const createOpenAIMock = vi.fn();
const webSearchMock = vi.fn(() => ({ kind: "web_search" }));
const modelMock = vi.fn((modelId: string) => ({ modelId }));

vi.mock("@ai-sdk/openai", () => ({
    createOpenAI: (opts: unknown) => {
        createOpenAIMock(opts);
        const fn: any = (modelId: string) => modelMock(modelId);
        fn.tools = { webSearch: webSearchMock };
        return fn;
    }
}));

const { streamTextMock } = vi.hoisted(() => ({
    streamTextMock: vi.fn((..._args: any[]) => ({}) as any)
}));

vi.mock("ai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("ai")>();
    return { ...actual, streamText: streamTextMock };
});

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

describe("OpenAiProvider chat", () => {
    beforeEach(() => {
        streamTextMock.mockClear();
        webSearchMock.mockClear();
        modelMock.mockClear();
    });

    it("createModel uses the configured model id, falling back to the default", () => {
        const provider = new OpenAiProvider("sk-test");
        provider.chat([{ role: "user", content: "hi" }], {});
        expect(modelMock).toHaveBeenLastCalledWith("gpt-4.1");

        provider.chat([{ role: "user", content: "hi" }], { model: "o3" });
        expect(modelMock).toHaveBeenLastCalledWith("o3");
    });

    it("adds the OpenAI web_search tool when web search is enabled", () => {
        const provider = new OpenAiProvider("sk-test");
        provider.chat([{ role: "user", content: "hi" }], { enableWebSearch: true });

        expect(webSearchMock).toHaveBeenCalledOnce();
        const opts = streamTextMock.mock.calls[0][0] as any;
        expect(opts.tools.web_search).toEqual({ kind: "web_search" });
        // Tools present → agentic loop options are set.
        expect(opts.toolChoice).toBe("auto");
        expect(opts.stopWhen).toBeDefined();
    });
});
