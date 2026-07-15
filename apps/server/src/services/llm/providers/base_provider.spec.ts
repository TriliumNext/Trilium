import type { LlmMessage, LlmMessagePart } from "@triliumnext/commons";
import { encodeUtf8 } from "@triliumnext/core/src/services/utils/binary.js";
import type { LanguageModel } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
        getLog: () => ({ ...actual.getLog(), error: errorLogMock })
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

import { BaseProvider, buildModelList, buildModelMessage } from "./base_provider.js";

const TEST_MODELS: Omit<ModelInfo, "costMultiplier">[] = [
    { id: "cheap", name: "Cheap", pricing: { input: 1, output: 2 } },
    { id: "mid", name: "Mid", pricing: { input: 2, output: 4 }, isDefault: true },
    { id: "spendy", name: "Spendy", pricing: { input: 10, output: 30 } }
];

const { models: BUILT_MODELS, pricing: BUILT_PRICING } = buildModelList(TEST_MODELS);

class TestProvider extends BaseProvider {
    name = "test";
    protected defaultModel = "mid";
    protected titleModel = "cheap";
    protected availableModels = BUILT_MODELS;
    protected modelPricing = BUILT_PRICING;

    public createdModelIds: string[] = [];

    protected createModel(modelId: string): LanguageModel {
        this.createdModelIds.push(modelId);
        return { modelId } as unknown as LanguageModel;
    }

    // Expose protected helpers for direct assertions.
    public callApplyNoteHint(m: LlmMessage[], c: LlmProviderConfig) {
        return this.applyNoteHint(m, c);
    }
    public callBuildMessages(m: LlmMessage[]) {
        return this.buildMessages(m);
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
    it("derives cost multipliers relative to the default (baseline) model", () => {
        // Baseline = mid: effective = (2 + 3*4)/4 = 3.5
        const byId = Object.fromEntries(BUILT_MODELS.map((m) => [m.id, m]));
        expect(byId.mid.costMultiplier).toBe(1);
        // cheap: (1 + 3*2)/4 = 1.75 → 1.75/3.5 = 0.5
        expect(byId.cheap.costMultiplier).toBe(0.5);
        // spendy: (10 + 3*30)/4 = 25 → 25/3.5 = 7.14 → rounded to 7.1
        expect(byId.spendy.costMultiplier).toBe(7.1);
    });

    it("falls back to the first model as baseline when none is marked default", () => {
        const { models } = buildModelList([
            { id: "a", name: "A", pricing: { input: 2, output: 4 } },
            { id: "b", name: "B", pricing: { input: 4, output: 8 } }
        ]);
        expect(models[0].costMultiplier).toBe(1);
        expect(models[1].costMultiplier).toBe(2);
    });

    it("maps each model id to its pricing", () => {
        expect(BUILT_PRICING).toMatchObject({
            cheap: { input: 1, output: 2 },
            mid: { input: 2, output: 4 },
            spendy: { input: 10, output: 30 }
        });
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

    it("getModelPricing returns known pricing and undefined for unknown models", () => {
        const provider = new TestProvider();
        expect(provider.getModelPricing("mid")).toEqual({ input: 2, output: 4 });
        expect(provider.getModelPricing("nope")).toBeUndefined();
    });

    it("getAvailableModels returns the configured model list", () => {
        const provider = new TestProvider();
        expect(provider.getAvailableModels().map((m) => m.id)).toEqual(["cheap", "mid", "spendy"]);
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
