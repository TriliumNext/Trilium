/**
 * Base class for LLM providers. Handles shared logic for system prompt building,
 * tool assembly, model pricing, and title generation.
 */

import type { LlmMessage } from "@triliumnext/commons";
import { generateText, type LanguageModel, type ModelMessage, stepCountIs, streamText, type SystemModelMessage, type ToolSet } from "ai";
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

        // Note tools hint
        if (config.enableNoteTools) {
            parts.push(
                `You have access to skills that provide specialized instructions. Load a skill with the load_skill tool before performing complex operations.\n\nAvailable skills:\n${getSkillsSummary()}`
            );
            parts.push(
                `When referring to notes in your responses, use the wiki-link format [[noteId]] to create clickable internal links. Use the note ID (not the title) from tool results. The link will automatically display the note's title and icon, so don't repeat the title in your text. For example: "You can find more details in [[ZjSfLhzlqNY6]]" instead of "You can find more details in the Meeting Notes note ([[ZjSfLhzlqNY6]])".`
            );
            parts.push(
                `Do not create, modify, or delete notes unless the user explicitly asks you to (e.g. "create a note", "save this to a note"). The chat supports rich Markdown rendering including code blocks, math equations, mermaid diagrams, and tables — so always present content directly in your response rather than creating a note for it. For example, if asked to "visualize an algorithm", render a mermaid diagram in the chat, don't create a note.`
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

        // Parallel tool-call hint
        if (config.enableNoteTools || config.enableWebSearch) {
            parts.push(
                `When you need several independent pieces of information, issue the tool calls in parallel within the same turn instead of waiting for each result before requesting the next. Only chain calls sequentially when a later call genuinely depends on the output of an earlier one.`
            );
        }

        // Markdown formatting hints
        parts.push(
            `Your responses are rendered as Markdown with extended features. Use them when appropriate:\n\n`
                + `**Admonitions** — GitHub-style callout blocks. Use sparingly, only when a plain paragraph would under-sell the point:\n`
                + `- \`> [!NOTE]\` — neutral side information worth highlighting\n`
                + `- \`> [!TIP]\` — an optional improvement or shortcut\n`
                + `- \`> [!IMPORTANT]\` — information the user should not miss\n`
                + `- \`> [!WARNING]\` — something that may cause problems or surprise\n`
                + `- \`> [!CAUTION]\` — a destructive or irreversible action\n`
                + `Syntax: the marker must be on its own line, and every content line must start with \`>\`.\n\n`
                + `**Math equations** — KaTeX (LaTeX subset). Use \`$...$\` for inline math and \`$$...$$\` for display (block) math. Example: \`$E = mc^2$\` or:\n`
                + `$$\n\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$\n\n`
                + `**Mermaid diagrams** — use a fenced code block with the \`mermaid\` language tag. Example:\n`
                + "```mermaid\ngraph LR\n    A --> B\n```\n\n"
                + `**Code blocks** — use fenced code blocks with a language tag for syntax highlighting (e.g. \`\`\`js, \`\`\`python).\n\n`
                + `**Footnotes** — use \`[^1]\` in text and \`[^1]: explanation\` at the bottom.\n\n`
                + `**Task lists** — use \`- [ ]\` for unchecked and \`- [x]\` for checked items.`
        );

        return parts.length > 0 ? parts.join("\n\n") : undefined;
    }

    /**
     * Build the ModelMessage array from LlmMessages (no provider-specific options).
     *
     * Only user/assistant turns are included here — the system prompt is passed
     * separately via the `system` option of `streamText` (see `buildSystemMessage`),
     * which is resilient against prompt injection.
     */
    protected buildMessages(chatMessages: LlmMessage[]): ModelMessage[] {
        return chatMessages.map(m => ({
            role: m.role as "user" | "assistant",
            content: m.content
        }));
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

        const noteHint = buildNoteHint(config.contextNoteId);
        if (!noteHint) {
            return chatMessages;
        }

        const lastUserIndex = chatMessages.map(m => m.role).lastIndexOf("user");
        if (lastUserIndex === -1) {
            return chatMessages;
        }

        return chatMessages.map((m, i) =>
            i === lastUserIndex ? { ...m, content: `${noteHint}\n\n${m.content}` } : m
        );
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
            for (const registry of allToolRegistries) {
                Object.assign(tools, registry.toToolSet());
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
