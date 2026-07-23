import type { LlmMessage, LlmMessagePart } from "@triliumnext/commons";
import { encodeUtf8 } from "@triliumnext/core/src/services/utils/binary.js";
import type { LanguageModel } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LlmProviderConfig, ModelInfo } from "../types.js";

const { streamTextMock, generateTextMock, noteMetaMock, errorLogMock, beccaStub } = vi.hoisted(() => ({
    streamTextMock: vi.fn((..._args: any[]) => ({}) as any),
    generateTextMock: vi.fn(async (..._args: any[]) => ({ text: "  Generated Title  " })),
    noteMetaMock: vi.fn(() => ({ noteId: "ctx", contentPreview: "PREVIEW" })),
    errorLogMock: vi.fn(),
    // becca is accessed directly during message-part resolution and note-hint
    // building. Stub just these while keeping the rest of core intact.
    beccaStub: {
        getNote: vi.fn((noteId: string) => ({ noteId }) as any),
        getAttachment: vi.fn() as any
    }
}));

vi.mock("ai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("ai")>();
    return { ...actual, streamText: streamTextMock, generateText: generateTextMock };
});

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        becca: { ...actual.becca, ...beccaStub },
        // Spreading the real logger loses prototype methods (e.g. info), so stub it too.
        getLog: () => ({ ...actual.getLog(), error: errorLogMock, info: vi.fn() })
    };
});

vi.mock("../tools/helpers.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../tools/helpers.js")>();
    return { ...actual, getNoteMeta: noteMetaMock };
});

// Deterministic tool set so buildTools is exercised without real registries.
vi.mock("../tools/index.js", () => ({
    allToolRegistries: [{ toToolSet: () => ({ fake_tool: { description: "x" } }) }]
}));

import {
    BaseProvider,
    buildModelList,
    buildModelMessage,
    mergeModelLists,
    type ProviderPrices,
    type RemoteModel
} from "./base_provider.js";

const TEST_MODELS: Parameters<typeof buildModelList>[0] = [
    { id: "cheap", name: "Cheap", pricing: { input: 1, output: 2 } },
    { id: "mid", name: "Mid", pricing: { input: 2, output: 4 }, isDefault: true },
    { id: "spendy", name: "Spendy", pricing: { input: 10, output: 30 } }
];

const { pricing: BUILT_PRICING } = buildModelList(TEST_MODELS);

/** Injected price-table slice — the base class reads this instead of the JSON file. */
const TEST_PRICES: ProviderPrices = {
    cheap: { input: 1, output: 2 },
    mid: { input: 2, output: 4, ctx: 1000 },
    spendy: { input: 10, output: 30 }
};

class TestProvider extends BaseProvider {
    name = "test";
    protected defaultModel = "mid";
    protected titleModel = "cheap";
    protected override getProviderPrices(): ProviderPrices {
        return TEST_PRICES;
    }

    public createdModelIds: string[] = [];
    public fetchRemoteModelsMock = vi.fn<() => Promise<RemoteModel[] | null>>(async () => null);

    protected createModel(modelId: string): LanguageModel {
        this.createdModelIds.push(modelId);
        return { modelId } as unknown as LanguageModel;
    }

    protected override fetchRemoteModels(): Promise<RemoteModel[] | null> {
        return this.fetchRemoteModelsMock();
    }

    // Expose protected helpers for direct assertions.
    public callApplyNoteHint(m: LlmMessage[], c: LlmProviderConfig) {
        return this.applyNoteHint(m, c);
    }
    public callBuildMessages(m: LlmMessage[]) {
        return this.buildMessages(m);
    }
    /** Reach the base implementation past this class's own override. */
    public callBaseFetchRemoteModels() {
        return super.fetchRemoteModels();
    }
    public callFetchJson(url: string, headers: Record<string, string>) {
        return this.fetchJson(url, headers);
    }
    public callBaseGetProviderPrices() {
        return super.getProviderPrices();
    }
    /** Expose the normalized endpoint override for assertions. */
    public get normalizedBaseUrl() {
        return this.baseURL;
    }
}

/** Build a stub attachment with the given content/availability. */
function makeAttachment(over: Partial<Record<string, unknown>> = {}) {
    return {
        mime: "image/png",
        title: "att.png",
        isContentAvailable: () => true,
        getContent: () => Buffer.from("BYTES"),
        ...over
    } as any;
}

describe("buildModelList", () => {
    it("maps each model id to its pricing", () => {
        expect(BUILT_PRICING).toMatchObject({
            cheap: { input: 1, output: 2 },
            mid: { input: 2, output: 4 },
            spendy: { input: 10, output: 30 }
        });
    });
});

describe("getAvailableModels / getModelPricing (from the price table)", () => {
    it("builds the model list from the price table, sorted, with the default flagged", () => {
        const models = new TestProvider().getAvailableModels();
        expect(models.map((m) => m.id)).toEqual(["cheap", "mid", "spendy"]);
        expect(models[1]).toMatchObject({ id: "mid", pricing: { input: 2, output: 4 }, contextWindow: 1000, isDefault: true });
        // Non-default models carry no isDefault flag.
        expect(models[0].isDefault).toBeUndefined();
    });

    it("looks pricing up by model id, undefined for unknown", () => {
        const provider = new TestProvider();
        expect(provider.getModelPricing("spendy")).toEqual({ input: 10, output: 30 });
        expect(provider.getModelPricing("nope")).toBeUndefined();
    });
});

describe("base URL normalization", () => {
    it("strips trailing slashes and treats a blank override as none", () => {
        expect(new TestProvider("k", "http://localhost:11434/v1").normalizedBaseUrl).toBe("http://localhost:11434/v1");
        expect(new TestProvider("k", "http://localhost:11434/v1/").normalizedBaseUrl).toBe("http://localhost:11434/v1");
        expect(new TestProvider("k", "http://localhost:11434/v1///").normalizedBaseUrl).toBe("http://localhost:11434/v1");
        expect(new TestProvider("k").normalizedBaseUrl).toBeUndefined();
        expect(new TestProvider("k", "").normalizedBaseUrl).toBeUndefined();
        expect(new TestProvider("k", "///").normalizedBaseUrl).toBeUndefined();
    });

    it("trims a pathological run of trailing slashes without backtracking", () => {
        // The base URL comes straight from a request body, and the previous
        // `/\/+$/` pattern backtracked polynomially on this input, hanging the
        // server (CodeQL js/polynomial-redos).
        const hostile = `http://x${"/".repeat(100_000)}`;
        const startedAt = Date.now();
        expect(new TestProvider("k", hostile).normalizedBaseUrl).toBe("http://x");
        expect(Date.now() - startedAt).toBeLessThan(1000);
    });
});

describe("mergeModelLists", () => {
    const CURATED: ModelInfo[] = [
        { id: "gpt-4.1", name: "GPT-4.1", pricing: { input: 2, output: 8 }, contextWindow: 1047576, isDefault: true },
        { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", pricing: { input: 0.4, output: 1.6 }, contextWindow: 1047576 },
        { id: "gpt-4o", name: "GPT-4o", pricing: { input: 2.5, output: 10 }, contextWindow: 128000, isLegacy: true }
    ];

    it("keeps base metadata for known models and appends unknown ones alphabetically", () => {
        const merged = mergeModelLists(CURATED, [
            { id: "gpt-9" },
            { id: "gpt-4.1-mini" },
            { id: "gpt-5" },
            { id: "gpt-4.1" }
        ]);
        expect(merged.map(m => m.id)).toEqual(["gpt-4.1", "gpt-4.1-mini", "gpt-5", "gpt-9"]);
        // Base entries keep their pricing/default metadata...
        expect(merged[0]).toMatchObject({ name: "GPT-4.1", pricing: { input: 2, output: 8 }, isDefault: true });
        // ...unknown ones carry no pricing.
        expect(merged[2]).toEqual({ id: "gpt-5", name: "gpt-5", contextWindow: undefined });
    });

    it("prefers the endpoint's display name over the base list's for known models", () => {
        const merged = mergeModelLists(
            [{ id: "gpt-4.1", name: "gpt-4.1", pricing: { input: 2, output: 8 } }],
            [{ id: "gpt-4.1", name: "GPT-4.1 (from endpoint)" }]
        );
        expect(merged[0].name).toBe("GPT-4.1 (from endpoint)");
    });

    it("drops curated models absent from the remote list", () => {
        expect(mergeModelLists(CURATED, [{ id: "gpt-4.1" }]).map(m => m.id)).toEqual(["gpt-4.1"]);
    });

    it("uses the remote display name and context window when provided", () => {
        const merged = mergeModelLists([], [{ id: "llama3.2", name: "Llama 3.2", contextWindow: 131072 }]);
        expect(merged[0]).toMatchObject({ id: "llama3.2", name: "Llama 3.2", contextWindow: 131072, isDefault: true });
    });

    it("fills a curated model's missing context window from the remote data", () => {
        const curated: ModelInfo[] = [{ id: "m", name: "M", pricing: { input: 1, output: 1 } }];
        expect(mergeModelLists(curated, [{ id: "m", contextWindow: 32000 }])[0].contextWindow).toBe(32000);
    });

    it("promotes the first model to default when the curated default is unavailable", () => {
        const merged = mergeModelLists(CURATED, [{ id: "gpt-4o" }, { id: "custom-model" }]);
        expect(merged.map(m => [m.id, m.isDefault ?? false])).toEqual([
            ["gpt-4o", true],
            ["custom-model", false]
        ]);
    });

    it("returns an empty list when the remote list shares nothing and is empty", () => {
        expect(mergeModelLists(CURATED, [])).toEqual([]);
    });
});

describe("recommendedModelIds (generic rule)", () => {
    it("recommends every model that is neither a preview nor legacy", () => {
        // Providers whose id shape carries no recency signal (e.g. Google) keep
        // this default; OpenAI/Anthropic override it in their own modules.
        const ids = new TestProvider().recommendedModelIds([
            { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
            { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
            { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", isLegacy: true }
        ]);
        expect([...ids]).toEqual(["gemini-2.5-flash"]);
    });
});

describe("listModels", () => {
    it("returns the price-table list when the provider has no dynamic listing", async () => {
        const models = await new TestProvider().listModels();
        expect(models.map((m) => m.id)).toEqual(["cheap", "mid", "spendy"]);
    });

    it("merges the remote list with price-table metadata and caches the result", async () => {
        const provider = new TestProvider();
        provider.fetchRemoteModelsMock.mockResolvedValue([{ id: "mid" }, { id: "brand-new" }]);

        const models = await provider.listModels();
        expect(models.map((m) => m.id)).toEqual(["mid", "brand-new"]);
        // Known model keeps its price-table pricing + default flag...
        expect(models[0]).toMatchObject({ id: "mid", pricing: { input: 2, output: 4 }, isDefault: true });
        // ...unknown one has no pricing.
        expect(models[1].pricing).toBeUndefined();

        // Second call is served from the cache — no second fetch.
        await expect(provider.listModels()).resolves.toBe(models);
        expect(provider.fetchRemoteModelsMock).toHaveBeenCalledTimes(1);
    });

    it("deduplicates concurrent calls into a single fetch", async () => {
        const provider = new TestProvider();
        provider.fetchRemoteModelsMock.mockResolvedValue([{ id: "mid" }]);

        const [a, b] = await Promise.all([provider.listModels(), provider.listModels()]);
        expect(a).toBe(b);
        expect(provider.fetchRemoteModelsMock).toHaveBeenCalledTimes(1);
    });

    it("propagates a fetch failure (e.g. a bad API key) so the add/edit modal can surface it", async () => {
        const provider = new TestProvider();
        provider.fetchRemoteModelsMock.mockRejectedValue(new Error("HTTP 401"));
        await expect(provider.listModels()).rejects.toThrow("HTTP 401");
    });

    it("falls back to the price-table list when the remote list is empty", async () => {
        const provider = new TestProvider();
        provider.fetchRemoteModelsMock.mockResolvedValue([]);
        expect((await provider.listModels()).map((m) => m.id)).toEqual(["cheap", "mid", "spendy"]);
    });
});

describe("fetchRemoteModels / fetchJson (base defaults and errors)", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("base fetchRemoteModels returns null — providers opt in to dynamic listing", async () => {
        await expect(new TestProvider().callBaseFetchRemoteModels()).resolves.toBeNull();
    });

    it("fetchJson raises a plain HTTP error for a non-auth failure", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
        await expect(new TestProvider().callFetchJson("https://api.example/models", { "x-key": "v" }))
            .rejects.toThrow("HTTP 500 from https://api.example/models");
    });

    it("fetchJson reports an auth failure so the add/edit screen can flag the credential", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401 })));
        await expect(new TestProvider().callFetchJson("https://api.example/models", { "x-key": "v" }))
            .rejects.toThrow(/Authentication failed \(HTTP 401\) — check the API key\.$/);
    });

    it("fetchJson's auth error also blames the base URL when one is configured", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403 })));
        await expect(new TestProvider("key", "https://proxy.example").callFetchJson("https://proxy.example/models", {}))
            .rejects.toThrow(/check the API key and base URL\./);
    });

    it("fetchJson returns the parsed JSON on success", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [1, 2] }) })));
        await expect(new TestProvider().callFetchJson("https://api.example/models", {}))
            .resolves.toEqual({ data: [1, 2] });
    });

    it("getProviderPrices returns an empty table for a provider absent from the price file", () => {
        // TestProvider.name ("test") has no entry in the committed price table,
        // so the base lookup falls back to an empty map.
        expect(new TestProvider().callBaseGetProviderPrices()).toEqual({});
    });
});

describe("buildModelMessage", () => {
    beforeEach(() => {
        beccaStub.getAttachment.mockReset();
        errorLogMock.mockClear();
    });

    it("passes plain string content straight through", () => {
        expect(buildModelMessage({ role: "user", content: "hi" })).toEqual({ role: "user", content: "hi" });
        expect(buildModelMessage({ role: "assistant", content: "yo" })).toEqual({ role: "assistant", content: "yo" });
    });

    it("resolves an image attachment into an image part", () => {
        beccaStub.getAttachment.mockReturnValue(makeAttachment({ mime: "image/png" }));
        const msg = buildModelMessage({
            role: "user",
            content: [{ type: "image", attachmentId: "a1", mime: "image/png" }]
        });
        expect((msg.content as any[])[0]).toMatchObject({ type: "image", mediaType: "image/png" });
    });

    it("falls back to the attachment mime when the image part omits it", () => {
        beccaStub.getAttachment.mockReturnValue(makeAttachment({ mime: "image/jpeg" }));
        const msg = buildModelMessage({
            role: "user",
            content: [{ type: "image", attachmentId: "a1" } as unknown as LlmMessagePart]
        });
        expect((msg.content as any[])[0]).toMatchObject({ type: "image", mediaType: "image/jpeg" });
    });

    it("inlines an SVG image as labelled text, falling back to image.svg when untitled", () => {
        beccaStub.getAttachment.mockReturnValue(makeAttachment({
            mime: "image/svg+xml",
            title: "",
            getContent: () => encodeUtf8("<svg/>")
        }));
        const msg = buildModelMessage({
            role: "user",
            // part.mime omitted → falls back to the attachment's svg mime.
            content: [{ type: "image", attachmentId: "svg1" } as unknown as LlmMessagePart]
        });
        const part = (msg.content as any[])[0];
        expect(part.type).toBe("text");
        expect(part.text).toContain("<file name=\"image.svg\">");
        expect(part.text).toContain("<svg/>");
    });

    it("resolves a file attachment, using part overrides for mime and filename", () => {
        beccaStub.getAttachment.mockReturnValue(makeAttachment({ mime: "application/octet-stream", title: "fallback" }));
        const msg = buildModelMessage({
            role: "user",
            content: [{ type: "file", attachmentId: "f1", mime: "application/pdf", filename: "doc.pdf" }]
        });
        expect((msg.content as any[])[0]).toMatchObject({
            type: "file",
            mediaType: "application/pdf",
            filename: "doc.pdf"
        });
    });

    it("falls back to the attachment's own mime/title for a file part without overrides", () => {
        beccaStub.getAttachment.mockReturnValue(makeAttachment({ mime: "application/pdf", title: "report.pdf" }));
        const msg = buildModelMessage({
            role: "user",
            content: [{ type: "file", attachmentId: "f2" } as unknown as LlmMessagePart]
        });
        expect((msg.content as any[])[0]).toMatchObject({
            type: "file",
            mediaType: "application/pdf",
            filename: "report.pdf"
        });
    });

    it("decodes a text_attachment into a labelled text block", () => {
        beccaStub.getAttachment.mockReturnValue(makeAttachment({
            getContent: () => encodeUtf8("file body"),
            title: "notes.md"
        }));
        const msg = buildModelMessage({
            role: "user",
            content: [{ type: "text_attachment", attachmentId: "t1", filename: "custom.md" }]
        });
        const part = (msg.content as any[])[0];
        expect(part.type).toBe("text");
        expect(part.text).toBe("<file name=\"custom.md\">\nfile body\n</file>");
    });

    it("uses the attachment title as the text_attachment filename when the part omits it", () => {
        beccaStub.getAttachment.mockReturnValue(makeAttachment({
            getContent: () => encodeUtf8("body"),
            title: "fallback.txt"
        }));
        const msg = buildModelMessage({
            role: "user",
            content: [{ type: "text_attachment", attachmentId: "t2" } as unknown as LlmMessagePart]
        });
        expect((msg.content as any[])[0].text).toContain("<file name=\"fallback.txt\">");
    });

    it("drops a part when its attachment is missing and logs an error", () => {
        beccaStub.getAttachment.mockReturnValue(null);
        const msg = buildModelMessage({
            role: "user",
            content: [{ type: "image", attachmentId: "gone", mime: "image/png" }]
        });
        expect(msg.content).toEqual([]);
        expect(errorLogMock).toHaveBeenCalledWith(expect.stringContaining("missing attachment gone"));
    });

    it("drops a protected attachment that is not content-available", () => {
        beccaStub.getAttachment.mockReturnValue(makeAttachment({ isContentAvailable: () => false }));
        const msg = buildModelMessage({
            role: "user",
            content: [{ type: "file", attachmentId: "locked", mime: "application/pdf", filename: "x.pdf" }]
        });
        expect(msg.content).toEqual([]);
        expect(errorLogMock).toHaveBeenCalledWith(expect.stringContaining("protected attachment locked"));
    });

    it("drops a part whose resolution throws and logs the failure", () => {
        beccaStub.getAttachment.mockImplementation(() => { throw new Error("blob corrupt"); });
        const msg = buildModelMessage({
            role: "user",
            content: [
                { type: "text", text: "still here" },
                { type: "image", attachmentId: "bad", mime: "image/png" }
            ]
        });
        expect(msg.content).toEqual([{ type: "text", text: "still here" }]);
        expect(errorLogMock).toHaveBeenCalledWith(expect.stringContaining("Failed to resolve message part"));
    });

    it("strips non-text parts from assistant turns", () => {
        beccaStub.getAttachment.mockReturnValue(makeAttachment());
        const msg = buildModelMessage({
            role: "assistant",
            content: [
                { type: "text", text: "thinking" },
                { type: "image", attachmentId: "a", mime: "image/png" }
            ]
        });
        expect(msg).toEqual({ role: "assistant", content: [{ type: "text", text: "thinking" }] });
    });
});

describe("BaseProvider applyNoteHint", () => {
    const provider = new TestProvider();

    beforeEach(() => {
        beccaStub.getNote.mockReset().mockImplementation((noteId: string) => ({ noteId }) as any);
        noteMetaMock.mockReset().mockReturnValue({ noteId: "ctx", contentPreview: "PREVIEW" });
    });

    it("returns messages unchanged when there is no context note", () => {
        const messages: LlmMessage[] = [{ role: "user", content: "hi" }];
        expect(provider.callApplyNoteHint(messages, {})).toBe(messages);
    });

    it("returns messages unchanged when there is no user message", () => {
        const messages: LlmMessage[] = [{ role: "assistant", content: "hi" }];
        expect(provider.callApplyNoteHint(messages, { contextNoteId: "ctx" })).toBe(messages);
    });

    it("returns messages unchanged when the context note no longer exists", () => {
        beccaStub.getNote.mockReturnValue(null);
        const messages: LlmMessage[] = [{ role: "user", content: "hi" }];
        expect(provider.callApplyNoteHint(messages, { contextNoteId: "missing" })).toBe(messages);
    });

    it("prepends the note hint to the last user string message", () => {
        const out = provider.callApplyNoteHint(
            [
                { role: "user", content: "first" },
                { role: "assistant", content: "ok" },
                { role: "user", content: "second" }
            ],
            { contextNoteId: "ctx" }
        );
        expect(out[0].content).toBe("first");
        expect(out[2].content).toContain("PREVIEW");
        expect(out[2].content).toContain("second");
    });

    it("prepends the note hint as a leading text part for multimodal content (attachments noted)", () => {
        beccaStub.getAttachment?.mockReturnValue?.(makeAttachment());
        const out = provider.callApplyNoteHint(
            [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "look" },
                        { type: "image", attachmentId: "a", mime: "image/png" }
                    ]
                }
            ],
            { contextNoteId: "ctx" }
        );
        const content = out[0].content as LlmMessagePart[];
        expect(content[0]).toMatchObject({ type: "text" });
        expect((content[0] as any).text).toContain("PREVIEW");
        // hasAttachments true → the note hint mentions the attached files.
        expect((content[0] as any).text).toContain("attached files");
        // Original parts are preserved after the hint.
        expect(content[1]).toMatchObject({ type: "text", text: "look" });
    });
});

describe("BaseProvider chat / pricing / models / title", () => {
    beforeEach(() => {
        streamTextMock.mockClear();
        generateTextMock.mockClear();
        beccaStub.getNote.mockReset().mockImplementation((noteId: string) => ({ noteId }) as any);
    });

    it("omits tool options when no tools are enabled", () => {
        const provider = new TestProvider();
        provider.chat([{ role: "user", content: "hi" }], {});
        const opts = streamTextMock.mock.calls[0][0] as any;
        expect(opts.tools).toBeUndefined();
        expect(opts.toolChoice).toBeUndefined();
        expect(opts.stopWhen).toBeUndefined();
        // Default max tokens applied when none configured.
        expect(opts.maxOutputTokens).toBe(8096);
        // onError is silenced (no-op) rather than left to the SDK's stdout dump.
        expect(typeof opts.onError).toBe("function");
        expect(opts.onError(new Error("x"))).toBeUndefined();
    });

    it("invokes the no-op base addWebSearchTool when web search is enabled (adds nothing)", () => {
        const provider = new TestProvider();
        // Spy through to the real no-op: it MUST be invoked (the claim of the test),
        // and because it adds nothing the tool set stays empty.
        const addWebSearchSpy = vi.spyOn(provider as unknown as { addWebSearchTool: () => void }, "addWebSearchTool");
        provider.chat([{ role: "user", content: "hi" }], { enableWebSearch: true });
        expect(addWebSearchSpy).toHaveBeenCalledOnce();
        const opts = streamTextMock.mock.calls[0][0] as any;
        expect(opts.tools).toBeUndefined();
        expect(opts.toolChoice).toBeUndefined();
    });

    it("attaches tools, stopWhen and toolChoice when note tools are enabled and honours maxTokens", () => {
        const provider = new TestProvider();
        provider.chat([{ role: "user", content: "hi" }], { enableNoteTools: true, maxTokens: 1234 });
        const opts = streamTextMock.mock.calls[0][0] as any;
        expect(opts.tools).toHaveProperty("fake_tool");
        expect(opts.toolChoice).toBe("auto");
        expect(opts.stopWhen).toBeDefined();
        expect(opts.maxOutputTokens).toBe(1234);
    });

    it("creates the model from config.model, falling back to the default", () => {
        const provider = new TestProvider();
        provider.chat([{ role: "user", content: "hi" }], {});
        expect(provider.createdModelIds).toContain("mid");

        const provider2 = new TestProvider();
        provider2.chat([{ role: "user", content: "hi" }], { model: "spendy" });
        expect(provider2.createdModelIds).toContain("spendy");
    });

    it("generateTitle uses the title model and trims the result", async () => {
        const provider = new TestProvider();
        const title = await provider.generateTitle("Some long first message");
        expect(title).toBe("Generated Title");
        expect(provider.createdModelIds).toContain("cheap");
        const args = generateTextMock.mock.calls[0][0] as any;
        expect(args.maxOutputTokens).toBe(30);
        expect(args.messages[0].content).toContain("Some long first message");
    });
});

describe("BaseProvider default buildSystemMessage", () => {
    it("returns the system prompt unchanged (no provider-specific wrapping)", () => {
        const provider = new TestProvider() as any;
        expect(provider.buildSystemMessage("PLAIN")).toBe("PLAIN");
        expect(provider.buildSystemMessage(undefined)).toBeUndefined();
    });
});
