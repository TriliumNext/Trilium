import type { LlmMessage } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createGoogleMock = vi.fn();
const googleSearchMock = vi.fn(() => ({ kind: "google_search" }));

vi.mock("@ai-sdk/google", () => ({
    createGoogleGenerativeAI: (opts: unknown) => {
        createGoogleMock(opts);
        const fn: any = () => ({});
        fn.tools = { googleSearch: googleSearchMock };
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

import { GoogleProvider, isGoogleChatModel } from "./google.js";

describe("GoogleProvider construction", () => {
    beforeEach(() => {
        createGoogleMock.mockClear();
    });

    it("forwards apiKey only when no baseURL provided", () => {
        new GoogleProvider("test-key");
        expect(createGoogleMock).toHaveBeenCalledTimes(1);
        expect(createGoogleMock).toHaveBeenCalledWith({ apiKey: "test-key" });
    });

    it("forwards apiKey and baseURL when both provided", () => {
        new GoogleProvider("test-key", "https://proxy.example.com/v1beta");
        expect(createGoogleMock).toHaveBeenCalledWith({
            apiKey: "test-key",
            baseURL: "https://proxy.example.com/v1beta"
        });
    });

    it("omits baseURL when empty string is provided", () => {
        new GoogleProvider("test-key", "");
        expect(createGoogleMock).toHaveBeenCalledWith({ apiKey: "test-key" });
    });

    it("throws when apiKey is missing", () => {
        expect(() => new GoogleProvider("")).toThrow(/API key is required/);
    });
});

describe("GoogleProvider message building", () => {
    beforeEach(() => {
        streamTextMock.mockClear();
    });

    it("buildSystemMessage returns the system prompt as a plain string", () => {
        const provider = new GoogleProvider("test-key") as any;

        expect(provider.buildSystemMessage("You are helpful.")).toBe("You are helpful.");
        expect(provider.buildSystemMessage(undefined)).toBeUndefined();
    });

    it("buildMessages maps user/assistant turns and emits no system role", () => {
        const provider = new GoogleProvider("test-key") as any;
        const messages: LlmMessage[] = [
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" }
        ];

        const built = provider.buildMessages(messages);

        expect(built).toEqual([
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" }
        ]);
    });

    it("chat() routes the system prompt into the `system` option and forbids system messages in `messages`", () => {
        const provider = new GoogleProvider("test-key");
        provider.chat(
            [
                { role: "system", content: "BASE PROMPT" },
                { role: "user", content: "hello" }
            ],
            {}
        );

        expect(streamTextMock).toHaveBeenCalledOnce();
        const opts = streamTextMock.mock.calls[0][0] as any;

        expect(opts.allowSystemInMessages).toBe(false);
        expect(opts.messages.every((m: any) => m.role !== "system")).toBe(true);
        expect(typeof opts.system).toBe("string");
        expect(opts.system).toContain("BASE PROMPT");
    });

    it("chat() with extended thinking also guards against system messages in `messages`", () => {
        const provider = new GoogleProvider("test-key");
        provider.chat(
            [
                { role: "system", content: "BASE PROMPT" },
                { role: "user", content: "hello" }
            ],
            { enableExtendedThinking: true }
        );

        const opts = streamTextMock.mock.calls[0][0] as any;

        expect(opts.allowSystemInMessages).toBe(false);
        expect(opts.messages.every((m: any) => m.role !== "system")).toBe(true);
        expect(typeof opts.system).toBe("string");
        expect(opts.system).toContain("BASE PROMPT");
        // Extended thinking forwards Gemini's thinkingConfig.
        expect(opts.providerOptions.google.thinkingConfig.thinkingBudget).toBe(10000);
    });
});

describe("GoogleProvider tool handling", () => {
    beforeEach(() => {
        streamTextMock.mockClear();
        googleSearchMock.mockClear();
    });

    it("adds the googleSearch tool when only web search is enabled", () => {
        const provider = new GoogleProvider("test-key");
        provider.chat([{ role: "user", content: "hi" }], { enableWebSearch: true });

        expect(googleSearchMock).toHaveBeenCalledOnce();
        const opts = streamTextMock.mock.calls[0][0] as any;
        expect(opts.tools.google_search).toEqual({ kind: "google_search" });
        expect(opts.toolChoice).toBe("auto");
    });

    it("drops googleSearch and warns the model when note tools and web search are both enabled", () => {
        const provider = new GoogleProvider("test-key");
        provider.chat([{ role: "user", content: "hi" }], {
            enableWebSearch: true,
            enableNoteTools: true
        });

        // The conflict path strips google_search but keeps the function tools.
        expect(googleSearchMock).not.toHaveBeenCalled();
        const opts = streamTextMock.mock.calls[0][0] as any;
        expect(opts.tools.google_search).toBeUndefined();
        expect(Object.keys(opts.tools).length).toBeGreaterThan(0);
        // The system prompt gains the conflict explanation.
        expect(opts.system).toContain("web search is unavailable in this turn");
    });

    it("forwards thinkingBudget override under extended thinking with tools enabled", () => {
        const provider = new GoogleProvider("test-key");
        provider.chat([{ role: "user", content: "hi" }], {
            enableExtendedThinking: true,
            enableNoteTools: true,
            thinkingBudget: 25000,
            maxTokens: 5000
        });

        const opts = streamTextMock.mock.calls[0][0] as any;
        expect(opts.providerOptions.google.thinkingConfig.thinkingBudget).toBe(25000);
        expect(opts.maxOutputTokens).toBe(5000);
        // Function tools present → agentic loop options set on the thinking path.
        expect(opts.toolChoice).toBe("auto");
        expect(opts.stopWhen).toBeDefined();
    });
});

describe("GoogleProvider model listing", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const okJson = (body: unknown) => ({ ok: true, json: async () => body });

    it("keeps generateContent-capable chat models, stripping the models/ prefix", async () => {
        fetchMock.mockResolvedValue(okJson({
            models: [
                { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", inputTokenLimit: 1048576, supportedGenerationMethods: ["generateContent"] },
                { name: "models/gemini-3-pro", displayName: "Gemini 3 Pro", inputTokenLimit: 2097152, supportedGenerationMethods: ["generateContent"] },
                { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
                { name: "models/imagen-3.0-generate-002", supportedGenerationMethods: ["generateContent"] }
            ]
        }));
        const provider = new GoogleProvider("g-key");

        const models = await provider.listModels();
        expect(fetchMock).toHaveBeenCalledWith(
            "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
            expect.objectContaining({ headers: { "x-goog-api-key": "g-key" } })
        );
        expect(models.map((m) => m.id)).toEqual(["gemini-2.5-flash", "gemini-3-pro"]);
        // Curated entry keeps its metadata; the unknown one takes the API's
        // display name and token limit.
        expect(models[0]).toMatchObject({ name: "Gemini 2.5 Flash", isDefault: true });
        expect(models[1]).toMatchObject({ name: "Gemini 3 Pro", contextWindow: 2097152 });
    });

    it("propagates a failed fetch as an authentication error the modal can surface", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 403 });
        const provider = new GoogleProvider("g-key");
        await expect(provider.listModels()).rejects.toThrow(/Authentication failed/);
    });

    it("rejects a /models payload whose models field is not an array", async () => {
        fetchMock.mockResolvedValue(okJson({ models: { unexpected: "shape" } }));
        const provider = new GoogleProvider("g-key");
        await expect(provider.listModels()).rejects.toThrow(/Unexpected \/models response shape/);
    });
});

describe("isGoogleChatModel", () => {
    it("keeps Gemini chat models, including unknown future ones", () => {
        for (const id of [
            "gemini-2.5-pro",
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-3-flash-preview",
            "gemini-3.1-pro-preview",
            "gemini-3.5-flash",
            "gemini-3.6-flash",
            "gemini-2.0-flash-exp"
        ]) {
            expect(isGoogleChatModel(id), id).toBe(true);
        }
    });

    it("drops non-Gemini families wholesale", () => {
        for (const id of [
            "text-embedding-004",
            "aqa",
            "imagen-3.0-generate-002",
            "veo-3.1-generate-preview",
            "lyria-3-pro-preview",
            "gemma-4-26b-a4b-it",
            "deep-research-preview-04-2026",
            "antigravity-preview-05-2026",
            "learnlm-2.0-flash-experimental"
        ]) {
            expect(isGoogleChatModel(id), id).toBe(false);
        }
    });

    it("drops non-conversational gemini-* variants (media, robotics, computer use)", () => {
        for (const id of [
            "gemini-embedding-001",
            "gemini-2.5-flash-image", // Nano Banana
            "gemini-3-pro-image", // Nano Banana Pro
            "gemini-3.1-flash-lite-image", // Nano Banana 2 Lite
            "gemini-2.5-flash-preview-tts",
            "gemini-3.1-flash-live-preview",
            "gemini-2.5-flash-native-audio-preview-12-2025",
            "gemini-omni-flash",
            "gemini-robotics-er-1.6-preview",
            "gemini-2.5-computer-use-preview-10-2025",
            "gemini-3.1-pro-preview-customtools" // real id — no hyphen in "customtools"
        ]) {
            expect(isGoogleChatModel(id), id).toBe(false);
        }
    });

    it("drops rolling aliases and pinned revisions that duplicate stable ids", () => {
        for (const id of ["gemini-flash-latest", "gemini-pro-latest", "gemini-flash-lite-latest", "gemini-2.0-flash-lite-001"]) {
            expect(isGoogleChatModel(id), id).toBe(false);
        }
    });
});
