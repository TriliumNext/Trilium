import type { LlmMessage } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createAnthropicMock = vi.fn();

vi.mock("@ai-sdk/anthropic", () => ({
    createAnthropic: (opts: unknown) => {
        createAnthropicMock(opts);
        const fn: any = () => ({});
        fn.tools = { webSearch_20250305: () => ({}) };
        return fn;
    }
}));

const { streamTextMock, noteMetaMock } = vi.hoisted(() => ({
    streamTextMock: vi.fn((..._args: any[]) => ({}) as any),
    noteMetaMock: vi.fn()
}));

vi.mock("ai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("ai")>();
    return { ...actual, streamText: streamTextMock };
});

// The note hint embeds live note metadata into the system prompt. Mock the
// becca lookup and metadata builder so the "current note" content is fully
// controllable from the tests below.
vi.mock("../../../becca/becca.js", () => ({
    default: { getNote: (noteId: string) => ({ noteId }) }
}));

vi.mock("../tools/helpers.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../tools/helpers.js")>();
    return { ...actual, getNoteMeta: noteMetaMock };
});

import { AnthropicProvider } from "./anthropic.js";

describe("AnthropicProvider construction", () => {
    beforeEach(() => {
        createAnthropicMock.mockClear();
    });

    it("forwards apiKey only when no baseURL provided", () => {
        new AnthropicProvider("sk-ant-test");
        expect(createAnthropicMock).toHaveBeenCalledTimes(1);
        expect(createAnthropicMock).toHaveBeenCalledWith({ apiKey: "sk-ant-test" });
    });

    it("forwards apiKey and baseURL when both provided", () => {
        new AnthropicProvider("sk-ant-test", "https://proxy.example.com/v1");
        expect(createAnthropicMock).toHaveBeenCalledWith({
            apiKey: "sk-ant-test",
            baseURL: "https://proxy.example.com/v1"
        });
    });

    it("omits baseURL when empty string is provided", () => {
        new AnthropicProvider("sk-ant-test", "");
        expect(createAnthropicMock).toHaveBeenCalledWith({ apiKey: "sk-ant-test" });
    });

    it("throws when apiKey is missing", () => {
        expect(() => new AnthropicProvider("")).toThrow(/API key is required/);
    });
});

describe("AnthropicProvider message building", () => {
    beforeEach(() => {
        streamTextMock.mockClear();
    });

    it("buildSystemMessage returns a system message with an ephemeral cache breakpoint", () => {
        const provider = new AnthropicProvider("sk-ant-test") as any;

        expect(provider.buildSystemMessage("You are helpful.")).toEqual({
            role: "system",
            content: "You are helpful.",
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } }
        });
        expect(provider.buildSystemMessage(undefined)).toBeUndefined();
        expect(provider.buildSystemMessage("")).toBeUndefined();
    });

    it("buildMessages emits only user/assistant turns, never a system role", () => {
        const provider = new AnthropicProvider("sk-ant-test") as any;
        const messages: LlmMessage[] = [
            { role: "user", content: "hi" },
            { role: "assistant", content: "" },
            { role: "user", content: "bye" }
        ];

        const built = provider.buildMessages(messages);

        expect(built.map((m: any) => m.role)).toEqual(["user", "assistant", "user"]);
        // Anthropic rejects empty content blocks — empty turns get a placeholder.
        expect(built[1].content).toBe("(tool use)");
    });

    it("chat() routes the system prompt into the `system` option and forbids system messages in `messages`", () => {
        const provider = new AnthropicProvider("sk-ant-test");
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
        expect(opts.system.role).toBe("system");
        expect(opts.system.content).toContain("BASE PROMPT");
        expect(opts.system.providerOptions).toEqual({
            anthropic: { cacheControl: { type: "ephemeral" } }
        });
    });

    it("chat() with extended thinking also guards against system messages in `messages`", () => {
        const provider = new AnthropicProvider("sk-ant-test");
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
        expect(opts.system.role).toBe("system");
        expect(opts.system.content).toContain("BASE PROMPT");
    });
});

/**
 * The system prompt carries the ephemeral cache breakpoint, so Anthropic can only
 * reuse the cached system+tools prefix when that string is byte-stable across turns.
 *
 * These tests assert the *desired* invariant: editing the context note must not
 * disturb the cached system prompt. They currently FAIL because the live note
 * metadata is embedded directly into the cache-controlled system string — that
 * red state is the confirmation that the note hint busts the prompt cache. Once
 * the hint is moved out of the cached prefix, they turn green.
 */
describe("AnthropicProvider prompt cache stability", () => {
    beforeEach(() => {
        streamTextMock.mockClear();
        noteMetaMock.mockReset();
    });

    /** Run a single chat() turn and return the `system.content` string sent to the model. */
    function systemContentFor(provider: AnthropicProvider, contextNoteId?: string): string {
        streamTextMock.mockClear();
        provider.chat(
            [
                { role: "system", content: "BASE PROMPT" },
                { role: "user", content: "hello" }
            ],
            contextNoteId ? { contextNoteId } : {}
        );
        return (streamTextMock.mock.calls[0][0] as any).system.content as string;
    }

    it("keeps the cache-controlled system prompt stable when the context note's content changes", () => {
        const provider = new AnthropicProvider("sk-ant-test");

        // Turn 1: the note holds its original content.
        noteMetaMock.mockReturnValue({ noteId: "scriptNote", contentPreview: "ORIGINAL_BODY" });
        const system1 = systemContentFor(provider, "scriptNote");

        // Turn 2: the model edited the note, so its metadata preview now differs.
        noteMetaMock.mockReturnValue({ noteId: "scriptNote", contentPreview: "EDITED_BODY" });
        const system2 = systemContentFor(provider, "scriptNote");

        // The system prompt carries the ephemeral cache breakpoint, so it must stay
        // byte-stable across turns — otherwise every note edit re-bills the entire
        // (~10K token) cached system+tools prefix. The volatile note metadata
        // therefore belongs outside this string, not embedded within it.
        expect(system2).toBe(system1);
    });

    it("keeps the system prompt stable across turns when no context note is attached", () => {
        const provider = new AnthropicProvider("sk-ant-test");
        // No note metadata in the prompt → the cached prefix stays byte-identical.
        expect(systemContentFor(provider)).toBe(systemContentFor(provider));
    });

    it("delivers the note hint on the last user message instead of the cached system prompt", () => {
        const provider = new AnthropicProvider("sk-ant-test");
        noteMetaMock.mockReturnValue({ noteId: "scriptNote", contentPreview: "SCRIPT_BODY" });

        streamTextMock.mockClear();
        provider.chat(
            [
                { role: "system", content: "BASE PROMPT" },
                { role: "user", content: "what does this do?" }
            ],
            { contextNoteId: "scriptNote" }
        );
        const opts = streamTextMock.mock.calls[0][0] as any;

        // The note metadata still reaches the model — attached to the (uncached)
        // last user message alongside the user's actual question...
        const lastMessage = opts.messages[opts.messages.length - 1];
        expect(lastMessage.role).toBe("user");
        expect(lastMessage.content).toContain("SCRIPT_BODY");
        expect(lastMessage.content).toContain("what does this do?");

        // ...but never leaks into the cache-controlled system prompt.
        expect(opts.system.content).not.toContain("SCRIPT_BODY");
    });
});
