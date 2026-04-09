/**
 * Base class for LLM providers. Handles shared logic for system prompt building,
 * tool assembly, model pricing, and title generation.
 */

import type { LlmMessage } from "@triliumnext/commons";
import type { LanguageModel } from "ai";
import { generateText, type ModelMessage, stepCountIs, streamText, type ToolSet } from "ai";
import yaml from "js-yaml";

import becca from "../../../becca/becca.js";
import { getSkillsSummary } from "../skills/index.js";
import { getNoteMeta,SYSTEM_PROMPT_LIMITS } from "../tools/helpers.js";
import { allToolRegistries } from "../tools/index.js";
import type { LlmProvider, LlmProviderConfig, ModelInfo, ModelPricing, StreamResult } from "../types.js";

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
 * Build a context hint about the current note with full metadata (same as get_note / ETAPI).
 */
function buildNoteHint(noteId: string): string | null {
    const note = becca.getNote(noteId);
    if (!note) {
        return null;
    }

    const metadata = yaml.dump(getNoteMeta(note, SYSTEM_PROMPT_LIMITS), { lineWidth: -1 });
    return [
        "The user is currently viewing the following note.",
        "Use this metadata (including contentPreview) to answer questions about the note without calling tools when possible.",
        "Use get_note_content only if the preview is insufficient.",
        "",
        metadata
    ].join("\n");
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
     * Build the system prompt with note hints and skills summary.
     */
    protected buildSystemPrompt(messages: LlmMessage[], config: LlmProviderConfig): string | undefined {
        const parts: string[] = [];

        // Base system prompt from config or messages
        const basePrompt = config.systemPrompt || messages.find(m => m.role === "system")?.content;
        if (basePrompt) {
            parts.push(basePrompt);
        }

        // Context note hint
        if (config.contextNoteId) {
            const noteHint = buildNoteHint(config.contextNoteId);
            if (noteHint) {
                parts.push(noteHint);
            }
        }

        // Note tools hint
        if (config.enableNoteTools) {
            parts.push(
                `You have access to skills that provide specialized instructions. Load a skill with the load_skill tool before performing complex operations.\n\nAvailable skills:\n${getSkillsSummary()}`
            );
            parts.push(
                `When referring to notes in your responses, use the wiki-link format [[noteId]] to create clickable internal links. Use the note ID (not the title) from tool results. The link will automatically display the note's title and icon, so don't repeat the title in your text. For example: "You can find more details in [[ZjSfLhzlqNY6]]" instead of "You can find more details in the Meeting Notes note ([[ZjSfLhzlqNY6]])".`
            );
        } else if (config.contextNoteId) {
            parts.push(
                `You can see the current note's metadata above, but you cannot search or access other notes. If the user asks about other notes, inform them that "Note access" is disabled and they need to enable it in the chat settings (click on the model name dropdown and toggle "Note access").`
            );
        } else {
            parts.push(
                `You do not have access to the user's notes. If the user asks about their notes, inform them that "Note access" is disabled and they need to enable it in the chat settings (click on the model name dropdown and toggle "Note access").`
            );
        }

        // Web search hint
        if (!config.enableWebSearch) {
            parts.push(
                `You do not have access to web search. If the user asks for current/real-time information, news, or anything that requires searching the web, inform them that "Web search" is disabled and they need to enable it in the chat settings (click on the model name dropdown and toggle "Web search").`
            );
        }

        return parts.length > 0 ? parts.join("\n\n") : undefined;
    }

    /**
     * Build the ModelMessage array from LlmMessages (no provider-specific options).
     */
    protected buildMessages(chatMessages: LlmMessage[], systemPrompt: string | undefined): ModelMessage[] {
        const coreMessages: ModelMessage[] = [];

        if (systemPrompt) {
            coreMessages.push({ role: "system", content: systemPrompt });
        }

        for (const m of chatMessages) {
            coreMessages.push({
                role: m.role as "user" | "assistant",
                content: m.content
            });
        }

        return coreMessages;
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
            for (const registry of allToolRegistries) {
                Object.assign(tools, registry.toToolSet());
            }
        }

        return tools;
    }

    chat(messages: LlmMessage[], config: LlmProviderConfig): StreamResult {
        const systemPrompt = this.buildSystemPrompt(messages, config);
        const chatMessages = messages.filter(m => m.role !== "system");
        const coreMessages = this.buildMessages(chatMessages, systemPrompt);

        const streamOptions: Parameters<typeof streamText>[0] = {
            model: this.createModel(config.model || this.defaultModel),
            messages: coreMessages,
            maxOutputTokens: config.maxTokens || DEFAULT_MAX_TOKENS
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
