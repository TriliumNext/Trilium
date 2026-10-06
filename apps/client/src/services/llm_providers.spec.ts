import type { LlmModelInfo } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ stored: [] as unknown[] | null }));

vi.mock("./options.js", () => ({ default: { getJson: () => mocks.stored } }));

import { readSearchProviders, readSelectedModels, readsAttachmentKind, resolveWebSearch, unreadableAttachments } from "./llm_providers.js";

const textOnly: LlmModelInfo = { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", attachmentKinds: [] };
const imagesOnly: LlmModelInfo = { id: "codex", name: "Codex", attachmentKinds: [ "image" ] };
const everything: LlmModelInfo = { id: "claude", name: "Claude" };

const png = { type: "image", mime: "image/png" };
const svg = { type: "image", mime: "image/svg+xml" };
const pdf = { type: "file", mime: "application/pdf" };
const markdown = { type: "text_file", mime: "text/markdown" };

describe("attachment support", () => {
    it("finds the attachments a model cannot read, never text files or SVGs", () => {
        const all = [ png, svg, pdf, markdown ];
        expect(unreadableAttachments(textOnly, all)).toEqual([ png, pdf ]);
        expect(unreadableAttachments(imagesOnly, all)).toEqual([ pdf ]);
        // No `attachmentKinds`, or no model at all, restricts nothing.
        expect(unreadableAttachments(everything, all)).toEqual([]);
        expect(unreadableAttachments(undefined, all)).toEqual([]);
    });

    it("says whether a model reads a kind", () => {
        expect(readsAttachmentKind(textOnly, "image")).toBe(false);
        expect(readsAttachmentKind(imagesOnly, "image")).toBe(true);
        expect(readsAttachmentKind(imagesOnly, "file")).toBe(false);
        expect(readsAttachmentKind(everything, "file")).toBe(true);
    });
});

describe("readSelectedModels", () => {
    it("lists chat providers only, leaving search providers out", () => {
        mocks.stored = [
            { id: "o1", name: "OpenAI", provider: "openai", selectedModels: [ { id: "gpt", name: "GPT" } ] },
            { id: "s1", name: "Brave Search", provider: "brave", kind: "search" }
        ];
        const { groups, models, hasProvider } = readSelectedModels();
        expect(groups.map(group => group.id)).toEqual([ "o1" ]);
        expect(models.map(model => model.id)).toEqual([ "gpt" ]);
        expect(hasProvider).toBe(true);

        mocks.stored = [ { id: "s1", name: "Brave Search", provider: "brave", kind: "search" } ];
        expect(readSelectedModels().hasProvider).toBe(false);
    });
});

describe("readSearchProviders", () => {
    it("lists the search providers in config order, and none when the option is unset", () => {
        mocks.stored = [
            { id: "s1", name: "Brave Search", provider: "brave", kind: "search", apiKey: "k" },
            { id: "o1", name: "OpenAI", provider: "openai" },
            { id: "s2", name: "Tavily", provider: "tavily", kind: "search" }
        ];
        expect(readSearchProviders()).toEqual([
            { id: "s1", name: "Brave Search", provider: "brave" },
            { id: "s2", name: "Tavily", provider: "tavily" }
        ]);

        mocks.stored = null;
        expect(readSearchProviders()).toEqual([]);
    });
});

describe("resolveWebSearch", () => {
    const TAVILY = { id: "s1", name: "Tavily", provider: "tavily" };
    const resolve = (modelProvider: string | undefined, overrides: Partial<Parameters<typeof resolveWebSearch>[0]> = {}) =>
        resolveWebSearch({ modelProvider, enableWebSearch: true, enableNoteTools: false, searchProviderId: "", searchProviders: [ TAVILY ], ...overrides });

    it("uses the model's built-in search by default, where the model has one", () => {
        expect(resolve("anthropic")).toEqual({ choice: "builtin", enableWebSearch: true, webSearchProviderId: undefined });
        expect(resolve("deepseek")).toMatchObject({ choice: "builtin", enableWebSearch: false, builtInUnavailableKey: "llm_chat.web_search_builtin_unsupported" });
        // Gemini can't combine its own search with note tools.
        expect(resolve("google", { enableNoteTools: true })).toMatchObject({ enableWebSearch: false, builtInUnavailableKey: "llm_chat.web_search_unavailable_gemini" });
    });

    it("searches through the chosen search provider, falling back to built-in once it is gone", () => {
        expect(resolve("deepseek", { searchProviderId: "s1" })).toEqual({ choice: "s1", enableWebSearch: true, webSearchProviderId: "s1", builtInUnavailableKey: "llm_chat.web_search_builtin_unsupported" });
        expect(resolve("google", { searchProviderId: "s1", enableNoteTools: true })).toMatchObject({ enableWebSearch: true, webSearchProviderId: "s1" });
        expect(resolve("anthropic", { searchProviderId: "deleted" })).toMatchObject({ choice: "builtin", enableWebSearch: true, webSearchProviderId: undefined });
    });

    it("sends no search provider to a model that runs its own agent loop, nor anything when disabled", () => {
        expect(resolve("claude-agent", { searchProviderId: "s1" })).toMatchObject({
            choice: "s1", enableWebSearch: false, webSearchProviderId: undefined, searchProviderUnavailableKey: "llm_chat.web_search_provider_unsupported"
        });
        expect(resolve("claude-agent")).toMatchObject({ choice: "builtin", enableWebSearch: true });
        expect(resolve("anthropic", { enableWebSearch: false, searchProviderId: "s1" })).toMatchObject({ choice: "disabled", enableWebSearch: false, webSearchProviderId: undefined });
    });
});
