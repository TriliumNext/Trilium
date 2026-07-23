/**
 * Base class for LLM providers. Handles shared logic for system prompt building,
 * tool assembly, model pricing, and title generation.
 */

import { type LlmMessage, type LlmMessagePart } from "@triliumnext/commons";
import { type FilePart, generateText, type ImagePart, type LanguageModel, type ModelMessage, stepCountIs, streamText, type SystemModelMessage, type TextPart, type ToolSet } from "ai";

import { allToolRegistries } from "../tools/index.js";
import type { LlmProvider, LlmProviderConfig, ModelInfo, ModelPricing, StreamResult } from "../types.js";
import { resolveAttachmentPart } from "./attachment_content.js";
import { buildNoteHint } from "./note_hint.js";
import { buildSystemPrompt as composeSystemPrompt } from "./system_prompt.js";

const DEFAULT_MAX_TOKENS = 8096;
const TITLE_MAX_TOKENS = 30;

/**
 * Calculate effective cost for comparison (weighted average: 1 input + 3 output).
 * Output is weighted more heavily as it's typically the dominant cost factor.
 */
function effectiveCost(pricing: ModelPricing): number {
    return (pricing.input + 3 * pricing.output) / 4;
}

/**
 * Resolve a single LlmMessagePart to its AI SDK ModelMessage part form, mapping
 * the provider-neutral {@link resolveAttachmentPart} result into `ai`'s block
 * shapes. Returns null (and the caller drops the part) when it can't resolve.
 */
function resolveMessagePart(part: LlmMessagePart): TextPart | ImagePart | FilePart | null {
    const resolved = resolveAttachmentPart(part);
    if (!resolved) {
        return null;
    }
    switch (resolved.kind) {
        case "text":
            return { type: "text", text: resolved.text };
        case "image":
            return { type: "image", image: resolved.bytes, mediaType: resolved.mime };
        case "file":
            return { type: "file", data: resolved.bytes, mediaType: resolved.mime, filename: resolved.filename };
    }
}

/**
 * Build a single ModelMessage from an LlmMessage. Plain string content stays
 * as-is; multimodal content is resolved into AI SDK text/image/file parts.
 */
export function buildModelMessage(m: LlmMessage): ModelMessage {
    const role = m.role as "user" | "assistant";
    if (typeof m.content === "string") {
        return { role, content: m.content };
    }
    const resolved = m.content
        .map(resolveMessagePart)
        .filter((p): p is TextPart | ImagePart | FilePart => p !== null);
    // Assistant turns can only carry TextParts (per the AI SDK type), so
    // strip any stray attachments — they only make sense on user turns anyway.
    if (role === "assistant") {
        const textOnly: TextPart[] = resolved.filter((p): p is TextPart => p.type === "text");
        return { role: "assistant", content: textOnly };
    }
    return { role: "user", content: resolved };
}

/**
 * Build the model list with cost multipliers from a base model definition array.
 */
export function buildModelList(baseModels: Omit<ModelInfo, "costMultiplier">[]): {
    models: ModelInfo[];
    pricing: Record<string, ModelPricing>;
} {
    const baselineModel = baseModels.find(m => m.isDefault) || baseModels[0];
    const baselineCost = effectiveCost(baselineModel.pricing);

    const models = baseModels.map(m => ({
        ...m,
        costMultiplier: Math.round((effectiveCost(m.pricing) / baselineCost) * 10) / 10
    }));

    const pricing = Object.fromEntries(
        models.map(m => [m.id, m.pricing])
    );

    return { models, pricing };
}

export abstract class BaseProvider implements LlmProvider {
    abstract name: string;

    protected abstract defaultModel: string;
    protected abstract titleModel: string;
    protected abstract availableModels: ModelInfo[];
    protected abstract modelPricing: Record<string, ModelPricing>;

    /** Create a language model instance for the given model ID. */
    protected abstract createModel(modelId: string): LanguageModel;

    /**
     * Build the system prompt. Delegates to the shared `system_prompt` module;
     * kept as an overridable method so providers can post-process the result
     * (e.g. Google appends a web-search/note-tool conflict notice).
     */
    protected buildSystemPrompt(messages: LlmMessage[], config: LlmProviderConfig): string | undefined {
        return composeSystemPrompt(messages, config);
    }

    /**
     * Build the ModelMessage array from LlmMessages (no provider-specific options).
     *
     * Only user/assistant turns are included here — the system prompt is passed
     * separately via the `system` option of `streamText` (see `buildSystemMessage`),
     * which is resilient against prompt injection.
     */
    protected buildMessages(chatMessages: LlmMessage[]): ModelMessage[] {
        return chatMessages.map(m => buildModelMessage(m));
    }

    /**
     * Attach the current-note metadata hint to the last user message.
     *
     * The hint is deliberately kept OUT of the system prompt: it changes whenever
     * the context note changes, and the system prompt carries the provider's
     * prompt-cache breakpoint — embedding volatile content there would invalidate
     * the cached system+tools prefix on every note edit. The last user message is
     * regenerated every turn and never cached, so it is the right home for it.
     */
    protected applyNoteHint(chatMessages: LlmMessage[], config: LlmProviderConfig): LlmMessage[] {
        if (!config.contextNoteId) {
            return chatMessages;
        }

        const lastUserIndex = chatMessages.map(m => m.role).lastIndexOf("user");
        if (lastUserIndex === -1) {
            return chatMessages;
        }

        const lastUserContent = chatMessages[lastUserIndex].content;
        const hasAttachments = Array.isArray(lastUserContent)
            && lastUserContent.some(p => p.type !== "text");

        const noteHint = buildNoteHint(config.contextNoteId, hasAttachments);
        if (!noteHint) {
            return chatMessages;
        }

        return chatMessages.map((m, i) => {
            if (i !== lastUserIndex) return m;
            if (typeof m.content === "string") {
                return { ...m, content: `${noteHint}\n\n${m.content}` };
            }
            // For multimodal content, prepend the hint as a leading text part so
            // any attached images still travel with the message.
            return {
                ...m,
                content: [{ type: "text" as const, text: noteHint }, ...m.content]
            };
        });
    }

    /**
     * Build the value for the `system` option of `streamText`. Subclasses can
     * override to attach provider-specific metadata (e.g. cache control).
     */
    protected buildSystemMessage(systemPrompt: string | undefined): string | SystemModelMessage | undefined {
        return systemPrompt;
    }

    /**
     * Add provider-specific web search tool. Override in subclasses that support it.
     */
    protected addWebSearchTool(_tools: ToolSet): void {}

    /**
     * Build the tool set based on config.
     */
    protected buildTools(config: LlmProviderConfig): ToolSet {
        const tools: ToolSet = {};

        if (config.enableWebSearch) {
            this.addWebSearchTool(tools);
        }

        if (config.enableNoteTools) {
            const autoExecuteMutating = config.toolPermissionMode === "auto";
            for (const registry of allToolRegistries) {
                Object.assign(tools, registry.toToolSet({ autoExecuteMutating }));
            }
        }

        return tools;
    }

    chat(messages: LlmMessage[], config: LlmProviderConfig): StreamResult {
        const systemPrompt = this.buildSystemPrompt(messages, config);
        const chatMessages = this.applyNoteHint(messages.filter(m => m.role !== "system"), config);
        const coreMessages = this.buildMessages(chatMessages);

        const streamOptions: Parameters<typeof streamText>[0] = {
            model: this.createModel(config.model || this.defaultModel),
            system: this.buildSystemMessage(systemPrompt),
            messages: coreMessages,
            maxOutputTokens: config.maxTokens || DEFAULT_MAX_TOKENS,
            // Reject any system message smuggled into `messages` (prompt injection guard).
            allowSystemInMessages: false,
            // The AI SDK's default onError handler dumps the raw error object straight
            // to stdout, bypassing Trilium's logger. The error is still delivered through
            // `fullStream`, where `streamToChunks` turns it into a detailed message that
            // the chat route logs — so suppress the unstructured stdout dump here.
            onError: () => {}
        };

        const tools = this.buildTools(config);
        if (Object.keys(tools).length > 0) {
            streamOptions.tools = tools;
            streamOptions.stopWhen = stepCountIs(15);
            streamOptions.toolChoice = "auto";
        }

        return streamText(streamOptions);
    }

    getModelPricing(model: string): ModelPricing | undefined {
        return this.modelPricing[model];
    }

    getAvailableModels(): ModelInfo[] {
        return this.availableModels;
    }

    async generateTitle(firstMessage: string): Promise<string> {
        const { text } = await generateText({
            model: this.createModel(this.titleModel),
            maxOutputTokens: TITLE_MAX_TOKENS,
            messages: [
                {
                    role: "user",
                    content: `Summarize the following message as a very short chat title (max 6 words). Reply with ONLY the title, no quotes or punctuation at the end.\n\nMessage: ${firstMessage}`
                }
            ]
        });

        return text.trim();
    }
}
